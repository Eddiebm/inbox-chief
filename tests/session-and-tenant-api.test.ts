import { describe, expect, it } from "vitest";
import { hasSessionCookie, isMockSessionToken, MOCK_SESSION_PREFIX } from "@/lib/session-cookie";
import { assertTenantMatch, TenantAccessError, tenantWhere } from "@/lib/tenant";

describe("session cookie gate", () => {
  it("rejects missing or short cookies", () => {
    expect(hasSessionCookie(undefined)).toBe(false);
    expect(hasSessionCookie("short")).toBe(false);
    expect(hasSessionCookie("a".repeat(16))).toBe(true);
  });

  it("detects mock session tokens", () => {
    expect(isMockSessionToken(`${MOCK_SESSION_PREFIX}abc`)).toBe(true);
    expect(isMockSessionToken("real-token-value-here")).toBe(false);
  });
});

describe("API-style tenant scope on call-in snapshots", () => {
  it("blocks cross-org snapshot reads", () => {
    const scope = {
      organizationId: "org_1",
      workspaceId: "ws_1",
      mailboxId: "mb_1",
      userId: "u_1",
    };
    expect(() =>
      assertTenantMatch(scope, {
        organizationId: "org_2",
        workspaceId: "ws_1",
        mailboxId: "mb_1",
      }),
    ).toThrow(TenantAccessError);
  });

  it("builds where clauses that always include org + workspace", () => {
    const where = tenantWhere({
      organizationId: "org_1",
      workspaceId: "ws_1",
      userId: "u_1",
    });
    expect(where).toMatchObject({
      organizationId: "org_1",
      workspaceId: "ws_1",
    });
  });
});
