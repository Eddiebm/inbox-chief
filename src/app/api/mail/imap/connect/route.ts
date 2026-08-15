import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { connectImapMailbox, validateImapConnectInput } from "@/lib/imap/client";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";
import { getImapPreset } from "@/lib/mail/providers/presets";
import type { ProviderId } from "@/lib/mail/providers/types";

type ImapConnectBody = {
  provider?: "yahoo" | "icloud" | "imap";
  emailAddress?: string;
  password?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  mailboxId?: string;
};

/**
 * Connect Yahoo / iCloud / generic IMAP with encrypted credential storage.
 * Never auto-sends. Validates hosts/ports; probes IMAP login when Node+imapflow allow.
 */
export async function POST(request: Request) {
  if (process.env.MOCK_INTEGRATIONS === "true") {
    return NextResponse.json(
      {
        ok: false,
        reason: "mock_integrations_enabled",
        message:
          "IMAP connect is disabled while MOCK_INTEGRATIONS=true. Set MOCK_INTEGRATIONS=false to store credentials.",
      },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json(
      {
        ok: false,
        reason: "authentication_required",
        message: "Sign in with a real account before connecting IMAP mail.",
      },
      { status: 401 },
    );
  }

  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    return NextResponse.json(
      {
        ok: false,
        reason: "mailbox_scope_unavailable",
        message:
          "No workspace with mailbox access was found for your account. Complete signup/onboarding first.",
      },
      { status: 403 },
    );
  }

  let body: ImapConnectBody;
  try {
    body = (await request.json()) as ImapConnectBody;
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_json", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const provider = body.provider ?? "imap";
  if (provider !== "yahoo" && provider !== "icloud" && provider !== "imap") {
    return NextResponse.json(
      {
        ok: false,
        reason: "provider_invalid",
        message: "provider must be yahoo, icloud, or imap.",
      },
      { status: 400 },
    );
  }

  const preset = getImapPreset(provider);
  const input = {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    mailboxId: body.mailboxId,
    provider,
    emailAddress: body.emailAddress ?? "",
    password: body.password ?? "",
    imapHost: body.imapHost ?? preset.imapHost,
    imapPort: body.imapPort ?? preset.imapPort,
    imapSecure: body.imapSecure ?? preset.imapSecure,
    smtpHost: body.smtpHost ?? preset.smtpHost,
    smtpPort: body.smtpPort ?? preset.smtpPort,
    smtpSecure: body.smtpSecure ?? preset.smtpSecure,
  };

  const validation = validateImapConnectInput(input);
  if (!validation.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: validation.reason,
        message: validation.message,
      },
      { status: 400 },
    );
  }

  try {
    const result = await connectImapMailbox(input);
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: result.reason,
          message: result.reason ?? "IMAP connect failed",
          provider: result.provider as ProviderId,
        },
        { status: result.reason === "imap_auth_failed" ? 401 : 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      connected: true,
      stub: result.stub ?? false,
      connectionStatus: result.connectionStatus,
      emailAddress: result.emailAddress,
      mailboxId: result.mailboxId,
      provider: result.provider,
      reason: result.reason,
      message: result.stub
        ? "Credentials stored encrypted. IMAP login probe was skipped or unavailable in this runtime; sync runs on Node with imapflow."
        : "Mailbox connected. Credentials are encrypted at rest. Mail is never sent without your approval.",
    });
  } catch (err) {
    console.error("imap_connect_failed", err);
    return NextResponse.json(
      {
        ok: false,
        reason: "connect_failed",
        message: "Could not store IMAP credentials. Please try again.",
      },
      { status: 500 },
    );
  }
}
