/**
 * Microsoft Outlook / Microsoft 365 OAuth — least privilege.
 * Scopes: Mail.Read + Mail.Send (send ONLY after human approval).
 * NEVER auto-send.
 */

export type OutlookConfigStatus =
  | {
      ok: true;
      clientId: string;
      clientSecret: string;
      tenantId: string;
      redirectUri: string;
    }
  | {
      ok: false;
      reason: "mock_integrations_enabled" | "microsoft_credentials_missing";
      message: string;
    };

export function getOutlookOAuthConfig(): OutlookConfigStatus {
  if (process.env.MOCK_INTEGRATIONS === "true") {
    return {
      ok: false,
      reason: "mock_integrations_enabled",
      message:
        "Outlook OAuth is disabled while MOCK_INTEGRATIONS=true. Set MOCK_INTEGRATIONS=false and configure Microsoft credentials.",
    };
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim() ?? "";
  const tenantId =
    process.env.MICROSOFT_TENANT_ID?.trim() || "common";
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI?.trim() ?? "";

  if (!clientId || !clientSecret || !redirectUri) {
    return {
      ok: false,
      reason: "microsoft_credentials_missing",
      message:
        "Outlook OAuth is not configured. Set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_REDIRECT_URI in Azure App Registration, then disable MOCK_INTEGRATIONS.",
    };
  }

  return { ok: true, clientId, clientSecret, tenantId, redirectUri };
}

export function isOutlookOAuthConfigured(): boolean {
  return getOutlookOAuthConfig().ok;
}

export function microsoftAuthorizeUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
}

export function microsoftTokenUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}
