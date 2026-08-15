/**
 * Pure Stripe-webhook helpers: turn a raw Stripe event into a normalized
 * subscription change, then apply it to the database.
 *
 * Kept free of the Stripe SDK and env reads so the state transitions
 * (active / past_due / canceled / trialing) are unit-testable with a fake
 * Prisma client. The route (`/api/billing/webhook`) handles signature
 * verification and hands the verified event here.
 */

import { resolvePlanId } from "@/lib/plans";
import type { SubscriptionStatusValue } from "@/lib/billing/entitlements";

/** Loose shape of the Stripe object we read (session / subscription / invoice). */
export type StripeWebhookObject = {
  id?: string;
  object?: string;
  status?: string;
  customer?: string | { id?: string } | null;
  subscription?: string | { id?: string } | null;
  current_period_end?: number | null;
  trial_end?: number | null;
  cancel_at_period_end?: boolean | null;
  metadata?: {
    organizationId?: string;
    planKey?: string;
    userId?: string;
  } | null;
  items?: {
    data?: Array<{
      current_period_end?: number | null;
      price?: { id?: string } | null;
    }>;
  } | null;
};

export type NormalizedSubscriptionChange =
  | {
      kind: "upsert";
      organizationId: string | null;
      planKey: string;
      status: SubscriptionStatusValue;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      currentPeriodEnd: Date | null;
      trialEndsAt: Date | null;
      cancelAtPeriodEnd: boolean;
    }
  | {
      kind: "cancel";
      organizationId: string | null;
      stripeSubscriptionId: string | null;
    }
  | {
      kind: "past_due";
      stripeSubscriptionId: string | null;
      stripeCustomerId: string | null;
    }
  | { kind: "ignore" };

export function mapStripeStatus(
  status: string | undefined | null,
): SubscriptionStatusValue {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "incomplete":
    case "incomplete_expired":
      return "INCOMPLETE";
    default:
      return "INCOMPLETE";
  }
}

function idFrom(value: string | { id?: string } | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id ?? null;
}

function secondsToDate(seconds: number | null | undefined): Date | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

/**
 * Stripe moved `current_period_end` onto subscription items in newer API
 * versions. Read the top-level value first, then fall back to the first item.
 */
export function stripePeriodEnd(obj: StripeWebhookObject): Date | null {
  const top = secondsToDate(obj.current_period_end);
  if (top) return top;
  const item = obj.items?.data?.[0]?.current_period_end;
  return secondsToDate(item);
}

/**
 * Normalize a verified Stripe event into a DB change. Pure — no I/O.
 */
export function normalizeStripeEvent(
  type: string,
  obj: StripeWebhookObject,
): NormalizedSubscriptionChange {
  const organizationId = obj.metadata?.organizationId?.trim() || null;
  const planKey = resolvePlanId(obj.metadata?.planKey?.trim() || "patron");
  const customerId = idFrom(obj.customer);

  switch (type) {
    case "checkout.session.completed": {
      // Session carries our metadata + the new subscription/customer ids.
      // Status is not on the session; a completed checkout means the plan is
      // live now (ACTIVE). The follow-up customer.subscription.* event refines
      // status/period/trial when Stripe sends it.
      return {
        kind: "upsert",
        organizationId,
        planKey,
        status: "ACTIVE",
        stripeCustomerId: customerId,
        stripeSubscriptionId: idFrom(obj.subscription),
        currentPeriodEnd: null,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      return {
        kind: "upsert",
        organizationId,
        planKey,
        status: mapStripeStatus(obj.status),
        stripeCustomerId: customerId,
        stripeSubscriptionId: obj.id ?? null,
        currentPeriodEnd: stripePeriodEnd(obj),
        trialEndsAt: secondsToDate(obj.trial_end),
        cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
      };
    }
    case "customer.subscription.deleted": {
      return {
        kind: "cancel",
        organizationId,
        stripeSubscriptionId: obj.id ?? null,
      };
    }
    case "invoice.payment_failed": {
      return {
        kind: "past_due",
        stripeSubscriptionId: idFrom(obj.subscription),
        stripeCustomerId: customerId,
      };
    }
    default:
      return { kind: "ignore" };
  }
}

/** Minimal Prisma surface used to apply a change (real client or a fake in tests). */
export type PrismaForWebhook = {
  subscriptionPlan: {
    findUnique: (args: {
      where: { key: string };
    }) => Promise<{ id: string } | null>;
  };
  subscription: {
    findFirst: (args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
    }) => Promise<{
      id: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      currentPeriodEnd: Date | null;
      trialEndsAt: Date | null;
    } | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<{ id: string }>;
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
};

export type ApplyResult =
  | { applied: true; action: "created" | "updated" | "canceled" | "past_due" }
  | { applied: false; reason: string };

/**
 * Apply a normalized change to the database. Matching prefers organizationId
 * (set in checkout metadata) and falls back to the Stripe subscription id.
 */
export async function applySubscriptionChange(
  prisma: PrismaForWebhook,
  change: NormalizedSubscriptionChange,
): Promise<ApplyResult> {
  switch (change.kind) {
    case "ignore":
      return { applied: false, reason: "ignored_event" };

    case "past_due": {
      if (!change.stripeSubscriptionId) {
        return { applied: false, reason: "no_subscription_id" };
      }
      const res = await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: change.stripeSubscriptionId },
        data: { status: "PAST_DUE" },
      });
      return res.count > 0
        ? { applied: true, action: "past_due" }
        : { applied: false, reason: "subscription_not_found" };
    }

    case "cancel": {
      const where = change.stripeSubscriptionId
        ? { stripeSubscriptionId: change.stripeSubscriptionId }
        : change.organizationId
          ? { organizationId: change.organizationId }
          : null;
      if (!where) return { applied: false, reason: "no_match_key" };
      const res = await prisma.subscription.updateMany({
        where,
        data: { status: "CANCELED", cancelAtPeriodEnd: false },
      });
      return res.count > 0
        ? { applied: true, action: "canceled" }
        : { applied: false, reason: "subscription_not_found" };
    }

    case "upsert": {
      const plan = await prisma.subscriptionPlan.findUnique({
        where: { key: change.planKey },
      });
      if (!plan) return { applied: false, reason: "unknown_plan" };

      const existing = change.organizationId
        ? await prisma.subscription.findFirst({
            where: { organizationId: change.organizationId },
            orderBy: { updatedAt: "desc" },
          })
        : change.stripeSubscriptionId
          ? await prisma.subscription.findFirst({
              where: { stripeSubscriptionId: change.stripeSubscriptionId },
            })
          : null;

      if (existing) {
        await prisma.subscription.update({
          where: { id: existing.id },
          data: {
            planId: plan.id,
            status: change.status,
            stripeCustomerId:
              change.stripeCustomerId ?? existing.stripeCustomerId,
            stripeSubscriptionId:
              change.stripeSubscriptionId ?? existing.stripeSubscriptionId,
            currentPeriodEnd:
              change.currentPeriodEnd ?? existing.currentPeriodEnd,
            trialEndsAt: change.trialEndsAt ?? existing.trialEndsAt,
            cancelAtPeriodEnd: change.cancelAtPeriodEnd,
          },
        });
        return { applied: true, action: "updated" };
      }

      if (!change.organizationId) {
        // Nothing to attach the subscription to safely.
        return { applied: false, reason: "no_organization" };
      }

      await prisma.subscription.create({
        data: {
          organizationId: change.organizationId,
          planId: plan.id,
          status: change.status,
          stripeCustomerId: change.stripeCustomerId,
          stripeSubscriptionId: change.stripeSubscriptionId,
          currentPeriodEnd: change.currentPeriodEnd,
          trialEndsAt: change.trialEndsAt,
          cancelAtPeriodEnd: change.cancelAtPeriodEnd,
        },
      });
      return { applied: true, action: "created" };
    }

    default: {
      const never: never = change;
      return never;
    }
  }
}
