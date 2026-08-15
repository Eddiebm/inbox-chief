"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

/**
 * Operator-only setup checklist (Eddie). Never shown to normal patrons.
 */
export function OperatorSetupPanel() {
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [status, setStatus] = useState("Checking operator access…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch("/api/auth/me");
        const me = (await meRes.json()) as { isOperator?: boolean };
        if (cancelled) return;
        if (!me.isOperator) {
          setVisible(false);
          return;
        }
        setVisible(true);

        const [mailRes, callRes] = await Promise.all([
          fetch("/api/mail/status"),
          fetch("/api/call-in/status"),
        ]);
        const mail = (await mailRes.json()) as {
          oauth?: { gmail?: boolean };
        };
        const call = (await callRes.json()) as {
          numberConfigured?: boolean;
          assistantLinked?: boolean;
        };
        if (cancelled) return;

        const oauthPublished =
          process.env.NEXT_PUBLIC_GOOGLE_OAUTH_PUBLISHED === "true";

        setItems([
          {
            id: "gmail",
            label: "Gmail OAuth env",
            ok: Boolean(mail.oauth?.gmail),
            detail: mail.oauth?.gmail
              ? "Google client credentials are configured."
              : "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI; MOCK_INTEGRATIONS=false.",
          },
          {
            id: "google-test-user",
            label: "Google test user / Published",
            ok: oauthPublished,
            detail: oauthPublished
              ? "OAuth app marked published (NEXT_PUBLIC_GOOGLE_OAUTH_PUBLISHED)."
              : "Until Published: add each new patron Gmail as a test user before invite. Use Admin onboard.",
          },
          {
            id: "vapi-number",
            label: "VAPI call-in number",
            ok: Boolean(call.numberConfigured),
            detail: call.numberConfigured
              ? "Public call-in number is set."
              : "Set NEXT_PUBLIC_VAPI_CALL_IN_NUMBER.",
          },
          {
            id: "vapi-assistant",
            label: "Assistant linked",
            ok: Boolean(call.assistantLinked),
            detail: call.assistantLinked
              ? "VAPI_ASSISTANT_ID is set (assistant ↔ number link)."
              : "Link assistant to the phone number and set VAPI_ASSISTANT_ID.",
          },
        ]);
        setStatus("Operator checklist loaded.");
      } catch {
        if (!cancelled) {
          setVisible(false);
          setStatus("Could not load operator checklist.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <section
      className="settings-block operator-setup-panel"
      aria-labelledby="operator-setup-heading"
    >
      <h2 id="operator-setup-heading">Operator setup (Eddie only)</h2>
      <p>
        Patron-facing screens never show these checks. Complete them so blind
        patrons only see signup → voice onboarding → Connect Gmail → save phone.
      </p>
      <p>
        <Link href="/dashboard/admin/onboard">Admin onboard a patron</Link>
        {" · "}
        See <code>docs/OPERATOR_RUNBOOK.md</code> in the repo.
      </p>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.ok ? "Ready" : "Needed"}:</strong> {item.label} —{" "}
            {item.detail}
          </li>
        ))}
      </ul>
      <p className="status-line" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
