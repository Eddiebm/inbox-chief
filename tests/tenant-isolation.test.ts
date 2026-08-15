import { describe, expect, it } from "vitest";
import {
  assertTenantMatch,
  TenantAccessError,
  tenantWhere,
  type TenantScope,
} from "@/lib/tenant";
import { ROLES } from "@/lib/rbac";

const baseScope: TenantScope = {
  organizationId: "org_a",
  workspaceId: "ws_a",
  mailboxId: "mb_a",
  userId: "user_a",
};

describe("cross-tenant isolation", () => {
  it("assertTenantMatch throws on organization mismatch", () => {
    expect(() =>
      assertTenantMatch(baseScope, {
        organizationId: "org_other",
        workspaceId: "ws_a",
        mailboxId: "mb_a",
      }),
    ).toThrow(TenantAccessError);

    expect(() =>
      assertTenantMatch(baseScope, {
        organizationId: "org_other",
        workspaceId: "ws_a",
        mailboxId: "mb_a",
      }),
    ).toThrow(/Organization mismatch/);
  });

  it("assertTenantMatch throws on mailbox mismatch when scoped", () => {
    expect(() =>
      assertTenantMatch(baseScope, {
        organizationId: "org_a",
        workspaceId: "ws_a",
        mailboxId: "mb_other",
      }),
    ).toThrow(TenantAccessError);

    expect(() =>
      assertTenantMatch(baseScope, {
        organizationId: "org_a",
        workspaceId: "ws_a",
        mailboxId: "mb_other",
      }),
    ).toThrow(/Mailbox mismatch/);
  });

  it("tenantWhere always includes organizationId and workspaceId", () => {
    const where = tenantWhere(baseScope, { status: "ACTIVE" });

    expect(where).toMatchObject({
      organizationId: "org_a",
      workspaceId: "ws_a",
      mailboxId: "mb_a",
      status: "ACTIVE",
    });

    const withoutMailbox = tenantWhere({
      organizationId: "org_b",
      workspaceId: "ws_b",
      userId: "user_b",
    });

    expect(withoutMailbox.organizationId).toBe("org_b");
    expect(withoutMailbox.workspaceId).toBe("ws_b");
    expect(withoutMailbox).not.toHaveProperty("mailboxId");
  });

  it("technical_administrator grantsMailboxAccessByDefault is false", () => {
    const technicalAdmin = ROLES.find((r) => r.key === "technical_administrator");

    expect(technicalAdmin).toBeDefined();
    expect(technicalAdmin!.grantsMailboxAccessByDefault).toBe(false);
  });
});
