/**
 * Server-side VAPI call cost persistence + tally loading.
 * Pure parse/format helpers live in call-cost-format.ts (client-safe).
 */

import {
  aggregateCallCostTally,
  parseVapiCallCost,
  type CallCostRow,
  type CallCostTally,
  type ParsedVapiCallCost,
} from "@/lib/call-in/call-cost-format";
import {
  planForUsageKey,
  resolveBillingPeriod,
} from "@/lib/billing/call-usage";
import { drawPurchasedMinutesForCall } from "@/lib/billing/call-usage-server";

export type {
  CallCostRow,
  CallCostTally,
  ParsedVapiCallCost,
} from "@/lib/call-in/call-cost-format";

export {
  aggregateCallCostTally,
  buildSpokenCallCostSummary,
  formatUsdPlain,
  parseVapiCallCost,
} from "@/lib/call-in/call-cost-format";

/** Fetch call details from VAPI when webhook omits cost. */
export async function fetchVapiCallCost(
  callId: string,
  apiKey = process.env.VAPI_API_KEY,
): Promise<ParsedVapiCallCost | null> {
  const key = apiKey?.trim();
  if (!key || !callId) return null;

  try {
    const res = await fetch(
      `https://api.vapi.ai/call/${encodeURIComponent(callId)}`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      console.warn("[call-cost] VAPI GET /call failed", callId, res.status);
      return null;
    }
    const body = (await res.json()) as unknown;
    const parsed = parseVapiCallCost(body);
    return {
      ...parsed,
      callId: parsed.callId ?? callId,
      costSource: parsed.costUsd != null ? "vapi_api" : null,
    };
  } catch (err) {
    console.warn("[call-cost] VAPI GET /call error", callId, err);
    return null;
  }
}

/**
 * Resolve cost for an end-of-call payload, falling back to VAPI API when needed.
 */
export async function resolveVapiCallCost(
  payload: unknown,
): Promise<ParsedVapiCallCost> {
  const fromWebhook = parseVapiCallCost(payload);
  if (fromWebhook.costUsd != null) {
    return { ...fromWebhook, costSource: "vapi_webhook" };
  }
  if (!fromWebhook.callId) return fromWebhook;

  const fromApi = await fetchVapiCallCost(fromWebhook.callId);
  if (!fromApi) return fromWebhook;

  return {
    callId: fromWebhook.callId,
    costUsd: fromApi.costUsd,
    durationSeconds: fromWebhook.durationSeconds ?? fromApi.durationSeconds,
    endedReason: fromWebhook.endedReason ?? fromApi.endedReason,
    summary: fromWebhook.summary ?? fromApi.summary,
    fromPhone: fromWebhook.fromPhone ?? fromApi.fromPhone,
    startedAt: fromWebhook.startedAt ?? fromApi.startedAt,
    endedAt: fromWebhook.endedAt ?? fromApi.endedAt,
    costBreakdown: fromWebhook.costBreakdown ?? fromApi.costBreakdown,
    costSource: fromApi.costUsd != null ? "vapi_api" : null,
  };
}

export type RecordCallCostResult = {
  recorded: boolean;
  reason?: string;
  sessionId?: string;
  costUsd?: number | null;
  callId?: string | null;
};

/**
 * Persist end-of-call cost onto CallSession, tenant-scoped via CallInIdentity.
 * Idempotent on providerCallSid when present.
 */
export async function recordVapiEndOfCallCost(
  payload: unknown,
): Promise<RecordCallCostResult> {
  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
    const parsed = parseVapiCallCost(payload);
    return {
      recorded: false,
      reason: "mock_or_no_database",
      callId: parsed.callId,
      costUsd: parsed.costUsd,
    };
  }

  const resolved = await resolveVapiCallCost(payload);
  const { normalizePhoneE164 } = await import("@/lib/call-in/identity");
  const phoneE164 = normalizePhoneE164(resolved.fromPhone);

  if (!phoneE164) {
    return {
      recorded: false,
      reason: "missing_caller_phone",
      callId: resolved.callId,
      costUsd: resolved.costUsd,
    };
  }

  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();

    const identity = await prisma.callInIdentity.findFirst({
      where: { phoneE164, enabled: true },
      orderBy: { updatedAt: "desc" },
    });

    if (!identity) {
      return {
        recorded: false,
        reason: "unmatched_caller",
        callId: resolved.callId,
        costUsd: resolved.costUsd,
      };
    }

    const endedAt = resolved.endedAt ?? new Date();
    const startedAt = resolved.startedAt ?? endedAt;
    const costBreakdownJson =
      resolved.costBreakdown == null
        ? undefined
        : (JSON.parse(JSON.stringify(resolved.costBreakdown)) as object);
    const data = {
      organizationId: identity.organizationId,
      workspaceId: identity.workspaceId,
      mailboxId: identity.mailboxId,
      userId: identity.userId,
      callInIdentityId: identity.id,
      channel: "PHONE" as const,
      status: "COMPLETED" as const,
      providerCallSid: resolved.callId,
      fromPhone: phoneE164,
      startedAt,
      endedAt,
      summary: resolved.summary,
      costUsd: resolved.costUsd,
      durationSeconds: resolved.durationSeconds,
      endedReason: resolved.endedReason,
      costSource: resolved.costSource,
      costBreakdown: costBreakdownJson,
    };

    if (resolved.callId) {
      const existing = await prisma.callSession.findFirst({
        where: {
          providerCallSid: resolved.callId,
          organizationId: identity.organizationId,
        },
        select: { id: true },
      });
      if (existing) {
        const updated = await prisma.callSession.update({
          where: { id: existing.id },
          data: {
            status: "COMPLETED",
            endedAt: data.endedAt,
            summary: data.summary ?? undefined,
            costUsd: data.costUsd,
            durationSeconds: data.durationSeconds,
            endedReason: data.endedReason,
            costSource: data.costSource,
            costBreakdown: data.costBreakdown,
            callInIdentityId: identity.id,
            userId: identity.userId,
            mailboxId: identity.mailboxId,
          },
        });
        await prisma.callInIdentity.updateMany({
          where: {
            id: identity.id,
            OR: [
              { lastSuccessfulCallAt: null },
              { lastSuccessfulCallAt: { lt: endedAt } },
            ],
          },
          data: { lastSuccessfulCallAt: endedAt },
        });
        await reconcilePurchasedMinutesAfterCall({
          organizationId: identity.organizationId,
          sessionId: updated.id,
          durationSeconds: resolved.durationSeconds,
          startedAt,
        });
        return {
          recorded: true,
          sessionId: updated.id,
          callId: resolved.callId,
          costUsd: resolved.costUsd,
        };
      }
    }

    const created = await prisma.callSession.create({ data });
    await prisma.callInIdentity.updateMany({
      where: {
        id: identity.id,
        OR: [
          { lastSuccessfulCallAt: null },
          { lastSuccessfulCallAt: { lt: endedAt } },
        ],
      },
      data: { lastSuccessfulCallAt: endedAt },
    });
    await reconcilePurchasedMinutesAfterCall({
      organizationId: identity.organizationId,
      sessionId: created.id,
      durationSeconds: resolved.durationSeconds,
      startedAt,
    });
    return {
      recorded: true,
      sessionId: created.id,
      callId: resolved.callId,
      costUsd: resolved.costUsd,
    };
  } catch (err) {
    console.error("[call-cost] persist failed", err);
    return {
      recorded: false,
      reason: "persist_error",
      callId: resolved.callId,
      costUsd: resolved.costUsd,
    };
  }
}

export async function loadCallCostTallyForUser(input: {
  organizationId: string;
  userId: string;
}): Promise<CallCostTally> {
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  const sessions = await prisma.callSession.findMany({
    where: {
      organizationId: input.organizationId,
      userId: input.userId,
      costUsd: { not: null },
      channel: "PHONE",
    },
    orderBy: { startedAt: "desc" },
    take: 500,
    select: {
      costUsd: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
      providerCallSid: true,
      costBreakdown: true,
    },
  });

  const rows: CallCostRow[] = [];
  for (const s of sessions) {
    const cost =
      s.costUsd == null
        ? null
        : typeof s.costUsd === "number"
          ? s.costUsd
          : Number(s.costUsd);
    if (cost == null || !Number.isFinite(cost)) continue;
    const breakdown =
      s.costBreakdown &&
      typeof s.costBreakdown === "object" &&
      !Array.isArray(s.costBreakdown)
        ? (s.costBreakdown as Record<string, unknown>)
        : null;
    rows.push({
      costUsd: cost,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSeconds: s.durationSeconds,
      providerCallSid: s.providerCallSid,
      costBreakdown: breakdown,
    });
  }

  return aggregateCallCostTally(rows);
}

/**
 * After duration is stored, draw prepaid minutes for any usage past included.
 * Failures are logged but do not undo cost recording.
 */
async function reconcilePurchasedMinutesAfterCall(input: {
  organizationId: string;
  sessionId: string;
  durationSeconds: number | null | undefined;
  startedAt: Date;
}): Promise<void> {
  const durationSeconds = input.durationSeconds;
  if (durationSeconds == null || !Number.isFinite(durationSeconds)) return;

  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();

    const subscription = await prisma.subscription.findFirst({
      where: { organizationId: input.organizationId },
      orderBy: { updatedAt: "desc" },
      include: { plan: true },
    });
    const plan = planForUsageKey(subscription?.plan?.key);
    const included = plan.callLimits.includedCallMinutes ?? 90;
    const { periodStart, periodEnd } = resolveBillingPeriod({
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    });

    const prior = await prisma.callSession.aggregate({
      where: {
        organizationId: input.organizationId,
        channel: "PHONE",
        startedAt: { gte: periodStart, lt: periodEnd },
        id: { not: input.sessionId },
        durationSeconds: { not: null },
      },
      _sum: { durationSeconds: true },
    });
    const priorSeconds = prior._sum.durationSeconds ?? 0;
    const periodMinutesUsedBeforeCall =
      typeof priorSeconds === "number"
        ? priorSeconds / 60
        : Number(priorSeconds) / 60;

    await drawPurchasedMinutesForCall({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      callDurationMinutes: Math.max(0, durationSeconds) / 60,
      periodMinutesUsedBeforeCall,
      minutesIncluded: included,
    });
  } catch (err) {
    console.warn("[call-cost] purchased-minute draw failed", err);
  }
}
