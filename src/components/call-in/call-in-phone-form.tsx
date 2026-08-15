"use client";

import { useEffect, useState } from "react";
import { product } from "@/lib/product";
import { CALL_IN_PHONE_STORAGE_KEY } from "@/components/onboarding/questions";

function formatDialDisplay(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (m) return `+1 (${m[1]}) ${m[2]}-${m[3]}`;
  return e164;
}

/**
 * Registers the owner's caller ID so inbound phone calls map to their tenant.
 * Never prefills a fake demo number — empty field + placeholder text only.
 * Hydrates from GET /api/call-in/identity (DB), then localStorage fallback.
 */
export function CallInPhoneForm() {
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState(
    "Add the phone you will call from. We use it only to recognize you.",
  );
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/call-in/identity");
        if (res.ok) {
          const data = (await res.json()) as {
            phones?: Array<{ phoneE164: string }>;
          };
          const saved = data.phones?.[0]?.phoneE164?.trim();
          if (saved && !cancelled) {
            setPhone(saved);
            localStorage.setItem(CALL_IN_PHONE_STORAGE_KEY, saved);
            setStatus(`Saved call-in phone: ${saved}`);
            setHydrated(true);
            return;
          }
        }
      } catch {
        // fall through to localStorage
      }
      if (cancelled) return;
      const local = localStorage.getItem(CALL_IN_PHONE_STORAGE_KEY)?.trim() ?? "";
      if (local && local !== "+15551234567") {
        setPhone(local);
        setStatus(`Saved on this device: ${local}. Re-save to sync to the server.`);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // Normalize to E.164 before save (US 10-digit → +1…)
      const digits = phone.replace(/\D/g, "");
      let phoneE164 = phone.trim();
      if (!phoneE164.startsWith("+")) {
        if (digits.length === 10) phoneE164 = `+1${digits}`;
        else if (digits.length === 11 && digits.startsWith("1"))
          phoneE164 = `+${digits}`;
        else if (digits.length >= 8) phoneE164 = `+${digits}`;
      }
      const res = await fetch("/api/call-in/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneE164 }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        phoneE164?: string;
        persisted?: boolean;
      };
      if (!res.ok || !data.ok) {
        setStatus(data.error ?? "Could not save phone number.");
        return;
      }
      const saved = data.phoneE164 ?? phoneE164;
      setPhone(saved);
      localStorage.setItem(CALL_IN_PHONE_STORAGE_KEY, saved);
      setStatus(
        data.persisted === false
          ? (data.message ?? "Saved in demo mode only.")
          : (data.message ??
            `Saved. Call ${product.name} from this number anytime. Use the exact phone you dial from — not the Inbox Chief line.`),
      );
    } catch {
      setStatus("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const dialNumber =
    process.env.NEXT_PUBLIC_VAPI_CALL_IN_NUMBER ??
    process.env.NEXT_PUBLIC_TWILIO_CALL_IN_NUMBER ??
    null;

  return (
    <section className="settings-block" aria-labelledby="call-in-phone-heading">
      <h2 id="call-in-phone-heading">Anytime call-in phone</h2>
      <p>
        Call from this number 24/7 to ask about briefings, drafts, approvals, and
        more. Save the <strong>exact phone you dial from</strong> (your cell), not
        the Inbox Chief dial-in line. {product.name} will never send email during a
        status call.
        {dialNumber ? (
          <>
            {" "}
            Dial-in line:{" "}
            <a href={`tel:${dialNumber}`}>
              <strong>{formatDialDisplay(dialNumber)}</strong>
            </a>{" "}
            (<code>{dialNumber}</code>).
          </>
        ) : null}
      </p>
      <form className="call-in-phone-form" onSubmit={onSubmit}>
        <label htmlFor="call-in-phone">
          Your phone number with country code
          <input
            id="call-in-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={
              hydrated
                ? "Your phone number with country code"
                : "Loading saved number…"
            }
          />
        </label>
        <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy}>
          {busy ? "Saving…" : "Save call-in phone"}
        </button>
      </form>
      <p className="status-line" role="status" aria-live="assertive">
        {status}
      </p>
    </section>
  );
}
