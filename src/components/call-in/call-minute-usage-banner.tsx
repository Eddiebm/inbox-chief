"use client";

import { useEffect, useId, useState } from "react";
import type { CallMinuteUsage } from "@/lib/billing/call-usage";

type UsageResponse = {
  ok?: boolean;
  isMock?: boolean;
  usage?: CallMinuteUsage;
  message?: string;
  error?: string;
};

/**
 * Soft-cap call-minute warning for Call-in (before / during session).
 * Warns at 80% and at the included limit; does not block calling.
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

  return (
    <aside
      className={
        showWarn
          ? "settings-block call-minute-usage-banner call-minute-usage-banner--warn"
          : "settings-block call-minute-usage-banner"
      }
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className="call-minute-usage-banner__title">
        Call minutes
      </h2>
      <p role="status" aria-live="polite">
        {usage.plainSummary} Calls are not cut off mid-email — overage is
        metered.
        {showWarn ? ` ${usage.spokenWarning}` : ""}
      </p>
    </aside>
  );
}
