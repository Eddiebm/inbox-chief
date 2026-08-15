import { describe, expect, it } from "vitest";
import {
  DELETION_COOL_OFF_DAYS,
  EXPORT_EXPIRY_HOURS,
  requestDataExport,
  scheduleAccountDeletion,
} from "@/lib/account/data-requests";

const now = new Date("2026-08-10T12:00:00.000Z");

describe("requestDataExport", () => {
  it("queues a tenant-scoped export with 48h expiry", () => {
    const result = requestDataExport({
      organizationId: "demo_org",
      callerOrganizationId: "demo_org",
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("REQUESTED");
    expect(result.organizationId).toBe("demo_org");
    expect(result.expiresAt.toISOString()).toBe(
      new Date(now.getTime() + EXPORT_EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
    );
    expect(result.message).toMatch(/48 hours/i);
  });

  it("rejects missing organizationId", () => {
    const result = requestDataExport({ organizationId: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("missing_organization");
  });

  it("rejects cross-tenant export requests", () => {
    const result = requestDataExport({
      organizationId: "org_a",
      callerOrganizationId: "org_b",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("tenant_mismatch");
  });
});

describe("scheduleAccountDeletion", () => {
  it("schedules cooling-off when email matches and acknowledged", () => {
    const result = scheduleAccountDeletion({
      organizationId: "demo_org",
      callerOrganizationId: "demo_org",
      confirmEmail: "Mock@Example.com",
      accountEmail: "mock@example.com",
      acknowledged: true,
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("COOLING_OFF");
    expect(result.coolOffEndsAt.toISOString()).toBe(
      new Date(
        now.getTime() + DELETION_COOL_OFF_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
    expect(result.message).toMatch(/7-day/i);
  });

  it("never schedules without acknowledgement", () => {
    const result = scheduleAccountDeletion({
      organizationId: "demo_org",
      confirmEmail: "mock@example.com",
      accountEmail: "mock@example.com",
      acknowledged: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_acknowledged");
  });

  it("rejects email mismatch (no accidental wipe)", () => {
    const result = scheduleAccountDeletion({
      organizationId: "demo_org",
      confirmEmail: "other@example.com",
      accountEmail: "mock@example.com",
      acknowledged: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("email_mismatch");
  });

  it("rejects cross-tenant deletion", () => {
    const result = scheduleAccountDeletion({
      organizationId: "org_a",
      callerOrganizationId: "org_b",
      confirmEmail: "a@example.com",
      accountEmail: "a@example.com",
      acknowledged: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("tenant_mismatch");
  });
});
