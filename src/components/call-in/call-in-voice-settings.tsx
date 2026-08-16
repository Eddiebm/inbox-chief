"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { premiumVsStandardCostCopy } from "@/lib/call-in/voice-tiers";
import { product } from "@/lib/product";

type TierOption = {
  id: "standard" | "premium";
  label: string;
  description: string;
};

type SpeechRate = "slow" | "normal" | "brisk" | "fast";
type SpeechRateOption = { id: SpeechRate; label: string };

/**
 * Accessible Standard / Premium call-in voice picker.
 * Premium gated to Pro; Patron sees upgrade path.
 * Shows cost impact copy; reflects minute cost-guard when active.
 */
export function CallInVoiceSettings() {
  const [tiers, setTiers] = useState<TierOption[]>([]);
  const [preferred, setPreferred] = useState<"standard" | "premium">("standard");
  const [effective, setEffective] = useState<"standard" | "premium">("standard");
  const [allowsPremium, setAllowsPremium] = useState(false);
  const [costGuardActive, setCostGuardActive] = useState(false);
  const [speechRate, setSpeechRate] = useState<SpeechRate>("brisk");
  const [speechRates, setSpeechRates] = useState<SpeechRateOption[]>([]);
  const [speedStatus, setSpeedStatus] = useState(
    "Brisk is the default — you can also say “faster”, “slower”, or “normal speed” on a call.",
  );
  const [status, setStatus] = useState("Loading voice settings…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/call-in/voice");
        const data = (await res.json()) as {
          ok?: boolean;
          preferred?: "standard" | "premium";
          effective?: "standard" | "premium";
          allowsPremium?: boolean;
          costGuardActive?: boolean;
          tiers?: TierOption[];
          speechRate?: SpeechRate;
          speechRates?: SpeechRateOption[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setStatus(data.error ?? "Could not load voice settings.");
          return;
        }
        setPreferred(data.preferred ?? "standard");
        setEffective(data.effective ?? "standard");
        setAllowsPremium(Boolean(data.allowsPremium));
        setCostGuardActive(Boolean(data.costGuardActive));
        setTiers(data.tiers ?? []);
        if (data.speechRate) setSpeechRate(data.speechRate);
        if (data.speechRates?.length) setSpeechRates(data.speechRates);
        if (data.costGuardActive) {
          setStatus(
            "Near your included minutes — Standard voice is active for the next calls to stretch your plan.",
          );
        } else {
          setStatus(
            data.effective === "premium"
              ? "Premium voice is active for call-in. Premium uses more of your included minutes."
              : "Standard voice is active for call-in (lower cost).",
          );
        }
      } catch {
        if (!cancelled) setStatus("Could not load voice settings.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function selectTier(tier: "standard" | "premium") {
    setBusy(true);
    setStatus("Saving…");
    try {
      const res = await fetch("/api/call-in/voice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        preferred?: "standard" | "premium";
        effective?: "standard" | "premium";
        allowsPremium?: boolean;
        costGuardActive?: boolean;
        blocked?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setStatus(data.error ?? "Could not save voice preference.");
        return;
      }
      setPreferred(data.preferred ?? "standard");
      setEffective(data.effective ?? "standard");
      setAllowsPremium(Boolean(data.allowsPremium));
      setCostGuardActive(Boolean(data.costGuardActive));
      setStatus(data.message ?? "Saved.");
    } catch {
      setStatus("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function selectSpeechRate(rate: SpeechRate) {
    const previous = speechRate;
    setSpeechRate(rate);
    setBusy(true);
    setSpeedStatus("Saving reading speed…");
    try {
      const res = await fetch("/api/call-in/voice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speechRate: rate }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        speechRate?: SpeechRate;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setSpeechRate(previous);
        setSpeedStatus(data.error ?? "Could not save reading speed.");
        return;
      }
      if (data.speechRate) setSpeechRate(data.speechRate);
      setSpeedStatus(data.message ?? "Reading speed saved.");
    } catch {
      setSpeechRate(previous);
      setSpeedStatus("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="settings-block call-in-voice-settings"
      aria-labelledby="call-in-voice-heading"
    >
      <h2 id="call-in-voice-heading">Call-in voice</h2>
      <p>
        Choose how {product.name} sounds on the phone. Standard voice keeps
        costs lower. {premiumVsStandardCostCopy()}
      </p>

      <fieldset disabled={busy}>
        <legend className="sr-only">Call-in voice tier</legend>
        {(tiers.length
          ? tiers
          : [
              {
                id: "standard" as const,
                label: "Standard voice",
                description: "Clear speech at lower cost.",
              },
              {
                id: "premium" as const,
                label: "Premium voice",
                description:
                  "Richer sound. Included on Pro. Premium uses more of your included minutes.",
              },
            ]
        ).map((tier) => {
          const lockedPremium = tier.id === "premium" && !allowsPremium;
          return (
            <div key={tier.id} className="form-field">
              <label>
                <input
                  type="radio"
                  name="call-in-voice"
                  value={tier.id}
                  checked={preferred === tier.id}
                  disabled={busy || lockedPremium}
                  onChange={() => void selectTier(tier.id)}
                />{" "}
                {tier.id === "standard"
                  ? "Standard voice (lower cost)"
                  : "Premium voice (richer sound)"}
                {lockedPremium ? " — Included on Pro" : ""}
              </label>
              <p>{tier.description}</p>
              {lockedPremium ? (
                <p>
                  <Link href="/dashboard/billing">Upgrade to Pro</Link> for
                  Premium voice.
                </p>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <p className="status-line" role="status" aria-live="polite">
        {status}
        {effective !== preferred
          ? ` Active on calls: ${effective}.`
          : ""}
        {costGuardActive
          ? " Cost guard: Standard preferred until minutes reset."
          : ""}
      </p>

      <h3 id="call-in-speed-heading">Reading speed</h3>
      <p>
        How fast {product.name} reads your email aloud on the phone. Brisk is
        the default. On a call you can also just say “faster”, “slower”, or
        “normal speed” at any time — your choice is saved for next time.
      </p>
      <fieldset disabled={busy}>
        <legend className="sr-only">Call-in reading speed</legend>
        {(speechRates.length
          ? speechRates
          : [
              { id: "slow" as const, label: "Slow (most time to follow)" },
              { id: "normal" as const, label: "Normal" },
              {
                id: "brisk" as const,
                label: "Brisk (default — a little faster)",
              },
              { id: "fast" as const, label: "Fast (quickest)" },
            ]
        ).map((rate) => (
          <div key={rate.id} className="form-field">
            <label>
              <input
                type="radio"
                name="call-in-speech-rate"
                value={rate.id}
                checked={speechRate === rate.id}
                disabled={busy}
                onChange={() => void selectSpeechRate(rate.id)}
              />{" "}
              {rate.label}
            </label>
          </div>
        ))}
      </fieldset>
      <p className="status-line" role="status" aria-live="polite">
        {speedStatus}
      </p>
    </section>
  );
}
