import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";
import { buildOutlookConsentUrl } from "@/lib/outlook/client";
import { getOutlookOAuthConfig } from "@/lib/outlook/config";
import { signOutlookOAuthState } from "@/lib/outlook/oauth-state";
import { OUTLOOK_OAUTH_SCOPES } from "@/lib/outlook/scopes";

/**
 * Starts Outlook / Microsoft 365 OAuth.
 * Requires MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_REDIRECT_URI.
 * Scopes: Mail.Read + Mail.Send only. Never auto-sends.
 */
async function startConnect() {
  const config = getOutlookOAuthConfig();
  if (!config.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: config.reason,
        message: config.message,
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
        message: "Sign in with a real account before connecting Outlook.",
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

  const state = await signOutlookOAuthState({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    nonce: randomBytes(16).toString("hex"),
  });

  const url = buildOutlookConsentUrl(state);

  return NextResponse.json({
    ok: true,
    url,
    scopes: [...OUTLOOK_OAUTH_SCOPES],
  });
}

export async function GET() {
  return startConnect();
}

export async function POST() {
  return startConnect();
}
