import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  emptyCallMinuteUsage,
  loadCallMinuteUsageForOrg,
} from "@/lib/billing/call-usage-server";
import { getDefaultPlan } from "@/lib/plans";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";

export const runtime = "nodejs";

/**
 * Call-in minute usage for the signed-in user's organization this billing period.
 * Soft cap: overage is allowed and metered; response includes plain + spoken warnings.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "authentication_required" },
      { status: 401 },
    );
  }

  if (user.id === "mock_user" || process.env.MOCK_INTEGRATIONS === "true") {
    const usage = emptyCallMinuteUsage(getDefaultPlan());
    return NextResponse.json({
      ok: true,
      isMock: true,
      usage,
      message:
        "Sign in with a real account to see call minutes used this billing period.",
    });
  }

  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    const usage = emptyCallMinuteUsage(getDefaultPlan());
    return NextResponse.json({
      ok: true,
      usage,
      message: "No workspace found for call usage.",
    });
  }

  try {
    const usage = await loadCallMinuteUsageForOrg(scope.organizationId);
    return NextResponse.json({
      ok: true,
      isMock: false,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      usage,
    });
  } catch (err) {
    console.error("[billing/usage]", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Could not load call usage",
      },
      { status: 500 },
    );
  }
}
