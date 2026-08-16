"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";

export function EmailCallAlertSettings() {
  const descriptionId = useId();
  const statusId = useId();
  const [enabled, setEnabled] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [mailboxConnected, setMailboxConnected] = useState(false);
  const [allowsEmailCalls, setAllowsEmailCalls] = useState(false);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState("Loading email call preference…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/call-in/email-alerts");
        const data = (await response.json()) as {
          ok?: boolean;
          enabled?: boolean;
          hasPhone?: boolean;
          mailboxConnected?: boolean;
          allowsEmailCalls?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !data.ok) {
          setStatus(data.error ?? "Could not load email call preference.");
          return;
        }
        setEnabled(Boolean(data.enabled) && Boolean(data.allowsEmailCalls));
        setHasPhone(Boolean(data.hasPhone));
        setMailboxConnected(Boolean(data.mailboxConnected));
        setAllowsEmailCalls(Boolean(data.allowsEmailCalls));
        setStatus(
          !data.allowsEmailCalls
            ? "Included on Pro and Business. Upgrade to turn on email call alerts."
            : data.enabled
            ? "On. New Primary mail can trigger a batched phone call."
            : "Off. Inbox Chief will not call when email arrives.",
        );
      } catch {
        if (!cancelled) setStatus("Could not load email call preference.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function update(nextEnabled: boolean) {
    setBusy(true);
    setStatus("Saving…");
    try {
      const response = await fetch("/api/call-in/email-alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        enabled?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        setStatus(data.error ?? "Could not save email call preference.");
        return;
      }
      setEnabled(Boolean(data.enabled));
      setStatus(data.message ?? "Saved.");
    } catch {
      setStatus("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const canEnable = allowsEmailCalls && hasPhone && mailboxConnected;
  return (
    <section className="settings-block" aria-labelledby="email-call-alert-heading">
      <h2 id="email-call-alert-heading">Email call alerts</h2>
      <p id={descriptionId}>
        Optional and off by default. After Gmail sync finds new Primary email,
        Inbox Chief places one batched call to your saved phone. Promotions,
        spam, and other tabs are excluded. Calls pause at your included minute
        limit. Inbox Chief never sends email from the call.
      </p>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || !canEnable}
          aria-describedby={`${descriptionId} ${statusId}`}
          onChange={(event) => void update(event.target.checked)}
        />{" "}
        Call me when I get new Primary email
      </label>
      {!allowsEmailCalls ? (
        <p>
          Included on Pro. <Link href="/dashboard/billing">Upgrade to Pro</Link>{" "}
          for outbound calls when Primary email arrives.
        </p>
      ) : null}
      {allowsEmailCalls && !hasPhone ? (
        <p>Save your phone number above to enable this option.</p>
      ) : null}
      {allowsEmailCalls && hasPhone && !mailboxConnected ? (
        <p>Connect Gmail above to enable this option.</p>
      ) : null}
      <p id={statusId} className="status-line" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
