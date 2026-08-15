export type GmailConfigStatus =
  | { ok: true; clientId: string; clientSecret: string; redirectUri: string }
  | {
      ok: false;
      reason: "mock_integrations_enabled" | "google_credentials_missing";
      message: string;
    };

export function getGmailOAuthConfig(): GmailConfigStatus {
  if (process.env.MOCK_INTEGRATIONS === "true") {
    return {
      ok: false,
      reason: "mock_integrations_enabled",
      message:
        "Gmail OAuth is disabled while MOCK_INTEGRATIONS=true. Set MOCK_INTEGRATIONS=false and configure Google credentials.",
    };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() ?? "";

  if (!clientId || !clientSecret || !redirectUri) {
    return {
      ok: false,
      reason: "google_credentials_missing",
      message:
        "Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI, then disable MOCK_INTEGRATIONS.",
    };
  }

  return { ok: true, clientId, clientSecret, redirectUri };
}

export function isGmailOAuthConfigured(): boolean {
  return getGmailOAuthConfig().ok;
}
