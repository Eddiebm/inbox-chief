import { NextResponse } from "next/server";
import {
  connectOutlookMailbox,
  syncOutlookMailbox,
} from "@/lib/outlook/client";
import { verifyOutlookOAuthState } from "@/lib/outlook/oauth-state";

function settingsRedirect(params: Record<string, string>) {
  const url = new URL(
    "/dashboard/settings",
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.CALL_IN_PUBLIC_BASE_URL?.trim() ||
      "https://inboxchief.email",
  );
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

/**
 * Microsoft OAuth callback — exchanges code, stores encrypted tokens, light-syncs metadata.
 * Register this exact path as MICROSOFT_REDIRECT_URI.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const error = searchParams.get("error");
  if (error) {
    return settingsRedirect({
      mailbox: "error",
      provider: "outlook",
      reason: error,
    });
  }

  const code = searchParams.get("code");
  const stateToken = searchParams.get("state");
  if (!code || !stateToken) {
    return settingsRedirect({
      mailbox: "error",
      provider: "outlook",
      reason: "missing_code_or_state",
    });
  }

  try {
    const state = await verifyOutlookOAuthState(stateToken);
    const connected = await connectOutlookMailbox({
      organizationId: state.organizationId,
      workspaceId: state.workspaceId,
      userId: state.userId,
      mailboxId: state.mailboxId,
      authorizationCode: code,
    });

    if (!connected.ok || !connected.mailboxId) {
      return settingsRedirect({
        mailbox: "error",
        provider: "outlook",
        reason: connected.reason ?? "connect_failed",
      });
    }

    try {
      await syncOutlookMailbox({
        organizationId: state.organizationId,
        workspaceId: state.workspaceId,
        mailboxId: connected.mailboxId,
        userId: state.userId,
        maxResults: 25,
      });
    } catch (syncError) {
      console.error("outlook_light_sync_failed", syncError);
    }

    return settingsRedirect({
      mailbox: "connected",
      provider: "outlook",
      email: connected.emailAddress ?? "",
    });
  } catch (err) {
    console.error("outlook_oauth_callback_failed", err);
    return settingsRedirect({
      mailbox: "error",
      provider: "outlook",
      reason: "callback_failed",
    });
  }
}
