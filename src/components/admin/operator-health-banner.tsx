"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type HealthResponse = {
  ok?: boolean;
  alerts?: string[];
  checks?: {
    gmailOauthConfigured?: boolean;
    vapiAssistantLinked?: boolean;
    database?: string;
  };
};

/**
 * Operator-only banner when Gmail OAuth or VAPI assistant link is down.
 */
export function OperatorHealthBanner() {
  const [alerts, setAlerts] = useState<string[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch("/api/auth/me");
        const me = (await meRes.json()) as { isOperator?: boolean };
        if (cancelled || !me.isOperator) return;
        setVisible(true);
        const healthRes = await fetch("/api/health");
        const health = (await healthRes.json()) as HealthResponse;
        if (cancelled) return;
        const next: string[] = [];
        if (!health.checks?.gmailOauthConfigured) {
          next.push("Gmail OAuth is not configured.");
        }
        if (!health.checks?.vapiAssistantLinked) {
          next.push("VAPI assistantLinked is false — phone calls may fail.");
        }
        if (health.checks?.database && health.checks.database !== "ok") {
          next.push(`Database: ${health.checks.database}.`);
        }
        setAlerts(next.length ? next : (health.alerts ?? []).slice(0, 3));
      } catch {
        if (!cancelled) setVisible(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible || alerts.length === 0) return null;

  return (
    <div
      className="operator-health-banner"
      role="status"
      aria-live="polite"
    >
      <p>
        <strong>Operator alert:</strong> {alerts.join(" ")}{" "}
        <Link href="/dashboard/admin/onboard">Admin onboard</Link>
        {" · "}
        <Link href="/dashboard/settings">Settings checklist</Link>
        {" · "}
        <a href="/api/health">/api/health</a>
      </p>
    </div>
  );
}
