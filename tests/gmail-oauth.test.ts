import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto/token-encryption";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import {
  assertNeverAutoSend,
  assertSyncOperationsSafe,
  GMAIL_AUTO_SEND_ENABLED,
  GMAIL_OAUTH_SCOPES,
  GMAIL_SYNC_ALLOWED_OPERATIONS,
  gmailClientMayAutoSend,
} from "@/lib/gmail/scopes";
import {
  assertMailboxTokenTenantAccess,
  selectMailboxTokensForTenant,
} from "@/lib/gmail/tokens";
import { TenantAccessError } from "@/lib/tenant";
import {
  signGmailOAuthState,
  verifyGmailOAuthState,
} from "@/lib/gmail/oauth-state";

describe("gmail oauth config gates", () => {
  it("refuses connect when MOCK_INTEGRATIONS=true", () => {
    const prevMock = process.env.MOCK_INTEGRATIONS;
    const prevId = process.env.GOOGLE_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
    const prevRedirect = process.env.GOOGLE_REDIRECT_URI;
    process.env.MOCK_INTEGRATIONS = "true";
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REDIRECT_URI =
      "https://inboxchief.email/api/gmail/callback";

    const status = getGmailOAuthConfig();
    expect(status.ok).toBe(false);
    if (!status.ok) {
      expect(status.reason).toBe("mock_integrations_enabled");
      expect(status.message).toMatch(/MOCK_INTEGRATIONS/i);
    }

    process.env.MOCK_INTEGRATIONS = prevMock;
    process.env.GOOGLE_CLIENT_ID = prevId;
    process.env.GOOGLE_CLIENT_SECRET = prevSecret;
    process.env.GOOGLE_REDIRECT_URI = prevRedirect;
  });

  it("refuses connect when Google credentials are missing", () => {
    const prevMock = process.env.MOCK_INTEGRATIONS;
    const prevId = process.env.GOOGLE_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
    const prevRedirect = process.env.GOOGLE_REDIRECT_URI;
    process.env.MOCK_INTEGRATIONS = "false";
    process.env.GOOGLE_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_SECRET = "";
    process.env.GOOGLE_REDIRECT_URI = "";

    const status = getGmailOAuthConfig();
    expect(status.ok).toBe(false);
    if (!status.ok) {
      expect(status.reason).toBe("google_credentials_missing");
      expect(status.message).toMatch(/GOOGLE_CLIENT_ID/i);
    }

    process.env.MOCK_INTEGRATIONS = prevMock;
    process.env.GOOGLE_CLIENT_ID = prevId;
    process.env.GOOGLE_CLIENT_SECRET = prevSecret;
    process.env.GOOGLE_REDIRECT_URI = prevRedirect;
  });
});

describe("mailbox oauth token tenant isolation", () => {
  const tokens = [
    {
      id: "tok_a",
      organizationId: "org_a",
      workspaceId: "ws_a",
      mailboxId: "mb_a",
      accessTokenEnc: "enc_a",
      refreshTokenEnc: "ref_a",
      expiresAt: null,
      scopes: [...GMAIL_OAUTH_SCOPES],
    },
    {
      id: "tok_b",
      organizationId: "org_b",
      workspaceId: "ws_b",
      mailboxId: "mb_b",
      accessTokenEnc: "enc_b",
      refreshTokenEnc: "ref_b",
      expiresAt: null,
      scopes: [...GMAIL_OAUTH_SCOPES],
    },
  ];

  it("blocks cross-tenant token access", () => {
    expect(() =>
      assertMailboxTokenTenantAccess(tokens[0]!, {
        organizationId: "org_b",
        workspaceId: "ws_a",
        mailboxId: "mb_a",
        userId: "u1",
      }),
    ).toThrow(TenantAccessError);

    expect(() =>
      assertMailboxTokenTenantAccess(tokens[0]!, {
        organizationId: "org_a",
        workspaceId: "ws_a",
        mailboxId: "mb_other",
        userId: "u1",
      }),
    ).toThrow(/Mailbox mismatch/);
  });

  it("only returns tokens matching full tenant scope", () => {
    const scoped = selectMailboxTokensForTenant(tokens, {
      organizationId: "org_a",
      workspaceId: "ws_a",
      mailboxId: "mb_a",
      userId: "u1",
    });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.id).toBe("tok_a");
  });
});

describe("never auto-send invariant", () => {
  it("keeps auto-send disabled and scopes least-privilege", () => {
    expect(GMAIL_AUTO_SEND_ENABLED).toBe(false);
    expect(gmailClientMayAutoSend()).toBe(false);
    expect(GMAIL_OAUTH_SCOPES).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
    expect(GMAIL_SYNC_ALLOWED_OPERATIONS).not.toContain("users.messages.send");
    expect(GMAIL_SYNC_ALLOWED_OPERATIONS).not.toContain(
      "users.messages.attachments.get",
    );
  });

  it("rejects sync operations that would send mail", () => {
    expect(() => assertNeverAutoSend(["users.messages.send"])).toThrow(
      /Never auto-send/i,
    );
    expect(() => assertSyncOperationsSafe(GMAIL_SYNC_ALLOWED_OPERATIONS)).not.toThrow();
  });

  it("allows readonly attachment fetch ops without send", async () => {
    const { GMAIL_ATTACHMENT_ALLOWED_OPERATIONS, assertNeverAutoSend: assertNs } =
      await import("@/lib/gmail/scopes");
    expect(GMAIL_ATTACHMENT_ALLOWED_OPERATIONS).toContain(
      "users.messages.attachments.get",
    );
    expect(GMAIL_ATTACHMENT_ALLOWED_OPERATIONS.join(" ")).not.toMatch(/send/i);
    expect(() => assertNs(GMAIL_ATTACHMENT_ALLOWED_OPERATIONS)).not.toThrow();
  });
});

describe("token encryption + oauth state", () => {
  it("round-trips encrypted secrets", () => {
    const prev = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "test-auth-secret-for-gmail";
    const enc = encryptSecret("refresh-token-value");
    expect(enc).not.toContain("refresh-token-value");
    expect(decryptSecret(enc)).toBe("refresh-token-value");
    process.env.AUTH_SECRET = prev;
  });

  it("signs and verifies tenant intent in oauth state", async () => {
    const prev = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "test-auth-secret-for-gmail";
    const token = await signGmailOAuthState({
      organizationId: "org_1",
      workspaceId: "ws_1",
      userId: "user_1",
      nonce: "abc123",
    });
    const payload = await verifyGmailOAuthState(token);
    expect(payload).toMatchObject({
      organizationId: "org_1",
      workspaceId: "ws_1",
      userId: "user_1",
      nonce: "abc123",
    });
    process.env.AUTH_SECRET = prev;
  });
});

describe("extractGmailPlainText for call-in reading", () => {
  it("prefers text/plain over html", async () => {
    const { extractGmailPlainText } = await import("@/lib/gmail/client");
    const plain = Buffer.from("Hello voice briefing").toString("base64url");
    const html = Buffer.from("<p>Ignore me</p>").toString("base64url");
    const text = extractGmailPlainText({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: plain } },
        { mimeType: "text/html", body: { data: html } },
      ],
    });
    expect(text).toBe("Hello voice briefing");
  });
});

describe("gmail auth reconnect detection", () => {
  it("flags invalid_grant as reconnect", async () => {
    const { isGmailAuthFailure, GMAIL_NEEDS_RECONNECT_SPOKEN } = await import(
      "@/lib/gmail/auth-errors"
    );
    expect(isGmailAuthFailure(new Error("invalid_grant"))).toBe(true);
    expect(isGmailAuthFailure(new Error("network timeout"))).toBe(false);
    expect(GMAIL_NEEDS_RECONNECT_SPOKEN).toMatch(/reconnect/i);
  });
});
