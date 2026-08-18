import { afterEach, describe, expect, it } from "vitest";
import { getOutlookOAuthConfig } from "@/lib/outlook/config";
import {
  assertOutlookSyncOperationsSafe,
  OUTLOOK_AUTO_SEND_ENABLED,
  OUTLOOK_OAUTH_SCOPES,
  OUTLOOK_SYNC_ALLOWED_OPERATIONS,
  outlookClientMayAutoSend,
} from "@/lib/outlook/scopes";
import {
  signOutlookOAuthState,
  verifyOutlookOAuthState,
} from "@/lib/outlook/oauth-state";
import { validateImapConnectInput } from "@/lib/imap/client";
import {
  getMailProvider,
  listProviderCapabilities,
  listMailProviders,
  requireMailProvider,
} from "@/lib/mail/providers/registry";
import { assertNeverAutoSend, MAIL_AUTO_SEND_ENABLED } from "@/lib/mail/never-send";
import { assertMailboxTokenTenantAccess } from "@/lib/gmail/tokens";
import { TenantAccessError } from "@/lib/tenant";
import { getImapPreset } from "@/lib/mail/providers/presets";

const envKeys = [
  "MOCK_INTEGRATIONS",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_TENANT_ID",
  "MICROSOFT_REDIRECT_URI",
  "AUTH_SECRET",
] as const;

const savedEnv: Record<string, string | undefined> = {};

function snapshotEnv() {
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
  }
}

function restoreEnv() {
  for (const key of envKeys) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  restoreEnv();
});

describe("mail provider registry", () => {
  it("registers gmail, outlook, yahoo, icloud, and imap", () => {
    const ids = listMailProviders().map((p) => p.id).sort();
    expect(ids).toEqual(["gmail", "icloud", "imap", "outlook", "yahoo"]);

    const caps = listProviderCapabilities();
    expect(caps.every((c) => typeof c.label === "string")).toBe(true);
    expect(getMailProvider("gmail")?.capability.authMode).toBe("oauth");
    expect(getMailProvider("outlook")?.capability.authMode).toBe("oauth");
    expect(getMailProvider("yahoo")?.capability.authMode).toBe(
      "imap_app_password",
    );
    expect(requireMailProvider("imap").id).toBe("imap");
  });

  it("marks oauth providers live and imap family usable for connect", () => {
    expect(getMailProvider("gmail")?.capability.live).toBe(true);
    expect(getMailProvider("outlook")?.capability.live).toBe(true);
    expect(getMailProvider("yahoo")?.capability.live).toBe(true);
  });
});

describe("outlook oauth config gates", () => {
  it("refuses connect when MOCK_INTEGRATIONS=true", () => {
    snapshotEnv();
    process.env.MOCK_INTEGRATIONS = "true";
    process.env.MICROSOFT_CLIENT_ID = "client";
    process.env.MICROSOFT_CLIENT_SECRET = "secret";
    process.env.MICROSOFT_REDIRECT_URI =
      "https://inboxchief.email/api/outlook/callback";

    const status = getOutlookOAuthConfig();
    expect(status.ok).toBe(false);
    if (!status.ok) {
      expect(status.reason).toBe("mock_integrations_enabled");
    }
  });

  it("refuses connect when Microsoft credentials are missing", () => {
    snapshotEnv();
    process.env.MOCK_INTEGRATIONS = "false";
    process.env.MICROSOFT_CLIENT_ID = "";
    process.env.MICROSOFT_CLIENT_SECRET = "";
    process.env.MICROSOFT_REDIRECT_URI = "";

    const status = getOutlookOAuthConfig();
    expect(status.ok).toBe(false);
    if (!status.ok) {
      expect(status.reason).toBe("microsoft_credentials_missing");
      expect(status.message).toMatch(/MICROSOFT_CLIENT_ID/i);
    }
  });

  it("accepts common tenant when credentials are present", () => {
    snapshotEnv();
    process.env.MOCK_INTEGRATIONS = "false";
    process.env.MICROSOFT_CLIENT_ID = "client-id";
    process.env.MICROSOFT_CLIENT_SECRET = "client-secret";
    process.env.MICROSOFT_REDIRECT_URI =
      "https://inboxchief.email/api/outlook/callback";
    delete process.env.MICROSOFT_TENANT_ID;

    const status = getOutlookOAuthConfig();
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.tenantId).toBe("common");
    }
  });
});

describe("imap connect validation", () => {
  it("requires tenant scope, email, password, and hosts", () => {
    expect(
      validateImapConnectInput({
        organizationId: "",
        workspaceId: "ws",
        userId: "u",
      }).ok,
    ).toBe(false);

    expect(
      validateImapConnectInput({
        organizationId: "org",
        workspaceId: "ws",
        userId: "u",
        provider: "imap",
        emailAddress: "not-an-email",
        password: "app-pass",
        imapHost: "imap.example.com",
        imapPort: 993,
        smtpHost: "smtp.example.com",
        smtpPort: 465,
      }).ok,
    ).toBe(false);

    const yahoo = getImapPreset("yahoo");
    const ok = validateImapConnectInput({
      organizationId: "org",
      workspaceId: "ws",
      userId: "u",
      provider: "yahoo",
      emailAddress: "user@yahoo.com",
      password: "app-password-here",
      imapHost: yahoo.imapHost,
      imapPort: yahoo.imapPort,
      smtpHost: yahoo.smtpHost,
      smtpPort: yahoo.smtpPort,
    });
    expect(ok.ok).toBe(true);
  });

  it("rejects invalid ports", () => {
    const result = validateImapConnectInput({
      organizationId: "org",
      workspaceId: "ws",
      userId: "u",
      provider: "imap",
      emailAddress: "a@b.com",
      password: "secret",
      imapHost: "imap.example.com",
      imapPort: 99999,
      smtpHost: "smtp.example.com",
      smtpPort: 465,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ports_invalid");
    }
  });
});

describe("mailbox oauth token tenant isolation (shared)", () => {
  it("blocks cross-tenant token access for outlook-shaped records", () => {
    expect(() =>
      assertMailboxTokenTenantAccess(
        {
          organizationId: "org_a",
          workspaceId: "ws_a",
          mailboxId: "mb_a",
        },
        {
          organizationId: "org_b",
          workspaceId: "ws_a",
          mailboxId: "mb_a",
          userId: "u1",
        },
      ),
    ).toThrow(TenantAccessError);
  });
});

describe("never auto-send invariant (all providers)", () => {
  it("keeps auto-send disabled across mail + outlook scopes", () => {
    expect(MAIL_AUTO_SEND_ENABLED).toBe(false);
    expect(OUTLOOK_AUTO_SEND_ENABLED).toBe(false);
    expect(outlookClientMayAutoSend()).toBe(false);
    expect(OUTLOOK_OAUTH_SCOPES).toContain("Mail.Read");
    expect(OUTLOOK_OAUTH_SCOPES).toContain("Mail.Send");
    expect(OUTLOOK_SYNC_ALLOWED_OPERATIONS.join(" ")).not.toMatch(/sendmail/i);
  });

  it("rejects send operations for sync paths", () => {
    expect(() => assertNeverAutoSend(["POST /me/sendMail"])).toThrow(
      /Never auto-send/i,
    );
    expect(() =>
      assertOutlookSyncOperationsSafe(OUTLOOK_SYNC_ALLOWED_OPERATIONS),
    ).not.toThrow();
  });
});

describe("outlook oauth state", () => {
  it("signs and verifies tenant intent", async () => {
    snapshotEnv();
    process.env.AUTH_SECRET = "test-auth-secret-for-outlook";
    const token = await signOutlookOAuthState({
      organizationId: "org_1",
      workspaceId: "ws_1",
      userId: "user_1",
      nonce: "xyz789",
    });
    const payload = await verifyOutlookOAuthState(token);
    expect(payload).toMatchObject({
      organizationId: "org_1",
      workspaceId: "ws_1",
      userId: "user_1",
      nonce: "xyz789",
    });
  });
});
