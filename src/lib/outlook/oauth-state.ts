import { SignJWT, jwtVerify } from "jose";

export type OutlookOAuthStatePayload = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  mailboxId?: string;
  nonce: string;
};

function stateSecret() {
  const secret =
    process.env.AUTH_SECRET?.trim() ||
    process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
    "dev-only-change-me";
  return new TextEncoder().encode(secret);
}

export async function signOutlookOAuthState(
  payload: OutlookOAuthStatePayload,
): Promise<string> {
  return new SignJWT({
    organizationId: payload.organizationId,
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    mailboxId: payload.mailboxId,
    nonce: payload.nonce,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .setAudience("outlook-oauth")
    .setIssuer("inbox-chief")
    .sign(stateSecret());
}

export async function verifyOutlookOAuthState(
  token: string,
): Promise<OutlookOAuthStatePayload> {
  const { payload } = await jwtVerify(token, stateSecret(), {
    audience: "outlook-oauth",
    issuer: "inbox-chief",
  });

  const organizationId = String(payload.organizationId ?? "");
  const workspaceId = String(payload.workspaceId ?? "");
  const userId = String(payload.userId ?? "");
  const nonce = String(payload.nonce ?? "");
  const mailboxId = payload.mailboxId
    ? String(payload.mailboxId)
    : undefined;

  if (!organizationId || !workspaceId || !userId || !nonce) {
    throw new Error("Invalid Outlook OAuth state payload");
  }

  return { organizationId, workspaceId, userId, mailboxId, nonce };
}
