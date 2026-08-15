import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { humanizeMailboxConnectReason } from "@/lib/mail/connect-errors";
import { buildGmailConsentUrl } from "@/lib/gmail/client";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import {
  sanitizeGmailReturnTo,
  signGmailOAuthState,
} from "@/lib/gmail/oauth-state";
import { resolveUserGmailScope } from "@/lib/gmail/tenant-context";
import { GMAIL_OAUTH_SCOPES } from "@/lib/gmail/scopes";

/**
 * Starts Gmail OAuth. Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI.
 * Scopes: gmail.readonly + gmail.send only. Never auto-sends.
 * Optional query: returnTo=/onboarding | /dashboard/settings
 */
async function startConnect(request: Request) {
  const config = getGmailOAuthConfig();
  if (!config.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: config.reason === "google_credentials_missing"
          ? "gmail_not_configured"
          : config.reason,
        message: humanizeMailboxConnectReason(
          config.reason === "google_credentials_missing"
            ? "gmail_not_configured"
            : config.reason,
        ),
      },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json(
      {
        ok: false,
        reason: user ? "mock_session" : "authentication_required",
        message: humanizeMailboxConnectReason(
          user ? "mock_session" : "authentication_required",
        ),
      },
      { status: 401 },
    );
  }

  const scope = await resolveUserGmailScope(user.id);
  if (!scope) {
    return NextResponse.json(
      {
        ok: false,
        reason: "mailbox_scope_unavailable",
        message: humanizeMailboxConnectReason("mailbox_scope_unavailable"),
      },
      { status: 403 },
    );
  }

  const urlObj = new URL(request.url);
  const returnTo = sanitizeGmailReturnTo(urlObj.searchParams.get("returnTo"));

  const state = await signGmailOAuthState({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    nonce: randomBytes(16).toString("hex"),
    returnTo,
  });

  const url = buildGmailConsentUrl(state);

  if (urlObj.searchParams.get("redirect") === "1") {
    return NextResponse.redirect(url);
  }

  return NextResponse.json({
    ok: true,
    url,
    scopes: [...GMAIL_OAUTH_SCOPES],
  });
}

export async function GET(request: Request) {
  return startConnect(request);
}

export async function POST(request: Request) {
  return startConnect(request);
}
