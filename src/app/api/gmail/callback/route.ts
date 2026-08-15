import { NextResponse } from "next/server";
import { connectMailbox, syncMailbox } from "@/lib/gmail/client";
import { verifyGmailOAuthState } from "@/lib/gmail/oauth-state";
import { markProvisioningConnected } from "@/lib/provisioning";

function appOrigin() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.CALL_IN_PUBLIC_BASE_URL?.trim() ||
    "https://inbox-chief-kappa.vercel.app"
  );
}

function oauthRedirect(
  path: string,
  params: Record<string, string>,
) {
  const url = new URL(path, appOrigin());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

/**
 * Google OAuth callback — exchanges code, stores encrypted tokens, light-syncs metadata.
 * Register this exact path as GOOGLE_REDIRECT_URI.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const error = searchParams.get("error");
  const stateTokenEarly = searchParams.get("state");

  let returnTo = "/dashboard/settings";
  if (stateTokenEarly) {
    try {
      const early = await verifyGmailOAuthState(stateTokenEarly);
      if (early.returnTo) returnTo = early.returnTo;
    } catch {
      /* keep default */
    }
  }

  if (error) {
    return oauthRedirect(returnTo, {
      gmail: "error",
      mailbox: "error",
      reason: error,
    });
  }

  const code = searchParams.get("code");
  const stateToken = searchParams.get("state");
  if (!code || !stateToken) {
    return oauthRedirect(returnTo, {
      gmail: "error",
      mailbox: "error",
      reason: "missing_code_or_state",
    });
  }

  try {
    const state = await verifyGmailOAuthState(stateToken);
    if (state.returnTo) returnTo = state.returnTo;

    const connected = await connectMailbox({
      organizationId: state.organizationId,
      workspaceId: state.workspaceId,
      userId: state.userId,
      mailboxId: state.mailboxId,
      authorizationCode: code,
    });

    if (!connected.ok || !connected.mailboxId) {
      return oauthRedirect(returnTo, {
        gmail: "error",
        mailbox: "error",
        reason: connected.reason ?? "connect_failed",
      });
    }

    await markProvisioningConnected({
      organizationId: state.organizationId,
      workspaceId: state.workspaceId,
      userId: state.userId,
      mailboxId: connected.mailboxId,
    });

    // Optional light sync — metadata only; never send.
    try {
      await syncMailbox({
        organizationId: state.organizationId,
        workspaceId: state.workspaceId,
        mailboxId: connected.mailboxId,
        userId: state.userId,
        maxResults: 25,
      });
    } catch (syncError) {
      console.error("gmail_light_sync_failed", syncError);
    }

    return oauthRedirect(returnTo, {
      gmail: "connected",
      mailbox: "connected",
      email: connected.emailAddress ?? "",
    });
  } catch (err) {
    console.error("gmail_oauth_callback_failed", err);
    return oauthRedirect(returnTo, {
      gmail: "error",
      mailbox: "error",
      reason: "callback_failed",
    });
  }
}
