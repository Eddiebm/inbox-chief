import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 60 * 60 * 1000; // 1 hour

function authSecret() {
  return process.env.AUTH_SECRET ?? "dev-only-change-me";
}

function sign(payload: string): string {
  return createHmac("sha256", authSecret()).update(payload).digest("hex");
}

export function createPasswordResetToken(userId: string, email: string): string {
  const exp = Date.now() + TTL_MS;
  const payload = `${userId}.${exp}.${email.trim().toLowerCase()}`;
  return Buffer.from(`${payload}.${sign(payload)}`).toString("base64url");
}

export function verifyPasswordResetToken(
  token: string,
): { userId: string; email: string } | null {
  let decoded: string;
  try {
    const buf = Buffer.from(token, "base64url");
    decoded = buf.toString("utf8");
    // Reject tokens that don't round-trip (trailing junk, padding tricks)
    if (Buffer.from(decoded, "utf8").toString("base64url") !== token) {
      return null;
    }
  } catch {
    return null;
  }
  const lastDot = decoded.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const payload = decoded.slice(0, lastDot);
  const sig = decoded.slice(lastDot + 1);
  if (!payload || !sig) return null;

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const parts = payload.split(".");
  const userId = parts[0];
  const expRaw = parts[1];
  const email = parts.slice(2).join(".");
  const exp = Number(expRaw);
  if (!userId || !email || !Number.isFinite(exp) || exp < Date.now()) {
    return null;
  }
  return { userId, email: email.toLowerCase() };
}

export const FORGOT_PASSWORD_GENERIC =
  "If an account exists for that email, you can reset your password from the link we send. If you were set up by Inbox Chief, ask them to set a temporary password, then sign in.";
