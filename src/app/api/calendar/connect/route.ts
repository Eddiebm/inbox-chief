import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  buildCalendarConsentUrl,
  GOOGLE_CALENDAR_READONLY_SCOPE,
} from "@/lib/calendar";
import { signGmailOAuthState } from "@/lib/gmail/oauth-state";
import { resolveUserGmailScope } from "@/lib/gmail/tenant-context";

export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json(
      { ok: false, message: "Sign in to connect Calendar." },
      { status: 401 },
    );
  }
  const scope = await resolveUserGmailScope(user.id);
  if (!scope) {
    return NextResponse.json(
      { ok: false, message: "Connect Gmail first, then connect Calendar separately." },
      { status: 403 },
    );
  }
  const state = await signGmailOAuthState({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    nonce: randomBytes(16).toString("hex"),
    returnTo: "/dashboard/settings",
    purpose: "calendar",
  });
  return NextResponse.json({
    ok: true,
    url: buildCalendarConsentUrl(state),
    scopes: [GOOGLE_CALENDAR_READONLY_SCOPE],
  });
}
