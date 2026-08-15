/**
 * Product invariant: connect / sync / draft paths must NEVER send mail.
 * Send is only allowed after the explicit human approval + confirm-send path.
 */
export const MAIL_AUTO_SEND_ENABLED = false as const;

export function mailClientMayAutoSend(): false {
  return MAIL_AUTO_SEND_ENABLED;
}

/**
 * Reject any operation list that would send mail (provider-agnostic).
 */
export function assertNeverAutoSend(operations: readonly string[]): void {
  const forbidden = operations.filter((op) => {
    const lower = op.toLowerCase();
    return (
      lower.includes("messages.send") ||
      lower.includes("sendmail") ||
      lower.includes("send_mail") ||
      lower.includes("/sendmail") ||
      lower.includes("auto-send") ||
      lower.includes("autosend") ||
      lower === "smtp.send" ||
      lower === "mail.send"
    );
  });
  if (forbidden.length > 0 || MAIL_AUTO_SEND_ENABLED) {
    throw new Error(
      `Never auto-send: blocked mail operations [${forbidden.join(", ") || "auto_send_enabled"}]`,
    );
  }
}
