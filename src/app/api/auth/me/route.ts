import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";
import { isOperatorEmail } from "@/lib/operator";

/**
 * Current session summary for Settings / account panels.
 * Never invents demo_org or mock@ for real users.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, authenticated: false, reason: "authentication_required" },
      { status: 401 },
    );
  }

  const isMock = user.id === "mock_user";
  if (isMock) {
    return NextResponse.json({
      ok: true,
      authenticated: true,
      isMock: true,
      isOperator: false,
      email: null,
      preferredName: null,
      organizationId: null,
      message: "Demo session — connect a real account",
    });
  }

  const scope = await resolveUserMailboxScope(user.id);
  const email = user.email?.trim() || null;
  const isOperator = isOperatorEmail(email);

  return NextResponse.json({
    ok: true,
    authenticated: true,
    isMock: false,
    isOperator,
    email,
    preferredName:
      user.preferredName?.trim() || user.firstName?.trim() || null,
    organizationId: scope?.organizationId ?? null,
    workspaceId: scope?.workspaceId ?? null,
  });
}
