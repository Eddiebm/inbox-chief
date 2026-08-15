"use client";

import { useEffect, useId, useState } from "react";
import type { CallMinuteUsage } from "@/lib/billing/call-usage";
import {
  formatCostBreakdownSnippet,
  formatUsdPlain,
  type CallCostTally,
} from "@/lib/call-in/call-cost-format";
import { premiumVsStandardCostCopy } from "@/lib/call-in/voice-tiers";

type CostsResponse = {
  ok?: boolean;
  isMock?: boolean;
  message?: string;
  tally?: CallCostTally;
  usage?: CallMinuteUsage;
  error?: string;
};

/**
 * Running tally of VAPI phone call-in costs (USD) + included minutes.
 * Shows last-call VAPI/TTS/STT/LLM breakdown when available.
 */
export function CallCostsTally() {
  const headingId = useId();
  const statusId = useId();
  const usageId = useId();
  const [tally, setTally] = useState<CallCostTally | null>(null);
  const [usage, setUsage] = useState<CallMinuteUsage | null>(null);
  const [message, setMessage] = useState("Loading call costs…");
  const [isMock, setIsMock] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/call-in/costs");
        const data = (await res.json()) as CostsResponse;
        if (cancelled) return;
        if (!res.ok || !data.ok || !data.tally) {
          setMessage(
            data.error ?? data.message ?? "Could not load call costs.",
          );
          setTally(null);
          setUsage(null);
          return;
        }
        setIsMock(Boolean(data.isMock));
        setTally(data.tally);
        setUsage(data.usage ?? null);
        const spoken = data.usage
          ? `${data.tally.spokenSummary} ${data.usage.spokenSummary}`
          : data.tally.spokenSummary;
        setMessage(spoken);
      } catch {
        if (!cancelled) {
          setMessage("Could not load call costs.");
          setTally(null);
          setUsage(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lastLabel =
    tally?.lastCallCostUsd != null
      ? formatUsdPlain(tally.lastCallCostUsd)
      : "—";
  const todayLabel = formatUsdPlain(tally?.todayUsd ?? 0);
  const monthLabel = formatUsdPlain(tally?.monthUsd ?? 0);
  const lifetimeLabel = formatUsdPlain(tally?.lifetimeUsd ?? 0);
  const breakdownSnippet =
    tally?.lastCallBreakdown != null
      ? formatCostBreakdownSnippet(tally.lastCallBreakdown)
      : null;

  return (
    <section
      className="settings-block call-costs-tally"
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>Call costs</h2>
      <p>
        Phone call-in uses included minutes on your plan, then a clear overage
        rate. Browser voice ask does not add to this tally. Provider cost in US
        dollars is shown for your records. {premiumVsStandardCostCopy()}
      </p>
      <p id={statusId} className="status-line" role="status" aria-live="polite">
        {message}
      </p>
      {usage ? (
        <p
          id={usageId}
          className={
            usage.warningLevel === "none"
              ? "call-costs-tally__usage"
              : "call-costs-tally__usage call-costs-tally__usage--warn"
          }
          role="status"
          aria-live="polite"
        >
          {usage.plainSummary}
          {usage.planName ? ` (${usage.planName} plan)` : ""}.
          {usage.warningLevel === "at_limit"
            ? ` ${usage.spokenWarning}`
            : usage.warningLevel === "approaching"
              ? ` ${usage.spokenWarning}`
              : ""}
        </p>
      ) : null}
      {tally && !isMock ? (
        <dl className="call-costs-tally__grid">
          <div>
            <dt>Minutes this period</dt>
            <dd>
              {usage
                ? `${usage.minutesUsed} / ${usage.minutesIncluded}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Last call</dt>
            <dd>{lastLabel}</dd>
          </div>
          <div>
            <dt>Today (provider)</dt>
            <dd>{todayLabel}</dd>
          </div>
          <div>
            <dt>This month (provider)</dt>
            <dd>{monthLabel}</dd>
          </div>
          <div>
            <dt>Lifetime (provider)</dt>
            <dd>{lifetimeLabel}</dd>
          </div>
        </dl>
      ) : null}
      {breakdownSnippet ? (
        <p className="call-costs-tally__meta" role="status" aria-live="polite">
          Last call breakdown: {breakdownSnippet}.
        </p>
      ) : null}
      {tally?.highTtsTip ? (
        <p className="call-costs-tally__tip" role="status" aria-live="polite">
          {tally.highTtsTip} Premium uses more of your included minutes.
        </p>
      ) : null}
      {tally &&
      tally.callCountLifetime > 0 &&
      tally.lastCallDurationSeconds != null ? (
        <p className="call-costs-tally__meta">
          Last call lasted about {Math.round(tally.lastCallDurationSeconds)}{" "}
          seconds
          {tally.lastCallId ? ` (call ${tally.lastCallId.slice(0, 8)}…)` : ""}.
        </p>
      ) : null}
    </section>
  );
}
