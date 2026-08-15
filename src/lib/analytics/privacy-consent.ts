/**
 * Product analytics privacy — opt-in only, never on by default.
 * Collection is allowed only when the owner enables it with explicit consent.
 * Events must stay tenant-scoped (organizationId + workspaceId when present).
 */

export type AnalyticsPrivacyState = {
  analyticsEnabled: boolean;
  consentGranted: boolean;
  consentGrantedAt: string | null;
};

export type AnalyticsPrivacyAction =
  | { type: "enable"; consentAcknowledged: boolean }
  | { type: "disable" }
  | { type: "revoke_consent" };

export function defaultAnalyticsPrivacyState(): AnalyticsPrivacyState {
  return {
    analyticsEnabled: false,
    consentGranted: false,
    consentGrantedAt: null,
  };
}

/**
 * Apply a consent-gated analytics action. Enable requires acknowledgement.
 */
export function applyAnalyticsPrivacyAction(
  state: AnalyticsPrivacyState,
  action: AnalyticsPrivacyAction,
  now: Date = new Date(),
): { ok: true; state: AnalyticsPrivacyState } | { ok: false; error: string } {
  switch (action.type) {
    case "enable": {
      if (!action.consentAcknowledged) {
        return {
          ok: false,
          error:
            "Product analytics requires explicit consent. Acknowledge before enabling.",
        };
      }
      return {
        ok: true,
        state: {
          analyticsEnabled: true,
          consentGranted: true,
          consentGrantedAt: now.toISOString(),
        },
      };
    }
    case "disable": {
      return {
        ok: true,
        state: {
          ...state,
          analyticsEnabled: false,
          // Consent record remains until revoked; collection is off.
        },
      };
    }
    case "revoke_consent": {
      return {
        ok: true,
        state: defaultAnalyticsPrivacyState(),
      };
    }
    default: {
      const _exhaustive: never = action;
      return { ok: false, error: `Unknown action: ${JSON.stringify(_exhaustive)}` };
    }
  }
}

/** Collection is allowed only when both flags are true. */
export function canCollectAnalytics(state: AnalyticsPrivacyState): boolean {
  return state.analyticsEnabled === true && state.consentGranted === true;
}
