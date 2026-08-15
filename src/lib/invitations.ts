import { ROLES } from "@/lib/rbac";

export const INVITATION_EXPIRY_DAYS = 7;

export type RoleKey = (typeof ROLES)[number]["key"];

export const ROLE_KEYS = ROLES.map((r) => r.key) as [RoleKey, ...RoleKey[]];

export type CreateInvitationInput = {
  organizationId: string;
  email: string;
  roleKey: string;
  /** Caller's tenant org — when set, must match organizationId */
  callerOrganizationId?: string;
  invitedById?: string;
  now?: Date;
};

export type InvitationStub = {
  id: string;
  organizationId: string;
  email: string;
  roleKey: RoleKey;
  roleName: string;
  status: "PENDING";
  expiresAt: Date;
  grantsMailboxAccessByDefault: boolean;
  mailboxAccessNote: string | null;
};

export type CreateInvitationResult =
  | {
      ok: true;
      invitation: InvitationStub;
      message: string;
    }
  | {
      ok: false;
      error: string;
      code:
        | "missing_organization"
        | "tenant_mismatch"
        | "invalid_email"
        | "invalid_role";
    };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isRoleKey(value: string): value is RoleKey {
  return ROLE_KEYS.includes(value as RoleKey);
}

/**
 * Stub: queue a tenant-scoped team invitation.
 * Does not send email or write to the database yet.
 * Technical Administrator never receives mailbox access automatically.
 */
export function createInvitationStub(
  input: CreateInvitationInput,
): CreateInvitationResult {
  const organizationId = input.organizationId.trim();
  if (!organizationId) {
    return {
      ok: false,
      error: "organizationId is required.",
      code: "missing_organization",
    };
  }

  if (
    input.callerOrganizationId != null &&
    input.callerOrganizationId.trim() !== "" &&
    input.callerOrganizationId !== organizationId
  ) {
    return {
      ok: false,
      error: "Cross-tenant access denied.",
      code: "tenant_mismatch",
    };
  }

  const email = normalizeEmail(input.email);
  if (!looksLikeEmail(email)) {
    return {
      ok: false,
      error: "A valid email address is required.",
      code: "invalid_email",
    };
  }

  if (!isRoleKey(input.roleKey)) {
    return {
      ok: false,
      error: "Unknown role.",
      code: "invalid_role",
    };
  }

  const role = ROLES.find((r) => r.key === input.roleKey)!;
  const now = input.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  const mailboxAccessNote = role.grantsMailboxAccessByDefault
    ? null
    : "Technical Administrator does not receive mailbox access automatically. Grant mailbox access separately if needed.";

  const invitation: InvitationStub = {
    id: `inv_stub_${now.getTime()}`,
    organizationId,
    email,
    roleKey: role.key,
    roleName: role.name,
    status: "PENDING",
    expiresAt,
    grantsMailboxAccessByDefault: role.grantsMailboxAccessByDefault,
    mailboxAccessNote,
  };

  const message = mailboxAccessNote
    ? `Invitation queued for ${email} as ${role.name}. ${mailboxAccessNote}`
    : `Invitation queued for ${email} as ${role.name}. Email delivery is not connected yet.`;

  return { ok: true, invitation, message };
}
