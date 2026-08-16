"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import type { CallMinuteUsage } from "@/lib/billing/call-usage";

type UsageResponse = {
  ok?: boolean;
  isMock?: boolean;
  usage?: CallMinuteUsage;
  message?: string;
  error?: string;
};

/**
 * Hard-cap call-minute status for Call-in (before / during session).
 * Shows included usage, rollover minutes, and a direct top-up path.
 */
export function CallMinuteUsageBanner() {
  const headingId = useId();
  const [usage, setUsage] = useState<CallMinuteUsage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/usage");
        const data = (await res.json()) as UsageResponse;
        if (cancelled) return;
        if (!res.ok || !data.ok || !data.usage) {
          setLoadError(data.error ?? data.message ?? null);
          setUsage(null);
          return;
        }
        setUsage(data.usage);
        setLoadError(null);
      } catch {
        if (!cancelled) {
          setLoadError("Could not load call minutes.");
          setUsage(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!usage && !loadError) {
    return (
      <p className="status-line" role="status" aria-live="polite">
        Checking included call minutes…
      </p>
    );
  }

  if (!usage) return null;

  const showWarn = usage.warningLevel !== "none";
  const capped = usage.hardCapReached;

  return (
    <aside
      className={
        capped
          ? "settings-block call-minute-usage-banner call-minute-usage-banner--capped"
          : showWarn
            ? "settings-block call-minute-usage-banner call-minute-usage-banner--warn"
            : "settings-block call-minute-usage-banner"
      }
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className="call-minute-usage-banner__title">
        {capped ? "Minutes used up" : "Call minutes"}
      </h2>
      <p role="status" aria-live="polite">
        {usage.plainSummary}
        {showWarn ? ` ${usage.spokenWarning}` : ""}
      </p>
      <Link
        href="/dashboard/billing#minute-packs"
        className="btn-primary call-minute-usage-banner__cta"
      >
        Buy more minutes
      </Link>
    </aside>
  );
}
