"use client";

import { useEffect, useState } from "react";
import { product } from "@/lib/product";
import type { VoiceLearningState } from "@/lib/voice/learning-consent";
import { defaultVoiceLearningState } from "@/lib/voice/learning-consent";

const STORAGE_KEY = "inbox-chief-voice-learning";

function loadState(): VoiceLearningState {
  if (typeof window === "undefined") return defaultVoiceLearningState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultVoiceLearningState();
    return JSON.parse(raw) as VoiceLearningState;
  } catch {
    return defaultVoiceLearningState();
  }
}

/**
 * Settings panel: enable/disable voice learning, reset profile, delete learned data.
 * Consent is required to enable — never silent global training.
 */
export function VoiceLearningPanel() {
  const [state, setState] = useState<VoiceLearningState>(defaultVoiceLearningState);
  const [consentChecked, setConsentChecked] = useState(false);
  const [status, setStatus] = useState(
    `${product.name} never trains a global model on your voice preferences.`,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setState(loadState());
  }, []);

  async function runAction(
    action:
      | { type: "enable"; consentAcknowledged: boolean }
      | { type: "disable" }
      | { type: "reset_profile" }
      | { type: "delete_learned_data" },
  ) {
    setBusy(true);
    try {
      const res = await fetch("/api/voice-learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, state }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        state?: VoiceLearningState;
      };
      if (!res.ok || !data.ok || !data.state) {
        setStatus(data.error ?? "Could not update voice learning settings.");
        return;
      }
      setState(data.state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.state));
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
      className="settings-block voice-learning-panel"
      aria-labelledby="voice-learning-heading"
    >
      <h2 id="voice-learning-heading">Voice learning</h2>
      <p>
        When enabled with your consent, {product.name} can remember your preferred
        tone and signature for draft suggestions. Learning stays in your account —
        never silent global training.
      </p>

      <dl className="voice-learning-status">
        <div>
          <dt>Learning</dt>
          <dd>{state.learningEnabled ? "On" : "Off"}</dd>
        </div>
        <div>
          <dt>Consent</dt>
          <dd>{state.consentGranted ? "Granted" : "Not granted"}</dd>
        </div>
        <div>
          <dt>Learned data</dt>
          <dd>{state.hasLearnedData ? "Present" : "None"}</dd>
        </div>
      </dl>

      {!state.learningEnabled ? (
        <div className="voice-learning-enable">
          <label className="consent-check">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              disabled={busy}
            />
            <span>
              I consent to voice preference learning for my account only. I
              understand this is not used for global model training.
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
            {busy ? "Saving…" : "Enable voice learning"}
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
          Disable learning
        </button>
      )}

      <div className="voice-learning-actions" role="group" aria-label="Voice data controls">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => runAction({ type: "reset_profile" })}
        >
          Reset profile
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => {
            if (
              typeof window !== "undefined" &&
              !window.confirm(
                "Delete all learned voice data and revoke consent? This cannot be undone.",
              )
            ) {
              return;
            }
            void runAction({ type: "delete_learned_data" });
          }}
        >
          Delete learned data
        </button>
      </div>

      <p className="status-line" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
