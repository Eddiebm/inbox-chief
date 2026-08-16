import {
  demoMailboxSnapshot,
  mailboxNotConnectedSnapshot,
  mailboxNeedsReconnectSnapshot,
  speakEmptyPrimaryInbox,
  unrecognizedCallerSnapshot,
  type CallInMailboxSnapshot,
} from "@/lib/call-in/assistant";
import {
  buildReadableEmailsWithAttachments,
  type MessageRowForCallIn,
} from "@/lib/call-in/attachment-enrichment";
import {
  loadNewPrimaryCount,
  speakNewPrimaryCount,
} from "@/lib/call-in/new-primary-count";
import { filterMessagesByInboxScope } from "@/lib/call-in/primary-inbox";
import { isGmailAuthFailure } from "@/lib/gmail/auth-errors";
import { product } from "@/lib/product";
import type { PrismaClient } from "@/generated/prisma/client";
import { upsertDerivedContacts } from "@/lib/contacts";

export type ResolvedCallInIdentity = {
  snapshot: CallInMailboxSnapshot;
  matched: boolean;
  phoneE164: string | null;
  callInIdentityId: string | null;
  /** Matched CallInIdentity.userId — used for voice-tier preference. */
  userId: string | null;
  source: "call_in_identity" | "demo" | "unrecognized";
};

const STALE_SYNC_MS = 15 * 60 * 1000;
/**
 * How many recent rows to classify per call. Bodies are NOT loaded here —
 * a newsletter-heavy mailbox needs a wide window before Primary shows up.
 */
const CALL_IN_MESSAGE_SCAN_TAKE = 200;
/** How many Primary messages the caller can walk through with "next" per call. */
export const CALL_IN_READABLE_PRIMARY_LIMIT = 20;
/** Opt-in "read promotions" depth. */
const CALL_IN_READABLE_NON_PRIMARY_LIMIT = 10;

/** Classification pass: everything except the (large) message body. */
const messageScanSelectForCallIn = {
  id: true,
  gmailId: true,
  subject: true,
  fromAddress: true,
  snippet: true,
  metadata: true,
  categoryName: true,
  receivedAt: true,
  isRead: true,
} as const;

type ScannedMessageRow = {
  id: string;
  gmailId: string;
  subject: string;
  fromAddress: string;
  snippet: string | null;
  metadata: unknown;
  categoryName: string | null;
  receivedAt: Date;
  isRead: boolean;
};

/** Structural subset used here so tests can pass a stub instead of a real client. */
type PrismaLikeForCallIn = {
  message: Pick<PrismaClient["message"], "findMany">;
};

/**
 * Load the readable Primary window newest-first.
 *
 * Reads deliberately do NOT filter on needsAttention: unread is a triage hint,
 * and gating on it collapsed the list to a single message whenever the newest
 * unread mail was promotional.
 */
export async function loadCallInReadableWindow(input: {
  prisma: PrismaLikeForCallIn;
  tenantFilter: Record<string, string>;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
}): Promise<{
  readableEmails: Awaited<ReturnType<typeof buildReadableEmailsWithAttachments>>;
  readableEmailsNonPrimary: Awaited<
    ReturnType<typeof buildReadableEmailsWithAttachments>
  >;
  skippedNonPrimaryCount: number;
  primaryMessageCount: number;
  unreadPrimaryCount: number;
}> {
  const scanned = (await input.prisma.message.findMany({
    where: input.tenantFilter,
    orderBy: { receivedAt: "desc" },
    take: CALL_IN_MESSAGE_SCAN_TAKE,
    select: messageScanSelectForCallIn,
  })) as ScannedMessageRow[];

  const primary = filterMessagesByInboxScope(scanned, "primary");
  const nonPrimary = filterMessagesByInboxScope(scanned, "promotions");
  const primaryRows = primary.kept.slice(0, CALL_IN_READABLE_PRIMARY_LIMIT);
  const nonPrimaryRows = nonPrimary.kept.slice(
    0,
    CALL_IN_READABLE_NON_PRIMARY_LIMIT,
  );

  // Bodies only for what can actually be spoken this call.
  const bodyIds = [...primaryRows, ...nonPrimaryRows].map((m) => m.id);
  const bodies = bodyIds.length
    ? ((await input.prisma.message.findMany({
        where: { ...input.tenantFilter, id: { in: bodyIds } },
        select: { id: true, bodyText: true },
      })) as Array<{ id: string; bodyText: string | null }>)
    : [];
  const bodyById = new Map(bodies.map((row) => [row.id, row.bodyText]));

  const withBody = (rows: ScannedMessageRow[]): MessageRowForCallIn[] =>
    rows.map((m) => ({
      id: m.id,
      gmailId: m.gmailId,
      fromAddress: m.fromAddress,
      subject: m.subject,
      snippet: m.snippet,
      bodyText: bodyById.get(m.id) ?? null,
      metadata: m.metadata,
      categoryName: m.categoryName,
      receivedAt: m.receivedAt,
    }));

  // Attachment bytes are fetched lazily, per email, as the caller says "next".
  const [readableEmails, readableEmailsNonPrimary] = await Promise.all([
    buildReadableEmailsWithAttachments({
      messages: withBody(primaryRows),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      userId: input.userId,
      fetchAttachmentBodies: false,
    }),
    buildReadableEmailsWithAttachments({
      messages: withBody(nonPrimaryRows),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      userId: input.userId,
      fetchAttachmentBodies: false,
    }),
  ]);

  return {
    readableEmails,
    readableEmailsNonPrimary,
    skippedNonPrimaryCount: primary.skippedNonPrimaryCount,
    primaryMessageCount: primary.kept.length,
    unreadPrimaryCount: primary.kept.filter((m) => !m.isRead).length,
  };
}

/** Normalize caller phones to E.164 when possible (US 10-digit → +1…). */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip SIP/tel URIs and extras from carriers / VAPI
  trimmed = trimmed.replace(/^(sip|sips|tel):/i, "");
  trimmed = trimmed.split(";")[0]?.split("?")[0]?.trim() ?? trimmed;
  if (/^client:/i.test(trimmed) || /^anonymous$/i.test(trimmed)) return null;
  // Already clean E.164
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  // International 00 prefix (e.g. 0014055106989)
  if (digits.startsWith("00") && digits.length >= 10) {
    digits = digits.slice(2);
  }
  // US NANP: 10 digits or 11 with leading country code 1
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Formatted E.164 with spaces/dashes (e.g. "+1 405 510 6989")
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/**
 * Alternate phone forms that may appear in CallInIdentity or VAPI payloads.
 * Lookup should match any of these against stored phoneE164.
 */
export function phoneE164Candidates(raw: string | null | undefined): string[] {
  const primary = normalizePhoneE164(raw);
  if (!primary) return [];
  const digits = primary.replace(/\D/g, "");
  const out = new Set<string>([primary]);
  out.add(digits);
  if (digits.length === 11 && digits.startsWith("1")) {
    const ten = digits.slice(1);
    out.add(ten);
    out.add(`+${digits}`);
    out.add(`+1${ten}`);
    out.add(`1${ten}`);
  } else if (digits.length === 10) {
    out.add(`+1${digits}`);
    out.add(`1${digits}`);
  }
  return [...out];
}

/**
 * Map inbound caller phone → CallInIdentity / tenant snapshot.
 * - MOCK_INTEGRATIONS=true → demo snapshot (local UX only)
 * - Unmatched / no phone → unrecognized (never invent demo emails in prod)
 * Loads subject/from/snippet/bodyText so voice can read emails aloud (never sends).
 */
export async function resolveSnapshotForCaller(
  callerPhone: string | null | undefined,
): Promise<ResolvedCallInIdentity> {
  const phoneE164 = normalizePhoneE164(callerPhone);

  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
    return {
      snapshot: demoMailboxSnapshot("there"),
      matched: false,
      phoneE164,
      callInIdentityId: null,
      userId: null,
      source: "demo",
    };
  }

  if (!phoneE164) {
    return {
      snapshot: unrecognizedCallerSnapshot(),
      matched: false,
      phoneE164: null,
      callInIdentityId: null,
      userId: null,
      source: "unrecognized",
    };
  }

  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();
    const candidates = phoneE164Candidates(callerPhone);
    const identity = await prisma.callInIdentity.findFirst({
      where: { phoneE164: { in: candidates }, enabled: true },
      orderBy: { updatedAt: "desc" },
    });

    if (!identity) {
      console.info("[call-in] identity unmatched", {
        callerPhone,
        phoneE164,
        candidates,
      });
      return {
        snapshot: unrecognizedCallerSnapshot(),
        matched: false,
        phoneE164,
        callInIdentityId: null,
        userId: null,
        source: "unrecognized",
      };
    }

    console.info("[call-in] identity matched", {
      phoneE164: identity.phoneE164,
      callInIdentityId: identity.id,
      organizationId: identity.organizationId,
    });

    const user = await prisma.user.findUnique({
      where: { id: identity.userId },
      select: { firstName: true, preferredName: true, email: true },
    });
    const firstName =
      user?.preferredName?.trim() ||
      user?.firstName?.trim() ||
      "there";

    const mailbox = identity.mailboxId
      ? await prisma.mailbox.findFirst({
          where: {
            id: identity.mailboxId,
            organizationId: identity.organizationId,
            workspaceId: identity.workspaceId,
          },
          select: {
            id: true,
            emailAddress: true,
            connectionStatus: true,
            lastSyncedAt: true,
            provider: true,
          },
        })
      : await prisma.mailbox.findFirst({
          where: {
            organizationId: identity.organizationId,
            workspaceId: identity.workspaceId,
            ownerId: identity.userId,
          },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            emailAddress: true,
            connectionStatus: true,
            lastSyncedAt: true,
            provider: true,
          },
        });

    const mailboxId = mailbox?.id ?? identity.mailboxId ?? "unknown_mb";
    const tenantFilter = {
      organizationId: identity.organizationId,
      workspaceId: identity.workspaceId,
      ...(mailbox?.id ? { mailboxId: mailbox.id } : {}),
    };

    let connectionStatus = mapConnectionStatus(mailbox?.connectionStatus);
    const mailboxEmail = mailbox?.emailAddress ?? user?.email ?? "your mailbox";

    if (connectionStatus === "error") {
      return {
        snapshot: mailboxNeedsReconnectSnapshot(firstName, mailboxEmail),
        matched: true,
        phoneE164,
        callInIdentityId: identity.id,
        userId: identity.userId,
        source: "call_in_identity",
      };
    }

    // Connected mailbox with no/stale sync → refresh real Gmail before speaking.
    if (
      mailbox?.id &&
      connectionStatus === "connected" &&
      (mailbox.provider ?? "gmail") === "gmail"
    ) {
      const totalMessages = await prisma.message.count({ where: tenantFilter });
      const stale =
        !mailbox.lastSyncedAt ||
        Date.now() - mailbox.lastSyncedAt.getTime() > STALE_SYNC_MS;
      if (totalMessages === 0 || stale) {
        try {
          connectionStatus = "syncing";
          const { syncMailbox } = await import("@/lib/gmail/client");
          const syncResult = await syncMailbox({
            organizationId: identity.organizationId,
            workspaceId: identity.workspaceId,
            mailboxId: mailbox.id,
            userId: identity.userId,
            suppressOutboundAlert: true,
          });
          if (!syncResult.ok && needsReconnectReason(syncResult.reason)) {
            return {
              snapshot: mailboxNeedsReconnectSnapshot(firstName, mailboxEmail),
              matched: true,
              phoneE164,
              callInIdentityId: identity.id,
              userId: identity.userId,
              source: "call_in_identity",
            };
          }
          connectionStatus = syncResult.ok
            ? "connected"
            : mapConnectionStatus(mailbox.connectionStatus);
        } catch (syncErr) {
          console.warn("[call-in] mailbox sync during resolve failed", syncErr);
          if (isGmailAuthFailure(syncErr)) {
            return {
              snapshot: mailboxNeedsReconnectSnapshot(firstName, mailboxEmail),
              matched: true,
              phoneE164,
              callInIdentityId: identity.id,
              userId: identity.userId,
              source: "call_in_identity",
            };
          }
          connectionStatus = mapConnectionStatus(mailbox.connectionStatus);
        }
      }
    }

    const [draftsAwaitingReview, approvalsPending, followUpsDue] =
      await Promise.all([
        prisma.draft.count({
          where: {
            ...tenantFilter,
            status: { in: ["GENERATED", "EDITING"] },
          },
        }),
        prisma.draft.count({
          where: { ...tenantFilter, status: "AWAITING_APPROVAL" },
        }),
        prisma.followUp.count({
          where: {
            ...tenantFilter,
            completedAt: null,
            dueAt: { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
          },
        }),
      ]);

    const briefing = await prisma.dailyBriefing.findFirst({
      where: {
        organizationId: identity.organizationId,
        workspaceId: identity.workspaceId,
        ownerId: identity.userId,
      },
      orderBy: { generatedAt: "desc" },
      select: { content: true },
    });

    const securityNote =
      connectionStatus === "connected"
        ? `${product.name} is linked to ${mailboxEmail}. I read your Primary inbox aloud on this call — nothing sends without app approval.`
        : connectionStatus === "syncing"
          ? `${product.name} is syncing ${mailboxEmail}. Ask again in a moment for your real inbox.`
          : `${product.name} mailbox connection is ${connectionStatus}. Link email in Settings when ready.`;

    const scoped = await loadCallInReadableWindow({
      prisma,
      tenantFilter,
      organizationId: identity.organizationId,
      workspaceId: identity.workspaceId,
      mailboxId: mailbox?.id ?? mailboxId,
      userId: identity.userId,
    });
    await upsertDerivedContacts({
      prisma,
      organizationId: identity.organizationId,
      workspaceId: identity.workspaceId,
      mailboxId: mailbox?.id ?? mailboxId,
      addresses: [...scoped.readableEmails, ...scoped.readableEmailsNonPrimary],
    });
    const newPrimaryCount = await loadNewPrimaryCount({
      prisma,
      tenantFilter,
      since: identity.lastSuccessfulCallAt,
    });
    const isFirstSuccessfulCall = identity.lastSuccessfulCallAt == null;

    const attentionCount = scoped.unreadPrimaryCount;

    const snapshot: CallInMailboxSnapshot = {
      organizationId: identity.organizationId,
      workspaceId: identity.workspaceId,
      mailboxId,
      ownerFirstName: firstName,
      mailboxEmail,
      connectionStatus,
      identityStatus: connectionStatus === "syncing" ? "syncing" : "matched",
      needingAttention: attentionCount,
      draftsAwaitingReview,
      approvalsPending,
      followUpsDue,
      upcomingDeadlines: [],
      briefing:
        briefing?.content?.trim() ||
        (scoped.readableEmails.length === 0
          ? connectionStatus === "connected"
            ? speakEmptyPrimaryInbox(scoped.skippedNonPrimaryCount)
            : `Mailbox status: ${connectionStatus}.`
          : speakReadableInboxDepth(
              scoped.readableEmails.length,
              attentionCount,
            )),
      recentSubjects: scoped.readableEmails.map((m) => m.subject).filter(Boolean),
      readableEmails: scoped.readableEmails,
      readableEmailsNonPrimary: scoped.readableEmailsNonPrimary,
      skippedNonPrimaryCount: scoped.skippedNonPrimaryCount,
      securityNote,
      matchedPhoneE164: identity.phoneE164,
      newPrimaryCount,
      lastSuccessfulCallAt: identity.lastSuccessfulCallAt?.toISOString() ?? null,
      isFirstSuccessfulCall,
      newPrimaryAnnouncement: speakNewPrimaryCount({
        count: newPrimaryCount,
        isFirstCall: isFirstSuccessfulCall,
      }),
    };

    return {
      snapshot,
      matched: true,
      phoneE164,
      callInIdentityId: identity.id,
      userId: identity.userId,
      source: "call_in_identity",
    };
  } catch (err) {
    console.warn("[call-in] identity resolve failed; refusing demo emails", err);
    return {
      snapshot: unrecognizedCallerSnapshot(),
      matched: false,
      phoneE164,
      callInIdentityId: null,
      userId: null,
      source: "unrecognized",
    };
  }
}

/**
 * Build a call-in snapshot for a signed-in web user (Ask anytime panel).
 * Uses their mailbox — never demo fixtures when a real mailbox exists.
 */
export async function resolveSnapshotForUser(
  userId: string,
  preferredName?: string,
): Promise<CallInMailboxSnapshot> {
  if (
    !userId ||
    userId === "mock_user" ||
    process.env.MOCK_INTEGRATIONS === "true" ||
    !process.env.DATABASE_URL
  ) {
    return demoMailboxSnapshot(preferredName ?? "there");
  }

  try {
    const { resolveUserMailboxScope } = await import("@/lib/mail/tenant-context");
    const scope = await resolveUserMailboxScope(userId);
    if (!scope) {
      return mailboxNotConnectedSnapshot(preferredName ?? "there");
    }

    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();
    const mailbox = await prisma.mailbox.findFirst({
      where: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: userId,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        emailAddress: true,
        connectionStatus: true,
        lastSyncedAt: true,
        provider: true,
      },
    });

    if (!mailbox) {
      return mailboxNotConnectedSnapshot(preferredName ?? "there");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, preferredName: true, email: true },
    });
    const firstName =
      preferredName?.trim() ||
      user?.preferredName?.trim() ||
      user?.firstName?.trim() ||
      user?.email?.split("@")[0] ||
      "there";

    const tenantFilter = {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: mailbox.id,
    };

    let connectionStatus = mapConnectionStatus(mailbox.connectionStatus);

    if (connectionStatus === "error") {
      return mailboxNeedsReconnectSnapshot(firstName, mailbox.emailAddress);
    }

    if (
      connectionStatus === "connected" &&
      (mailbox.provider ?? "gmail") === "gmail"
    ) {
      const totalMessages = await prisma.message.count({ where: tenantFilter });
      const stale =
        !mailbox.lastSyncedAt ||
        Date.now() - mailbox.lastSyncedAt.getTime() > STALE_SYNC_MS;
      if (totalMessages === 0 || stale) {
        try {
          connectionStatus = "syncing";
          const { syncMailbox } = await import("@/lib/gmail/client");
          const syncResult = await syncMailbox({
            organizationId: scope.organizationId,
            workspaceId: scope.workspaceId,
            mailboxId: mailbox.id,
            userId,
            suppressOutboundAlert: true,
          });
          if (!syncResult.ok && needsReconnectReason(syncResult.reason)) {
            return mailboxNeedsReconnectSnapshot(
              firstName,
              mailbox.emailAddress,
            );
          }
          connectionStatus = syncResult.ok
            ? "connected"
            : mapConnectionStatus(mailbox.connectionStatus);
        } catch (syncErr) {
          console.warn("[call-in] web ask mailbox sync failed", syncErr);
          if (isGmailAuthFailure(syncErr)) {
            return mailboxNeedsReconnectSnapshot(
              firstName,
              mailbox.emailAddress,
            );
          }
          connectionStatus = mapConnectionStatus(mailbox.connectionStatus);
        }
      }
    }

    const [draftsAwaitingReview, approvalsPending, followUpsDue, scoped] =
      await Promise.all([
        prisma.draft.count({
          where: {
            ...tenantFilter,
            status: { in: ["GENERATED", "EDITING"] },
          },
        }),
        prisma.draft.count({
          where: { ...tenantFilter, status: "AWAITING_APPROVAL" },
        }),
        prisma.followUp.count({
          where: {
            ...tenantFilter,
            completedAt: null,
            dueAt: { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
          },
        }),
        loadCallInReadableWindow({
          prisma,
          tenantFilter,
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          mailboxId: mailbox.id,
          userId,
        }),
      ]);

    const attentionCount = scoped.unreadPrimaryCount;

    await upsertDerivedContacts({
      prisma,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: mailbox.id,
      addresses: [...scoped.readableEmails, ...scoped.readableEmailsNonPrimary],
    });

    return {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: mailbox.id,
      ownerFirstName: firstName,
      mailboxEmail: mailbox.emailAddress,
      connectionStatus,
      identityStatus: connectionStatus === "syncing" ? "syncing" : "matched",
      needingAttention: attentionCount,
      draftsAwaitingReview,
      approvalsPending,
      followUpsDue,
      upcomingDeadlines: [],
      briefing:
        scoped.readableEmails.length === 0
          ? connectionStatus === "connected"
            ? speakEmptyPrimaryInbox(scoped.skippedNonPrimaryCount)
            : `Mailbox status: ${connectionStatus}.`
          : speakReadableInboxDepth(
              scoped.readableEmails.length,
              attentionCount,
            ),
      recentSubjects: scoped.readableEmails.map((m) => m.subject).filter(Boolean),
      readableEmails: scoped.readableEmails,
      readableEmailsNonPrimary: scoped.readableEmailsNonPrimary,
      skippedNonPrimaryCount: scoped.skippedNonPrimaryCount,
      securityNote: `${product.name} is linked to ${mailbox.emailAddress}. Nothing sends without app approval.`,
    };
  } catch (err) {
    console.warn("[call-in] resolveSnapshotForUser failed", err);
    return mailboxNotConnectedSnapshot(preferredName ?? "there");
  }
}

/** Sync failures that mean the patron must reconnect Gmail — never read stale mail. */
export function needsReconnectReason(reason: string | undefined): boolean {
  return reason === "needs_reconnect" || reason === "mailbox_token_missing";
}

/** Announce how many Primary messages the caller can walk through this call. */
export function speakReadableInboxDepth(
  readableCount: number,
  unreadCount: number,
): string {
  const plural = readableCount === 1 ? "" : "s";
  const unreadPart =
    unreadCount > 0 ? ` ${unreadCount} of them ${unreadCount === 1 ? "is" : "are"} unread.` : "";
  return `${readableCount} Primary message${plural} ready to read.${unreadPart} I read them one at a time — from, subject, when it arrived, the full text, then any attachments. Say continue for the rest of a long message, or next at any time for the following email.`;
}

function mapConnectionStatus(
  status: string | null | undefined,
): CallInMailboxSnapshot["connectionStatus"] {
  const s = (status ?? "").toLowerCase();
  if (s === "connected" || s === "ok" || s === "active") return "connected";
  if (s === "syncing" || s === "pending") return "syncing";
  if (s === "error" || s === "failed") return "error";
  return "disconnected";
}
