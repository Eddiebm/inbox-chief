import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { loadCallMinuteUsageForOrg } from "@/lib/billing/call-usage-server";
import { emptyCallMinuteUsage } from "@/lib/billing/call-usage";
import { loadCallCostTallyForUser } from "@/lib/call-in/call-cost";
import { aggregateCallCostTally } from "@/lib/call-in/call-cost-format";
import { getDefaultPlan } from "@/lib/plans";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";

export const runtime = "nodejs";

/**
 * Running phone call-in cost tally + minute usage for the signed-in user (tenant-scoped).
 * Amounts are USD from VAPI; minutes come from CallSession.durationSeconds.
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
    const empty = aggregateCallCostTally([]);
    const usage = emptyCallMinuteUsage(getDefaultPlan());
    return NextResponse.json({
      ok: true,
      isMock: true,
      tally: empty,
      usage,
      message: "Sign in with a real account to see phone call costs.",
    });
  }

  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    const empty = aggregateCallCostTally([]);
    const usage = emptyCallMinuteUsage(getDefaultPlan());
    return NextResponse.json({
      ok: true,
      tally: empty,
      usage,
      message: "No workspace found for call cost tally.",
    });
  }

  try {
    const [tally, usage] = await Promise.all([
      loadCallCostTallyForUser({
        organizationId: scope.organizationId,
        userId: user.id,
      }),
      loadCallMinuteUsageForOrg(scope.organizationId),
    ]);
    return NextResponse.json({
      ok: true,
      isMock: false,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      tally,
      usage,
    });
  } catch (err) {
    console.error("[call-in/costs]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Could not load call costs",
      },
      { status: 500 },
    );
  }
}
