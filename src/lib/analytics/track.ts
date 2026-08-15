import {
  canCollectAnalytics,
  defaultAnalyticsPrivacyState,
  type AnalyticsPrivacyState,
} from "@/lib/analytics/privacy-consent";
import type { TenantScope } from "@/lib/tenant";

export const ANALYTICS_PRIVACY_STORAGE_KEY = "inbox-chief-analytics-privacy";

export type AnalyticsEventInput = {
  name: string;
  properties?: Record<string, string | number | boolean | null>;
  /** Tenant scope required for any persisted event path */
  scope?: Pick<TenantScope, "organizationId" | "workspaceId">;
};

export type TrackResult =
  | { tracked: true; name: string }
  | { tracked: false; reason: "opted_out" | "invalid_name" | "missing_tenant" };

export function loadAnalyticsPrivacyState(): AnalyticsPrivacyState {
  if (typeof window === "undefined") return defaultAnalyticsPrivacyState();
  try {
    const raw = localStorage.getItem(ANALYTICS_PRIVACY_STORAGE_KEY);
    if (!raw) return defaultAnalyticsPrivacyState();
    const parsed = JSON.parse(raw) as Partial<AnalyticsPrivacyState>;
    return {
      analyticsEnabled: parsed.analyticsEnabled === true,
      consentGranted: parsed.consentGranted === true,
      consentGrantedAt:
        typeof parsed.consentGrantedAt === "string"
          ? parsed.consentGrantedAt
          : null,
    };
  } catch {
    return defaultAnalyticsPrivacyState();
  }
}

export function saveAnalyticsPrivacyState(state: AnalyticsPrivacyState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ANALYTICS_PRIVACY_STORAGE_KEY, JSON.stringify(state));
}

/**
 * Client-side analytics gate. No-ops unless the user opted in.
 * Never tracks by default; never invents cross-tenant scope.
 */
export function trackAnalyticsEvent(
  input: AnalyticsEventInput,
  state: AnalyticsPrivacyState = loadAnalyticsPrivacyState(),
): TrackResult {
  const name = input.name.trim();
  if (!name) {
    return { tracked: false, reason: "invalid_name" };
  }
  if (!canCollectAnalytics(state)) {
    return { tracked: false, reason: "opted_out" };
  }
  // Persisted ingest paths must include tenant ids; anonymous page beacons may omit.
  if (input.scope) {
    if (!input.scope.organizationId || !input.scope.workspaceId) {
      return { tracked: false, reason: "missing_tenant" };
    }
  }

  // Stub sink — replace with a real provider only behind this gate.
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    console.debug("[analytics:opt-in]", {
      name,
      properties: input.properties ?? {},
      scope: input.scope ?? null,
    });
  }

  return { tracked: true, name };
}

/**
 * Server-side gate for ingest APIs. Same rules as the client helper.
 */
export function gateAnalyticsEvent(
  state: AnalyticsPrivacyState,
  input: AnalyticsEventInput,
): TrackResult {
  return trackAnalyticsEvent(input, state);
}
