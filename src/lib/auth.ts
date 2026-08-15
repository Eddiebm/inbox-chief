import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { MOCK_SESSION_PREFIX, SESSION_COOKIE } from "@/lib/session-cookie";

const COOKIE = SESSION_COOKIE;

function authSecret() {
  return process.env.AUTH_SECRET ?? "dev-only-change-me";
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 64).toString("hex");
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(next, "hex"));
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return createHmac("sha256", authSecret()).update(token).digest("hex");
}

async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

async function nodePrisma() {
  const { getNodePrisma } = await import("@/lib/db-node");
  return getNodePrisma();
}

/** Dev/mock session — no database row; enough for dashboard gate + local UX */
export async function createMockSession(email: string) {
  const token = `${MOCK_SESSION_PREFIX}${Buffer.from(email).toString("base64url")}.${randomBytes(16).toString("hex")}`;
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
  await setSessionCookie(token, expiresAt);
  return token;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
  const prisma = await nodePrisma();
  await prisma.session.create({
    data: { userId, tokenHash, expiresAt },
  });
  await setSessionCookie(token, expiresAt);
  return token;
}

export async function getCurrentUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  if (token.startsWith(MOCK_SESSION_PREFIX)) {
    // Stale mock cookies after MOCK_INTEGRATIONS=false must not look authenticated.
    if (process.env.MOCK_INTEGRATIONS !== "true") {
      jar.delete(COOKIE);
      return null;
    }
    return {
      id: "mock_user",
      email: "mock@example.com",
      firstName: "there",
      lastName: "",
      preferredName: "there",
    };
  }
  const prisma = await nodePrisma();
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token && !token.startsWith(MOCK_SESSION_PREFIX)) {
    const prisma = await nodePrisma();
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  jar.delete(COOKIE);
}
