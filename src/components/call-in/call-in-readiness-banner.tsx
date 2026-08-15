"use client";

import { useEffect, useState } from "react";

/**
 * Patron banner when dial-in number exists but phone assistant is not linked yet.
 */
export function CallInReadinessBanner() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/call-in/status");
        const data = (await res.json()) as {
          showSetupBanner?: boolean;
          patronMessage?: string | null;
        };
        if (!cancelled && data.showSetupBanner && data.patronMessage) {
          setMessage(data.patronMessage);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!message) return null;

  return (
    <aside
      className="settings-block call-in-readiness-banner"
      role="status"
      aria-live="polite"
    >
      <p>{message}</p>
    </aside>
  );
}
