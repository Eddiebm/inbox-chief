import { describe, expect, it } from "vitest";
import { gmailNeedsReconnectSpoken } from "@/lib/a11y/copy";
import { mailboxNeedsReconnectSnapshot } from "@/lib/call-in/assistant";
import { needsReconnectReason } from "@/lib/call-in/identity";
import { GMAIL_NEEDS_RECONNECT_SPOKEN } from "@/lib/gmail/auth-errors";
import { humanizeMailboxConnectReason } from "@/lib/mail/connect-errors";

const CONSOLE_JARGON =
  /cloud console|google cloud|test user|oauth|client id|env|refresh token|invalid_grant|scope/i;

describe("invalid-token reconnect messaging", () => {
  it("speaks a plain-language reconnect instruction on the phone", () => {
    expect(GMAIL_NEEDS_RECONNECT_SPOKEN).toMatch(/needs reconnecting/i);
    expect(GMAIL_NEEDS_RECONNECT_SPOKEN).toMatch(/Connect Gmail/);
    expect(GMAIL_NEEDS_RECONNECT_SPOKEN).not.toMatch(CONSOLE_JARGON);
  });

  it("never reads stale mail when the token is dead", () => {
    const snapshot = mailboxNeedsReconnectSnapshot("Alex", "patron@gmail.com");
    expect(snapshot.connectionStatus).toBe("error");
    expect(snapshot.readableEmails).toHaveLength(0);
    expect(snapshot.recentSubjects).toHaveLength(0);
    expect(snapshot.briefing).toMatch(/needs reconnecting/i);
    expect(needsReconnectReason("needs_reconnect")).toBe(true);
    expect(needsReconnectReason("mailbox_token_missing")).toBe(true);
    expect(needsReconnectReason("rate_limited")).toBe(false);
  });

  it("names the mailbox on screen and stays jargon-free", () => {
    const spoken = gmailNeedsReconnectSpoken("patron@gmail.com");
    expect(spoken).toMatch(/patron@gmail\.com/);
    expect(spoken).toMatch(/Tap Connect Gmail/i);
    expect(spoken).not.toMatch(CONSOLE_JARGON);
    expect(gmailNeedsReconnectSpoken(null)).toMatch(/needs reconnecting/i);
  });

  it("maps expired-token callback reasons to a reconnect prompt", () => {
    for (const reason of ["needs_reconnect", "invalid_grant"]) {
      const copy = humanizeMailboxConnectReason(reason);
      expect(copy).toMatch(/needs reconnecting/i);
      expect(copy).toMatch(/Connect Gmail/);
    }
  });

  it("keeps every patron-facing connect error free of operator jargon", () => {
    const reasons = [
      "access_denied",
      "redirect_uri_mismatch",
      "google_credentials_missing",
      "gmail_not_configured",
      "invalid_client",
      "token_exchange_failed",
      "authentication_required",
      "mock_session",
      "mailbox_scope_unavailable",
      "missing_code_or_state",
      "callback_failed",
      "connect_failed",
      "needs_reconnect",
      "unknown",
    ];
    for (const reason of reasons) {
      expect(humanizeMailboxConnectReason(reason)).not.toMatch(CONSOLE_JARGON);
    }
  });
});
