import { describe, expect, it } from "vitest";
import {
  applyMinutePackPurchase,
  applySubscriptionChange,
  mapStripeStatus,
  normalizeMinutePackPurchase,
  normalizeStripeEvent,
  stripePeriodEnd,
  type PrismaForMinutePackWebhook,
  type PrismaForWebhook,
} from "@/lib/billing/stripe-webhook";

describe("prepaid minute-pack webhook", () => {
  it("normalizes only paid one-time minute packs", () => {
    const purchase = normalizeMinutePackPurchase(
      "checkout.session.completed",
      {
        id: "cs_pack_1",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_1",
        metadata: {
          purchaseKind: "minute_pack",
          minutePackKey: "pack_60",
          organizationId: "org_1",
        },
      },
    );
    expect(purchase).toMatchObject({
      kind: "credit",
      packId: "pack_60",
      minutes: 60,
      amountUsdCents: 3000,
    });
    expect(
      normalizeMinutePackPurchase("checkout.session.completed", {
        id: "cs_unpaid",
        mode: "payment",
        payment_status: "unpaid",
        metadata: {
          purchaseKind: "minute_pack",
          minutePackKey: "pack_60",
          organizationId: "org_1",
        },
      }).kind,
    ).toBe("ignore");
  });

  /** Fake Prisma for the pack path, with a configurable ownership answer. */
  function makePackPrisma(owner: {
    linkedCustomerOrgs?: Array<{ organizationId: string; stripeCustomerId: string }>;
    memberships?: Array<{ organizationId: string; userId: string }>;
  }) {
    const state = { remaining: 10 };
    const sessions = new Set<string>();
    const tx = {
      callMinutePackPurchase: {
        findUnique: async ({ where }: {
          where: { stripeCheckoutSessionId: string };
        }) =>
          sessions.has(where.stripeCheckoutSessionId) ? { id: "purchase_1" } : null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          sessions.add(String(data.stripeCheckoutSessionId));
          return { id: "purchase_1" };
        },
      },
      callMinuteBalance: {
        upsert: async (args: {
          update: Record<string, unknown>;
        }) => {
          const increment = (
            args.update.purchasedMinutesRemaining as { increment: number }
          ).increment;
          state.remaining += increment;
          return { id: "balance_1", purchasedMinutesRemaining: state.remaining };
        },
      },
    };
    const prisma = {
      $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx),
      subscription: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          (owner.linkedCustomerOrgs ?? []).some(
            (row) =>
              row.organizationId === where.organizationId &&
              row.stripeCustomerId === where.stripeCustomerId,
          )
            ? { id: "sub_1" }
            : null,
      },
      organizationMember: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          (owner.memberships ?? []).some(
            (row) =>
              row.organizationId === where.organizationId &&
              row.userId === where.userId,
          )
            ? { id: "member_1" }
            : null,
      },
    } as PrismaForMinutePackWebhook;
    return { prisma, state };
  }

  const paidPack = (overrides: Record<string, unknown> = {}) =>
    normalizeMinutePackPurchase("checkout.session.completed", {
      id: "cs_pack_1",
      mode: "payment",
      payment_status: "paid",
      customer: "cus_1",
      metadata: {
        purchaseKind: "minute_pack",
        minutePackKey: "pack_30",
        organizationId: "org_1",
        userId: "user_1",
      },
      ...overrides,
    });

  it("credits a paid pack once for the organization the payer owns", async () => {
    const { prisma, state } = makePackPrisma({
      memberships: [{ organizationId: "org_1", userId: "user_1" }],
    });
    const purchase = paidPack();

    expect(await applyMinutePackPurchase(prisma, purchase)).toMatchObject({
      applied: true,
      minutesCredited: 30,
      purchasedMinutesRemaining: 40,
    });
    expect(await applyMinutePackPurchase(prisma, purchase)).toEqual({
      applied: false,
      reason: "already_credited",
    });
    expect(state.remaining).toBe(40);
  });

  it("credits when the Stripe customer is already linked to the org", async () => {
    const { prisma } = makePackPrisma({
      linkedCustomerOrgs: [
        { organizationId: "org_1", stripeCustomerId: "cus_1" },
      ],
    });
    expect(await applyMinutePackPurchase(prisma, paidPack())).toMatchObject({
      applied: true,
    });
  });

  it("refuses to credit an organization the payer does not belong to", async () => {
    const { prisma, state } = makePackPrisma({
      memberships: [{ organizationId: "org_other", userId: "user_1" }],
      linkedCustomerOrgs: [
        { organizationId: "org_other", stripeCustomerId: "cus_1" },
      ],
    });
    expect(await applyMinutePackPurchase(prisma, paidPack())).toEqual({
      applied: false,
      reason: "organization_not_owned",
    });
    expect(state.remaining).toBe(10);
  });

  it("refuses metadata that names an org with no proof of ownership at all", async () => {
    const { prisma, state } = makePackPrisma({});
    const purchase = paidPack({
      customer: null,
      metadata: {
        purchaseKind: "minute_pack",
        minutePackKey: "pack_30",
        organizationId: "org_victim",
      },
    });
    expect(await applyMinutePackPurchase(prisma, purchase)).toEqual({
      applied: false,
      reason: "organization_not_owned",
    });
    expect(state.remaining).toBe(10);
  });
});

type Row = {
  id: string;
  organizationId: string;
  planId: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
};

/** In-memory Prisma double for subscription state-transition tests. */
function makeFakePrisma(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  let seq = seed.length;

  const prisma: PrismaForWebhook = {
    subscriptionPlan: {
      findUnique: async ({ where }) => {
        // Every known plan key maps to a stable fake plan id.
        const known = ["patron", "pro", "business"];
        return known.includes(where.key) ? { id: `plan_${where.key}` } : null;
      },
    },
    subscription: {
      findFirst: async ({ where }) => {
        const match = rows
          .filter((r) => matches(r, where))
          .sort((a, b) => Number(b.id.slice(4)) - Number(a.id.slice(4)))[0];
        return match ?? null;
      },
      create: async ({ data }) => {
        const row: Row = {
          id: `sub_${++seq}`,
          organizationId: String(data.organizationId ?? ""),
          planId: String(data.planId ?? ""),
          status: String(data.status ?? "INCOMPLETE"),
          stripeCustomerId: (data.stripeCustomerId as string | null) ?? null,
          stripeSubscriptionId:
            (data.stripeSubscriptionId as string | null) ?? null,
          currentPeriodEnd: (data.currentPeriodEnd as Date | null) ?? null,
          trialEndsAt: (data.trialEndsAt as Date | null) ?? null,
          cancelAtPeriodEnd: Boolean(data.cancelAtPeriodEnd),
        };
        rows.push(row);
        return { id: row.id };
      },
      update: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, sanitize(data));
        return { id: row.id };
      },
      updateMany: async ({ where, data }) => {
        const affected = rows.filter((r) => matches(r, where));
        for (const row of affected) Object.assign(row, sanitize(data));
        return { count: affected.length };
      },
    },
  };

  return { prisma, rows };
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "not" in value) {
      return (row as Record<string, unknown>)[key] !== (value as { not: unknown }).not;
    }
    return (row as Record<string, unknown>)[key] === value;
  });
}

function sanitize(data: Record<string, unknown>): Partial<Row> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<Row>;
}

describe("mapStripeStatus", () => {
  it("maps Stripe statuses to our enum", () => {
    expect(mapStripeStatus("trialing")).toBe("TRIALING");
    expect(mapStripeStatus("active")).toBe("ACTIVE");
    expect(mapStripeStatus("past_due")).toBe("PAST_DUE");
    expect(mapStripeStatus("unpaid")).toBe("PAST_DUE");
    expect(mapStripeStatus("canceled")).toBe("CANCELED");
    expect(mapStripeStatus("incomplete")).toBe("INCOMPLETE");
    expect(mapStripeStatus(undefined)).toBe("INCOMPLETE");
  });
});

describe("stripePeriodEnd — robust to API version changes", () => {
  it("reads the top-level current_period_end", () => {
    const d = stripePeriodEnd({ current_period_end: 1_760_000_000 });
    expect(d?.getTime()).toBe(1_760_000_000 * 1000);
  });

  it("falls back to the first subscription item", () => {
    const d = stripePeriodEnd({
      items: { data: [{ current_period_end: 1_760_000_500 }] },
    });
    expect(d?.getTime()).toBe(1_760_000_500 * 1000);
  });

  it("returns null when absent", () => {
    expect(stripePeriodEnd({})).toBeNull();
  });
});

describe("subscription create + state transitions", () => {
  it("creates a subscription from a checkout.session.completed event", async () => {
    const { prisma, rows } = makeFakePrisma();
    const change = normalizeStripeEvent("checkout.session.completed", {
      customer: "cus_123",
      subscription: "sub_stripe_1",
      metadata: { organizationId: "org_1", planKey: "pro" },
    });
    const result = await applySubscriptionChange(prisma, change);
    expect(result).toEqual({ applied: true, action: "created" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: "org_1",
      planId: "plan_pro",
      status: "ACTIVE",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_stripe_1",
    });
  });

  it("updates an existing subscription to active on subscription.updated", async () => {
    const { prisma, rows } = makeFakePrisma([
      {
        id: "sub_1",
        organizationId: "org_1",
        planId: "plan_patron",
        status: "TRIALING",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_stripe_1",
        currentPeriodEnd: null,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
      },
    ]);
    const change = normalizeStripeEvent("customer.subscription.updated", {
      id: "sub_stripe_1",
      status: "active",
      customer: "cus_1",
      current_period_end: 1_760_000_000,
      cancel_at_period_end: false,
      metadata: { organizationId: "org_1", planKey: "pro" },
    });
    const result = await applySubscriptionChange(prisma, change);
    expect(result).toEqual({ applied: true, action: "updated" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      planId: "plan_pro",
      status: "ACTIVE",
      currentPeriodEnd: new Date(1_760_000_000 * 1000),
    });
  });

  it("marks the subscription past_due on invoice.payment_failed", async () => {
    const { prisma, rows } = makeFakePrisma([
      {
        id: "sub_1",
        organizationId: "org_1",
        planId: "plan_pro",
        status: "ACTIVE",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_stripe_1",
        currentPeriodEnd: null,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
      },
    ]);
    const change = normalizeStripeEvent("invoice.payment_failed", {
      customer: "cus_1",
      subscription: "sub_stripe_1",
    });
    const result = await applySubscriptionChange(prisma, change);
    expect(result).toEqual({ applied: true, action: "past_due" });
    expect(rows[0]!.status).toBe("PAST_DUE");
  });

  it("marks the subscription canceled on subscription.deleted", async () => {
    const { prisma, rows } = makeFakePrisma([
      {
        id: "sub_1",
        organizationId: "org_1",
        planId: "plan_pro",
        status: "ACTIVE",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_stripe_1",
        currentPeriodEnd: null,
        trialEndsAt: null,
        cancelAtPeriodEnd: true,
      },
    ]);
    const change = normalizeStripeEvent("customer.subscription.deleted", {
      id: "sub_stripe_1",
      metadata: { organizationId: "org_1" },
    });
    const result = await applySubscriptionChange(prisma, change);
    expect(result).toEqual({ applied: true, action: "canceled" });
    expect(rows[0]!.status).toBe("CANCELED");
    expect(rows[0]!.cancelAtPeriodEnd).toBe(false);
  });

  it("refuses to create a subscription with no organization to attach", async () => {
    const { prisma, rows } = makeFakePrisma();
    const change = normalizeStripeEvent("customer.subscription.updated", {
      id: "sub_orphan",
      status: "active",
      customer: "cus_x",
      metadata: {},
    });
    const result = await applySubscriptionChange(prisma, change);
    expect(result).toEqual({ applied: false, reason: "no_organization" });
    expect(rows).toHaveLength(0);
  });

  it("ignores unrelated events", async () => {
    const { prisma } = makeFakePrisma();
    const change = normalizeStripeEvent("payment_intent.succeeded", {});
    expect(change).toEqual({ kind: "ignore" });
    const result = await applySubscriptionChange(prisma, change);
    expect(result).toEqual({ applied: false, reason: "ignored_event" });
  });
});
