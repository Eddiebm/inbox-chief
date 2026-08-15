import { describe, expect, it } from "vitest";
import {
  applyAnalyticsPrivacyAction,
  canCollectAnalytics,
  defaultAnalyticsPrivacyState,
} from "@/lib/analytics/privacy-consent";
import { gateAnalyticsEvent } from "@/lib/analytics/track";

describe("analytics privacy consent", () => {
  it("starts off with no consent (never on by default)", () => {
    const state = defaultAnalyticsPrivacyState();
    expect(state.analyticsEnabled).toBe(false);
    expect(state.consentGranted).toBe(false);
    expect(state.consentGrantedAt).toBeNull();
    expect(canCollectAnalytics(state)).toBe(false);
  });

  it("rejects enable without explicit consent acknowledgement", () => {
    const state = defaultAnalyticsPrivacyState();
    const result = applyAnalyticsPrivacyAction(state, {
      type: "enable",
      consentAcknowledged: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/consent/i);
    expect(canCollectAnalytics(state)).toBe(false);
  });

  it("enables only after consent acknowledgement", () => {
    const state = defaultAnalyticsPrivacyState();
    const result = applyAnalyticsPrivacyAction(state, {
      type: "enable",
      consentAcknowledged: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.analyticsEnabled).toBe(true);
    expect(result.state.consentGranted).toBe(true);
    expect(result.state.consentGrantedAt).toBeTruthy();
    expect(canCollectAnalytics(result.state)).toBe(true);
  });

  it("disables collection without wiping consent until revoke", () => {
    const enabled = applyAnalyticsPrivacyAction(defaultAnalyticsPrivacyState(), {
      type: "enable",
      consentAcknowledged: true,
    });
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;

    const disabled = applyAnalyticsPrivacyAction(enabled.state, {
      type: "disable",
    });
    expect(disabled.ok).toBe(true);
    if (!disabled.ok) return;
    expect(disabled.state.analyticsEnabled).toBe(false);
    expect(disabled.state.consentGranted).toBe(true);
    expect(canCollectAnalytics(disabled.state)).toBe(false);
  });

  it("revoke_consent resets to default off", () => {
    const enabled = applyAnalyticsPrivacyAction(defaultAnalyticsPrivacyState(), {
      type: "enable",
      consentAcknowledged: true,
    });
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;

    const revoked = applyAnalyticsPrivacyAction(enabled.state, {
      type: "revoke_consent",
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.state).toEqual(defaultAnalyticsPrivacyState());
    expect(canCollectAnalytics(revoked.state)).toBe(false);
  });
});

describe("analytics event gate", () => {
  it("does not track when opted out (default)", () => {
    const result = gateAnalyticsEvent(defaultAnalyticsPrivacyState(), {
      name: "page_view",
      properties: { path: "/dashboard" },
    });
    expect(result).toEqual({ tracked: false, reason: "opted_out" });
  });

  it("does not track when enabled flag is true but consent is false", () => {
    const result = gateAnalyticsEvent(
      {
        analyticsEnabled: true,
        consentGranted: false,
        consentGrantedAt: null,
      },
      { name: "page_view" },
    );
    expect(result.tracked).toBe(false);
    if (!result.tracked) expect(result.reason).toBe("opted_out");
  });

  it("tracks when both flags are true", () => {
    const result = gateAnalyticsEvent(
      {
        analyticsEnabled: true,
        consentGranted: true,
        consentGrantedAt: new Date().toISOString(),
      },
      {
        name: "page_view",
        properties: { path: "/dashboard/settings" },
        scope: {
          organizationId: "org_demo",
          workspaceId: "ws_demo",
        },
      },
    );
    expect(result).toEqual({ tracked: true, name: "page_view" });
  });

  it("rejects incomplete tenant scope on gated events", () => {
    const result = gateAnalyticsEvent(
      {
        analyticsEnabled: true,
        consentGranted: true,
        consentGrantedAt: new Date().toISOString(),
      },
      {
        name: "feature_used",
        scope: {
          organizationId: "org_demo",
          workspaceId: "",
        },
      },
    );
    expect(result).toEqual({ tracked: false, reason: "missing_tenant" });
  });

  it("rejects empty event names", () => {
    const result = gateAnalyticsEvent(
      {
        analyticsEnabled: true,
        consentGranted: true,
        consentGrantedAt: new Date().toISOString(),
      },
      { name: "   " },
    );
    expect(result).toEqual({ tracked: false, reason: "invalid_name" });
  });
});
