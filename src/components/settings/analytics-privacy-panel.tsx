"use client";

import { useEffect, useState } from "react";
import {
  defaultAnalyticsPrivacyState,
  type AnalyticsPrivacyState,
} from "@/lib/analytics/privacy-consent";
import {
  ANALYTICS_PRIVACY_STORAGE_KEY,
  saveAnalyticsPrivacyState,
} from "@/lib/analytics/track";
import { product } from "@/lib/product";

function loadState(): AnalyticsPrivacyState {
  if (typeof window === "undefined") return defaultAnalyticsPrivacyState();
  try {
    const raw = localStorage.getItem(ANALYTICS_PRIVACY_STORAGE_KEY);
    if (!raw) return defaultAnalyticsPrivacyState();
    return JSON.parse(raw) as AnalyticsPrivacyState;
  } catch {
    return defaultAnalyticsPrivacyState();
  }
}

/**
 * Settings panel: opt-in product analytics. Never on by default.
 */
export function AnalyticsPrivacyPanel() {
  const [state, setState] = useState<AnalyticsPrivacyState>(
    defaultAnalyticsPrivacyState,
  );
  const [consentChecked, setConsentChecked] = useState(false);
  const [status, setStatus] = useState(
    `${product.name} never turns on product analytics by default.`,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setState(loadState());
  }, []);

  async function runAction(
    action:
      | { type: "enable"; consentAcknowledged: boolean }
      | { type: "disable" }
      | { type: "revoke_consent" },
  ) {
    setBusy(true);
    try {
      const res = await fetch("/api/analytics-privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, state }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        state?: AnalyticsPrivacyState;
      };
      if (!res.ok || !data.ok || !data.state) {
        setStatus(data.error ?? "Could not update analytics privacy settings.");
        return;
      }
      setState(data.state);
      saveAnalyticsPrivacyState(data.state);
      if (action.type === "enable") setConsentChecked(false);
      setStatus(data.message ?? "Updated.");
    } catch {
      setStatus("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="settings-block analytics-privacy-panel"
      aria-labelledby="analytics-privacy-heading"
    >
      <h2 id="analytics-privacy-heading">Product analytics</h2>
      <p>
        Help improve {product.name} with anonymous product usage signals (for
        example, which dashboard pages you visit). Analytics is{" "}
        <strong>off by default</strong> and only runs after you opt in. We do not
        load third-party trackers unless you enable this.
      </p>

      <dl className="voice-learning-status">
        <div>
          <dt>Collection</dt>
          <dd>{state.analyticsEnabled ? "On" : "Off"}</dd>
        </div>
        <div>
          <dt>Consent</dt>
          <dd>{state.consentGranted ? "Granted" : "Not granted"}</dd>
        </div>
        <div>
          <dt>Default</dt>
          <dd>Off</dd>
        </div>
      </dl>

      {!state.analyticsEnabled ? (
        <div className="voice-learning-enable">
          <label className="consent-check">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              disabled={busy}
            />
            <span>
              I consent to product analytics for my account. I understand this is
              optional, off by default, and I can revoke consent anytime.
            </span>
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !consentChecked}
            aria-busy={busy}
            onClick={() =>
              runAction({ type: "enable", consentAcknowledged: consentChecked })
            }
          >
            {busy ? "Saving…" : "Enable product analytics"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          aria-busy={busy}
          onClick={() => runAction({ type: "disable" })}
        >
          Turn off analytics
        </button>
      )}

      <div className="voice-learning-actions" role="group" aria-label="Analytics consent">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy || (!state.consentGranted && !state.analyticsEnabled)}
          onClick={() => {
            if (
              typeof window !== "undefined" &&
              !window.confirm(
                "Revoke analytics consent? Collection will stay off until you opt in again.",
              )
            ) {
              return;
            }
            void runAction({ type: "revoke_consent" });
          }}
        >
          Revoke consent
        </button>
      </div>

      <p className="status-line" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
