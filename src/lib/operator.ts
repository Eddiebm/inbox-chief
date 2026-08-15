/**
 * Operator (Eddie) gate — never use for patron features.
 * Set OPERATOR_EMAILS to a comma-separated list of operator accounts.
 */

export function operatorEmailsFromEnv(
  raw = process.env.OPERATOR_EMAILS,
): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isOperatorEmail(email: string | null | undefined): boolean {
  if (!email?.trim()) return false;
  return operatorEmailsFromEnv().has(email.trim().toLowerCase());
}
