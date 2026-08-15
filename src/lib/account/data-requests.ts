/**
 * Account data export + deletion request helpers.
 * Tenant-scoped: organizationId must match the caller's org.
 * Deletion never completes immediately — always a cooling-off period.
 */

export const EXPORT_EXPIRY_HOURS = 48;
export const DELETION_COOL_OFF_DAYS = 7;

export type DataExportResult = {
  ok: true;
  status: "REQUESTED";
  organizationId: string;
  expiresAt: Date;
  message: string;
};

export type AccountDeletionResult = {
  ok: true;
  status: "COOLING_OFF";
  organizationId: string;
  coolOffEndsAt: Date;
  message: string;
};

export type DataRequestError = {
  ok: false;
  error: string;
  code:
    | "missing_organization"
    | "tenant_mismatch"
    | "invalid_email"
    | "email_mismatch"
    | "not_acknowledged";
};

export type RequestDataExportInput = {
  organizationId: string;
  /** Caller's tenant org — when set, must match organizationId */
  callerOrganizationId?: string;
  now?: Date;
};

export type ScheduleAccountDeletionInput = {
  organizationId: string;
  confirmEmail: string;
  /** Account email that must match confirmEmail */
  accountEmail: string;
  /** Explicit UI acknowledgement required */
  acknowledged: boolean;
  callerOrganizationId?: string;
  now?: Date;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function assertTenant(
  organizationId: string,
  callerOrganizationId?: string,
): DataRequestError | null {
  if (!organizationId.trim()) {
    return {
      ok: false,
      error: "organizationId is required.",
      code: "missing_organization",
    };
  }
  if (
    callerOrganizationId != null &&
    callerOrganizationId.trim() !== "" &&
    callerOrganizationId !== organizationId
  ) {
    return {
      ok: false,
      error: "Cross-tenant access denied.",
      code: "tenant_mismatch",
    };
  }
  return null;
}

/** Queue a tenant-scoped data export. Download links expire after 48 hours. */
export function requestDataExport(
  input: RequestDataExportInput,
): DataExportResult | DataRequestError {
  const denied = assertTenant(input.organizationId, input.callerOrganizationId);
  if (denied) return denied;

  const now = input.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + EXPORT_EXPIRY_HOURS * 60 * 60 * 1000,
  );

  return {
    ok: true,
    status: "REQUESTED",
    organizationId: input.organizationId,
    expiresAt,
    message:
      "Export queued. You will be notified when your download is ready. Exports expire after 48 hours.",
  };
}

/**
 * Schedule account deletion with a 7-day cooling-off period.
 * Never destroys data immediately — confirmEmail must match accountEmail.
 */
export function scheduleAccountDeletion(
  input: ScheduleAccountDeletionInput,
): AccountDeletionResult | DataRequestError {
  const denied = assertTenant(input.organizationId, input.callerOrganizationId);
  if (denied) return denied;

  const confirm = normalizeEmail(input.confirmEmail);
  const account = normalizeEmail(input.accountEmail);

  if (!looksLikeEmail(confirm) || !looksLikeEmail(account)) {
    return {
      ok: false,
      error: "A valid confirmation email is required.",
      code: "invalid_email",
    };
  }

  if (confirm !== account) {
    return {
      ok: false,
      error: "Confirmation email does not match this account.",
      code: "email_mismatch",
    };
  }

  if (!input.acknowledged) {
    return {
      ok: false,
      error: "You must acknowledge the cooling-off period before scheduling deletion.",
      code: "not_acknowledged",
    };
  }

  const now = input.now ?? new Date();
  const coolOffEndsAt = new Date(
    now.getTime() + DELETION_COOL_OFF_DAYS * 24 * 60 * 60 * 1000,
  );

  return {
    ok: true,
    status: "COOLING_OFF",
    organizationId: input.organizationId,
    coolOffEndsAt,
    message:
      "Deletion scheduled. Your data remains available during a 7-day cooling-off period.",
  };
}
