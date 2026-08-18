/** Placeholder until Eddie creates the dedicated Inbox Chief GCP project. */
export const GOOGLE_CLOUD_PROJECT_ID_PLACEHOLDER = "YOUR_PROJECT_ID";

function readProjectId(): string {
  const fromPublic = process.env.NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_ID?.trim();
  if (fromPublic) return fromPublic;

  const fromServer = process.env.GOOGLE_CLOUD_PROJECT_ID?.trim();
  if (fromServer) return fromServer;

  return GOOGLE_CLOUD_PROJECT_ID_PLACEHOLDER;
}

export function getGoogleCloudProjectId(): string {
  return readProjectId();
}

function consoleAuthPath(
  segment: "audience" | "branding" | "clients" | "scopes" | "verification",
  projectId?: string,
): string {
  const id = projectId ?? readProjectId();
  return `https://console.cloud.google.com/auth/${segment}?project=${encodeURIComponent(id)}`;
}

/** Google Auth Platform → Audience (test users / publishing). */
export function googleOAuthAudienceUrl(projectId?: string): string {
  return consoleAuthPath("audience", projectId);
}

export function googleOAuthBrandingUrl(projectId?: string): string {
  return consoleAuthPath("branding", projectId);
}

export function googleOAuthClientsUrl(projectId?: string): string {
  return consoleAuthPath("clients", projectId);
}

export function googleOAuthScopesUrl(projectId?: string): string {
  return consoleAuthPath("scopes", projectId);
}

export function googleOAuthVerificationUrl(projectId?: string): string {
  return consoleAuthPath("verification", projectId);
}
