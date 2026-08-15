import { describe, expect, it } from "vitest";
import {
  getMessagesForTenant,
  technicalAdminHasAutomaticMailboxAccess,
} from "@/lib/tenant-queries";
import type { TenantScope } from "@/lib/tenant";

const tenantA: TenantScope = {
  organizationId: "org_a",
  workspaceId: "ws_a",
  mailboxId: "mb_a",
  userId: "user_a",
};

const tenantB: TenantScope = {
  organizationId: "org_b",
  workspaceId: "ws_b",
  mailboxId: "mb_b",
  userId: "user_b",
};

const messages = [
  {
    id: "1",
    organizationId: "org_a",
    workspaceId: "ws_a",
    mailboxId: "mb_a",
    subject: "Tenant A mail",
  },
  {
    id: "2",
    organizationId: "org_b",
    workspaceId: "ws_b",
    mailboxId: "mb_b",
    subject: "Tenant B mail",
  },
];

describe("cross-tenant message access", () => {
  it("returns only the requesting tenant messages", () => {
    const result = getMessagesForTenant(tenantA, messages);
    expect(result).toHaveLength(1);
    expect(result[0]?.subject).toBe("Tenant A mail");
  });

  it("blocks another tenant from reading foreign mailbox mail", () => {
    const result = getMessagesForTenant(tenantB, messages);
    expect(result.every((m) => m.organizationId === "org_b")).toBe(true);
    expect(result.find((m) => m.organizationId === "org_a")).toBeUndefined();
  });

  it("does not grant technical admins automatic mailbox access", () => {
    expect(technicalAdminHasAutomaticMailboxAccess()).toBe(false);
  });
});
