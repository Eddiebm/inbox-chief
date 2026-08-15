"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  loadAnalyticsPrivacyState,
  trackAnalyticsEvent,
} from "@/lib/analytics/track";

/**
 * Fires a page_view only when the user has opted into product analytics.
 * Silent no-op by default — never loads a third-party SDK.
 */
export function OptInPageBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    const state = loadAnalyticsPrivacyState();
    const result = trackAnalyticsEvent(
      {
        name: "page_view",
        properties: { path: pathname },
      },
      state,
    );
    if (!result.tracked) return;

    void fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "page_view",
        properties: { path: pathname },
        state,
      }),
      keepalive: true,
    }).catch(() => {
      /* ignore network errors for optional analytics */
    });
  }, [pathname]);

  return null;
}
