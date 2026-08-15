import { describe, expect, it } from "vitest";
import {
  INVITATION_EXPIRY_DAYS,
  createInvitationStub,
} from "@/lib/invitations";
import { ROLES } from "@/lib/rbac";

const now = new Date("2026-08-10T12:00:00.000Z");

describe("createInvitationStub", () => {
  it("queues a tenant-scoped invite with role metadata", () => {
    const result = createInvitationStub({
      organizationId: "demo_org",
      callerOrganizationId: "demo_org",
      email: "Teammate@Example.com",
      roleKey: "executive_assistant",
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invitation.email).toBe("teammate@example.com");
    expect(result.invitation.roleKey).toBe("executive_assistant");
    expect(result.invitation.status).toBe("PENDING");
    expect(result.invitation.grantsMailboxAccessByDefault).toBe(true);
    expect(result.invitation.mailboxAccessNote).toBeNull();
    expect(result.invitation.expiresAt.toISOString()).toBe(
      new Date(
        now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
  });

  it("notes that technical_administrator does not get mailbox access by default", () => {
    const role = ROLES.find((r) => r.key === "technical_administrator");
    expect(role?.grantsMailboxAccessByDefault).toBe(false);

    const result = createInvitationStub({
      organizationId: "demo_org",
      email: "admin@example.com",
      roleKey: "technical_administrator",
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invitation.grantsMailboxAccessByDefault).toBe(false);
    expect(result.invitation.mailboxAccessNote).toMatch(
      /mailbox access automatically/i,
    );
    expect(result.message).toMatch(/mailbox access automatically/i);
  });

  it("rejects cross-tenant invitations", () => {
    const result = createInvitationStub({
      organizationId: "org_a",
      callerOrganizationId: "org_b",
      email: "x@example.com",
      roleKey: "reviewer",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("tenant_mismatch");
  });

  it("rejects invalid email and unknown role", () => {
    expect(
      createInvitationStub({
        organizationId: "demo_org",
        email: "not-an-email",
        roleKey: "reviewer",
      }),
    ).toMatchObject({ ok: false, code: "invalid_email" });

    expect(
      createInvitationStub({
        organizationId: "demo_org",
        email: "ok@example.com",
        roleKey: "not_a_role",
      }),
    ).toMatchObject({ ok: false, code: "invalid_role" });
  });
});
