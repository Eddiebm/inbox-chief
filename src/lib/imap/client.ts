/**
 * IMAP / SMTP mailbox connect + optional light header sync.
 *
 * - Connect: validates input, stores encrypted credentials (tenant-scoped).
 * - Sync: when `imapflow` is available and the runtime supports TCP sockets
 *   (Node on Vercel — not Cloudflare Workers), LIST recent headers into Message rows.
 * - NEVER auto-send. SMTP is stored for approved-send only (not implemented here).
 *
 * Yahoo and iCloud use the same path with host presets.
 */

import { writeAuditLog } from "@/lib/audit";
import { encryptSecret, decryptSecret } from "@/lib/crypto/token-encryption";
import { assertNeverAutoSend, mailClientMayAutoSend } from "@/lib/mail/never-send";
import { getImapPreset } from "@/lib/mail/providers/presets";
import type {
  ImapConnectInput,
  MailboxConnectResult,
  MailboxSyncInput,
  MailboxSyncResult,
  ProviderId,
} from "@/lib/mail/providers/types";

export const IMAP_SYNC_ALLOWED_OPERATIONS = [
  "imap.list",
  "imap.fetch.headers",
] as const;

export type ImapValidationResult =
  | { ok: true }
  | { ok: false; reason: string; message: string };

export function validateImapConnectInput(
  input: Partial<ImapConnectInput>,
): ImapValidationResult {
  if (!input.organizationId || !input.workspaceId || !input.userId) {
    return {
      ok: false,
      reason: "tenant_scope_required",
      message: "organizationId, workspaceId, and userId are required.",
    };
  }

  const email = input.emailAddress?.trim().toLowerCase() ?? "";
  if (!email || !email.includes("@")) {
    return {
      ok: false,
      reason: "email_invalid",
      message: "Enter a valid email address.",
    };
  }

  if (!input.password || input.password.trim().length < 4) {
    return {
      ok: false,
      reason: "password_required",
      message: "An app password (or account password) is required.",
    };
  }

  const provider = input.provider ?? "imap";
  const preset = getImapPreset(provider);
  const imapHost = (input.imapHost ?? preset.imapHost).trim();
  const smtpHost = (input.smtpHost ?? preset.smtpHost).trim();
  const imapPort = Number(input.imapPort ?? preset.imapPort);
  const smtpPort = Number(input.smtpPort ?? preset.smtpPort);

  if (!imapHost || !smtpHost) {
    return {
      ok: false,
      reason: "hosts_required",
      message: "IMAP and SMTP hosts are required.",
    };
  }

  if (
    !Number.isFinite(imapPort) ||
    imapPort < 1 ||
    imapPort > 65535 ||
    !Number.isFinite(smtpPort) ||
    smtpPort < 1 ||
    smtpPort > 65535
  ) {
    return {
      ok: false,
      reason: "ports_invalid",
      message: "IMAP and SMTP ports must be between 1 and 65535.",
    };
  }

  return { ok: true };
}

function isNodeTcpRuntime(): boolean {
  // Cloudflare Workers / edge do not support raw TCP for IMAP.
  if (typeof process === "undefined") return false;
  if (process.env.OPEN_NEXT_WORKER === "1") return false;
  if (process.env.NEXT_RUNTIME === "edge") return false;
  return Boolean(process.versions?.node);
}

/**
 * Store encrypted IMAP/SMTP credentials. Does not send mail.
 * Optionally probes IMAP LIST when imapflow + Node TCP are available.
 */
export async function connectImapMailbox(
  input: ImapConnectInput,
): Promise<MailboxConnectResult> {
  assertNeverAutoSend(IMAP_SYNC_ALLOWED_OPERATIONS);
  if (mailClientMayAutoSend()) {
    throw new Error("Never auto-send: MAIL_AUTO_SEND_ENABLED must stay false");
  }

  if (process.env.MOCK_INTEGRATIONS === "true") {
    return {
      ok: false,
      connectionStatus: "disconnected",
      scopes: [],
      provider: input.provider,
      reason: "mock_integrations_enabled",
    };
  }

  const validation = validateImapConnectInput(input);
  if (!validation.ok) {
    return {
      ok: false,
      connectionStatus: "error",
      scopes: [],
      provider: input.provider,
      reason: validation.reason,
    };
  }

  const preset = getImapPreset(input.provider);
  const emailAddress = input.emailAddress.trim().toLowerCase();
  const imapHost = (input.imapHost || preset.imapHost).trim();
  const smtpHost = (input.smtpHost || preset.smtpHost).trim();
  const imapPort = Number(input.imapPort || preset.imapPort);
  const smtpPort = Number(input.smtpPort || preset.smtpPort);
  const imapSecure = input.imapSecure ?? preset.imapSecure;
  const smtpSecure = input.smtpSecure ?? preset.smtpSecure;

  let probeOk = false;
  let probeStub = true;
  let probeReason: string | undefined;

  if (isNodeTcpRuntime()) {
    const probe = await probeImapLogin({
      host: imapHost,
      port: imapPort,
      secure: imapSecure,
      user: emailAddress,
      pass: input.password,
    });
    probeStub = probe.stub;
    probeOk = probe.ok;
    probeReason = probe.reason;
    if (!probe.stub && !probe.ok) {
      return {
        ok: false,
        stub: false,
        connectionStatus: "error",
        scopes: [],
        provider: input.provider,
        reason: probeReason ?? "imap_auth_failed",
      };
    }
  } else {
    probeReason = "imap_probe_skipped_edge_runtime";
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  const mailbox = await prisma.$transaction(async (tx) => {
    const existing = input.mailboxId
      ? await tx.mailbox.findFirst({
          where: {
            id: input.mailboxId,
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
          },
        })
      : await tx.mailbox.findFirst({
          where: {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            emailAddress,
          },
        });

    const nextMailbox =
      existing ??
      (await tx.mailbox.create({
        data: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          ownerId: input.userId,
          createdById: input.userId,
          emailAddress,
          displayName: emailAddress,
          provider: input.provider,
          connectionStatus: "connected",
        },
      }));

    if (existing) {
      await tx.mailbox.update({
        where: { id: existing.id },
        data: {
          connectionStatus: "connected",
          provider: input.provider,
          emailAddress,
          displayName: existing.displayName ?? emailAddress,
        },
      });
    }

    await tx.mailboxImapCredentials.upsert({
      where: { mailboxId: nextMailbox.id },
      create: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: nextMailbox.id,
        emailAddress,
        passwordEnc: encryptSecret(input.password),
        imapHost,
        imapPort,
        imapSecure,
        smtpHost,
        smtpPort,
        smtpSecure,
      },
      update: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        emailAddress,
        passwordEnc: encryptSecret(input.password),
        imapHost,
        imapPort,
        imapSecure,
        smtpHost,
        smtpPort,
        smtpSecure,
      },
    });

    return nextMailbox;
  });

  await writeAuditLog({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    mailboxId: mailbox.id,
    actorId: input.userId,
    action: "MANAGE_INTEGRATION",
    summary: `Connected ${input.provider} IMAP mailbox ${emailAddress}${probeOk ? " (login verified)" : " (credentials stored)"}`,
    resourceType: "mailbox",
    resourceId: mailbox.id,
    metadata: {
      provider: input.provider,
      imapHost,
      probeOk,
      probeStub,
      probeReason,
    },
  });

  return {
    ok: true,
    stub: probeStub && !probeOk,
    connectionStatus: "connected",
    scopes: [],
    mailboxId: mailbox.id,
    emailAddress,
    provider: input.provider,
    reason: probeReason,
  };
}

type ProbeResult = {
  ok: boolean;
  stub: boolean;
  reason?: string;
};

async function probeImapLogin(opts: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}): Promise<ProbeResult> {
  try {
    // Dynamic import keeps Workers bundles from requiring native TCP at load time.
    const mod = await import("imapflow");
    const ImapFlow = mod.ImapFlow;
    const client = new ImapFlow({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: { user: opts.user, pass: opts.pass },
      logger: false,
    });
    try {
      await client.connect();
      await client.logout();
      return { ok: true, stub: false };
    } catch (err) {
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        stub: false,
        reason:
          err instanceof Error ? `imap_auth_failed:${err.message}` : "imap_auth_failed",
      };
    }
  } catch {
    // imapflow not installed or unavailable in this runtime
    return {
      ok: true,
      stub: true,
      reason: "imapflow_unavailable_credentials_stored",
    };
  }
}

/**
 * Light IMAP header sync when Node + imapflow are available.
 * Otherwise returns a documented stub result without failing the mailbox.
 */
export async function syncImapMailbox(
  input: MailboxSyncInput & { provider?: ProviderId },
): Promise<MailboxSyncResult> {
  assertNeverAutoSend(IMAP_SYNC_ALLOWED_OPERATIONS);

  const provider = (input.provider ?? "imap") as ProviderId;

  if (!input.organizationId || !input.workspaceId || !input.mailboxId) {
    return {
      ok: false,
      fetched: 0,
      provider,
      reason: "tenant_scope_required",
    };
  }

  if (!isNodeTcpRuntime()) {
    return {
      ok: true,
      stub: true,
      fetched: 0,
      provider,
      reason: "imap_sync_requires_node_tcp",
    };
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  const creds = await prisma.mailboxImapCredentials.findFirst({
    where: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
    },
  });

  if (!creds) {
    return {
      ok: false,
      fetched: 0,
      provider,
      reason: "imap_credentials_missing",
    };
  }

  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    const mod = await import("imapflow");
    ImapFlow = mod.ImapFlow;
  } catch {
    return {
      ok: true,
      stub: true,
      fetched: 0,
      provider,
      reason: "imapflow_unavailable",
    };
  }

  const password = decryptSecret(creds.passwordEnc);
  const client = new ImapFlow({
    host: creds.imapHost,
    port: creds.imapPort,
    secure: creds.imapSecure,
    auth: { user: creds.emailAddress, pass: password },
    logger: false,
  });

  const maxResults = Math.min(Math.max(input.maxResults ?? 25, 1), 50);
  let fetched = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const exists = client.mailbox && "exists" in client.mailbox
        ? Number(client.mailbox.exists)
        : 0;
      if (exists <= 0) {
        return { ok: true, fetched: 0, provider };
      }
      const start = Math.max(1, exists - maxResults + 1);
      for await (const msg of client.fetch(`${start}:*`, {
        envelope: true,
        uid: true,
      })) {
        const uid = msg.uid;
        if (!uid) continue;
        const env = msg.envelope;
        const fromAddress =
          env?.from?.[0]?.address ||
          env?.from?.[0]?.name ||
          "unknown";
        const toAddresses = (env?.to ?? [])
          .map((a) => a.address)
          .filter((a): a is string => Boolean(a));
        const subject = env?.subject?.trim() || "(no subject)";
        const receivedAt = env?.date ? new Date(env.date) : new Date();
        const externalId = `imap:${uid}`;

        await prisma.message.upsert({
          where: {
            mailboxId_gmailId: {
              mailboxId: input.mailboxId,
              gmailId: externalId,
            },
          },
          create: {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            mailboxId: input.mailboxId,
            gmailId: externalId,
            threadId: null,
            fromAddress,
            toAddresses,
            subject,
            snippet: null,
            receivedAt,
            isRead: true,
            metadata: { provider, imapUid: uid },
          },
          update: {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            fromAddress,
            toAddresses,
            subject,
            receivedAt,
            metadata: { provider, imapUid: uid },
          },
        });
        fetched += 1;
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      fetched,
      provider,
      reason:
        err instanceof Error ? `imap_sync_failed:${err.message}` : "imap_sync_failed",
    };
  }

  await prisma.mailbox.updateMany({
    where: {
      id: input.mailboxId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
    },
    data: {
      lastSyncedAt: new Date(),
      connectionStatus: "connected",
    },
  });

  await writeAuditLog({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    mailboxId: input.mailboxId,
    actorId: input.userId,
    action: "SYSTEM",
    summary: `Synced ${fetched} IMAP message header(s) (never auto-send)`,
    resourceType: "mailbox",
    resourceId: input.mailboxId,
    metadata: { fetched, operations: [...IMAP_SYNC_ALLOWED_OPERATIONS] },
  });

  return { ok: true, fetched, provider };
}
