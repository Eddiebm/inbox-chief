/** Screen-reader / spoken copy shared by Connect Gmail, onboarding, and settings. */

export function gmailConnectedSpoken(email: string | null | undefined): string {
  const trimmed = email?.trim();
  if (trimmed) {
    return `Gmail connected as ${trimmed}. Nothing sends without your approval.`;
  }
  return "Gmail connected. Nothing sends without your approval.";
}
