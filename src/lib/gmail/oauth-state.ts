import { SignJWT, jwtVerify } from "jose";

export type GmailOAuthStatePayload = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  /** Optional pre-created mailbox; otherwise created on callback */
  mailboxId?: string;
  nonce: string;
  /** Safe post-OAuth path: /onboarding or /dashboard/settings */
  returnTo?: string;
  purpose?: "gmail" | "calendar";
};

const ALLOWED_RETURN_TO = new Set(["/onboarding", "/dashboard/settings"]);

export function sanitizeGmailReturnTo(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return ALLOWED_RETURN_TO.has(trimmed) ? trimmed : undefined;
}

function stateSecret() {
  const secret =
    process.env.AUTH_SECRET?.trim() ||
    process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
    "dev-only-change-me";
  return new TextEncoder().encode(secret);
}

export async function signGmailOAuthState(
  payload: GmailOAuthStatePayload,
): Promise<string> {
  return new SignJWT({
    organizationId: payload.organizationId,
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    mailboxId: payload.mailboxId,
    nonce: payload.nonce,
    returnTo: payload.returnTo,
    purpose: payload.purpose ?? "gmail",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .setAudience("gmail-oauth")
    .setIssuer("inbox-chief")
    .sign(stateSecret());
}

export async function verifyGmailOAuthState(
  token: string,
): Promise<GmailOAuthStatePayload> {
  const { payload } = await jwtVerify(token, stateSecret(), {
    audience: "gmail-oauth",
    issuer: "inbox-chief",
  });

  const organizationId = String(payload.organizationId ?? "");
  const workspaceId = String(payload.workspaceId ?? "");
  const userId = String(payload.userId ?? "");
  const nonce = String(payload.nonce ?? "");
  const mailboxId = payload.mailboxId
    ? String(payload.mailboxId)
    : undefined;
  const returnTo = sanitizeGmailReturnTo(
    payload.returnTo ? String(payload.returnTo) : undefined,
  );
  const purpose = payload.purpose === "calendar" ? "calendar" : "gmail";

  if (!organizationId || !workspaceId || !userId || !nonce) {
    throw new Error("Invalid Gmail OAuth state payload");
  }

  return { organizationId, workspaceId, userId, mailboxId, nonce, returnTo, purpose };
}
