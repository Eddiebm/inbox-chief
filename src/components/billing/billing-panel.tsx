"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CallMinuteUsage } from "@/lib/billing/call-usage";
import type { PlanEntitlements } from "@/lib/billing/entitlements";
import { formatOverageRate, formatPlanPrice, plans } from "@/lib/plans";
import { product } from "@/lib/product";

type SubscriptionSummary = {
  billingLive: boolean;
  canManage: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  statusSummary: string;
  entitlements: PlanEntitlements;
};

export function BillingPanel() {
  const [status, setStatus] = useState(
    "Review your plan. Included call minutes are metered — never unlimited.",
  );
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [usage, setUsage] = useState<CallMinuteUsage | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [isOperator, setIsOperator] = useState(false);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [usageRes, meRes, subRes] = await Promise.all([
          fetch("/api/billing/usage"),
          fetch("/api/auth/me"),
          fetch("/api/billing/subscription"),
        ]);
        const data = (await usageRes.json()) as {
          ok?: boolean;
          usage?: CallMinuteUsage;
        };
        const me = (await meRes.json()) as {
          isOperator?: boolean;
          organizationId?: string | null;
        };
        const sub = (await subRes.json()) as
          | ({ ok: true } & SubscriptionSummary)
          | { ok: false };
        if (cancelled) return;
        if (data.ok && data.usage) setUsage(data.usage);
        setIsOperator(Boolean(me.isOperator));
        setOrganizationId(me.organizationId ?? null);
        if (sub.ok) setSummary(sub);
      } catch {
        /* ignore — plan list still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentPlanId = summary?.entitlements.planId ?? null;

  async function startCheckout(planKey: string) {
    setBusyPlan(planKey);
    setStatus(`Starting checkout for ${planKey}…`);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: organizationId ?? undefined,
          planKey,
          successUrl: `${window.location.origin}/dashboard/billing?checkout=success`,
          cancelUrl: `${window.location.origin}/dashboard/billing?checkout=cancel`,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        reason?: string;
        url?: string;
        stub?: boolean;
        error?: string;
        message?: string;
      };
      if (data.reason === "stripe_not_configured") {
        setStatus(
          isOperator
            ? (data.message ??
                "Billing not live — set STRIPE_SECRET_KEY and STRIPE_PRICE_PATRON / STRIPE_PRICE_PRO.")
            : (data.message ??
                "Checkout is not available yet. Please contact support."),
        );
        return;
      }
      if (!res.ok || !data.ok) {
        setStatus(data.error ?? "Could not start checkout.");
        return;
      }
      if (data.url && !data.stub) {
        window.location.href = data.url;
        return;
      }
      setStatus(
        data.message ??
          (data.stub
            ? isOperator
              ? `Billing not live for ${planKey} — set STRIPE_PRICE_${planKey.toUpperCase()}.`
              : "Checkout is almost ready. Please contact support."
            : `Checkout started for ${planKey}.`),
      );
    } catch {
      setStatus("Network error starting checkout.");
    } finally {
      setBusyPlan(null);
    }
  }

  async function openPortal() {
    setManaging(true);
    setStatus("Opening your billing portal to update your card or cancel…");
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: organizationId ?? undefined,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        reason?: string;
        url?: string;
        message?: string;
        error?: string;
      };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.reason === "stripe_not_configured") {
        setStatus(
          isOperator
            ? "Billing not live — STRIPE_SECRET_KEY missing."
            : "The billing portal is not available yet. Please contact support.",
        );
        return;
      }
      setStatus(data.message ?? data.error ?? "Portal response received.");
    } catch {
      setStatus("Network error opening the billing portal.");
    } finally {
      setManaging(false);
    }
  }

  const entitlements = summary?.entitlements ?? null;
  const showUpgradePrompt = entitlements?.needsUpgradePrompt ?? false;

  return (
    <div className="billing-panel">
      <header className="page-header">
        <h1>Billing</h1>
        <p>
          Manage your {product.name} subscription. Plans use included call-in
          minutes with a clear overage rate — never unlimited. You can cancel or
          update your card any time.
        </p>
      </header>

      {summary ? (
        <section
          className="billing-current-plan"
          aria-labelledby="billing-current-heading"
        >
          <h2 id="billing-current-heading">Your plan</h2>
          <p role="status" aria-live="polite">
            {summary.statusSummary}
          </p>
          {summary.cancelAtPeriodEnd ? (
            <p>
              Your plan is set to end at the close of this billing period. You
              can resume it any time from the billing portal.
            </p>
          ) : null}
          {summary.canManage ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void openPortal()}
              disabled={managing}
            >
              {managing
                ? "Opening billing portal…"
                : "Manage subscription (cancel or update card)"}
            </button>
          ) : null}
        </section>
      ) : null}

      {showUpgradePrompt && entitlements ? (
        <section
          className="billing-upgrade-prompt"
          aria-labelledby="billing-upgrade-heading"
        >
          <h2 id="billing-upgrade-heading">Keep your assistant</h2>
          <p>
            {entitlements.trialExpired
              ? "Your free trial has ended. Subscribe below to keep your call-in assistant working."
              : entitlements.pastDue
                ? "Your last payment did not go through. Update your card to avoid losing your assistant."
                : "Choose a plan below to turn your assistant back on."}
          </p>
        </section>
      ) : null}

      <p className="status-line" role="status" aria-live="polite">
        {status}
      </p>

      {usage ? (
        <section
          className="billing-usage"
          aria-labelledby="billing-usage-heading"
        >
          <h2 id="billing-usage-heading">Call minutes this period</h2>
          <p role="status" aria-live="polite">
            {usage.plainSummary} Plan: {usage.planName}. Soft cap — you can keep
            calling; overage is metered at{" "}
            {formatOverageRate(usage.overageRateUsdPerMinute)}.
            {usage.warningLevel !== "none" ? ` ${usage.spokenWarning}` : ""}
          </p>
        </section>
      ) : null}

      <div className="billing-actions">
        <Link href="/pricing" className="btn-secondary">
          View public pricing
        </Link>
      </div>

      <ul className="billing-plan-list">
        {plans.map((plan) => {
          const isCurrent = currentPlanId === plan.id;
          return (
            <li
              key={plan.id}
              className="billing-plan-card"
              aria-current={isCurrent ? "true" : undefined}
            >
              <h2>
                {plan.name}
                {isCurrent ? (
                  <span className="billing-plan-current"> — your plan</span>
                ) : null}
              </h2>
              <p className="billing-plan-price">{formatPlanPrice(plan)}</p>
              <p>{plan.description}</p>
              {plan.callLimits.includedCallMinutes != null ? (
                <p className="billing-plan-minutes">
                  Includes {plan.callLimits.includedCallMinutes} minutes ·
                  overage{" "}
                  {formatOverageRate(plan.callLimits.overagePerMinuteUsd ?? 0.6)}
                </p>
              ) : (
                <p className="billing-plan-minutes">
                  Custom included minutes (still capped — no unlimited calling)
                </p>
              )}
              <button
                type="button"
                className="btn-primary"
                disabled={busyPlan === plan.id || plan.price.kind === "custom"}
                onClick={() => void startCheckout(plan.id)}
                aria-label={
                  plan.price.kind === "custom"
                    ? "Contact us about the Business plan"
                    : isCurrent
                      ? `Renew or change to ${plan.name}`
                      : `Subscribe to ${plan.name} for ${formatPlanPrice(plan)}`
                }
              >
                {plan.price.kind === "custom"
                  ? "Contact for Business"
                  : busyPlan === plan.id
                    ? "Starting…"
                    : isCurrent
                      ? `Renew ${plan.name}`
                      : `Choose ${plan.name}`}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
