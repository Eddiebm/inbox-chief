/**
 * Boot-time guard: refuse to start a production server that would sign
 * sessions or encrypt mailbox tokens with the development placeholder.
 *
 * A deploy that boots with `dev-only-change-me` looks healthy while every
 * session cookie and every stored Gmail refresh token is forgeable by anyone
 * who has read the repository.
 */

import { isPlaceholderSecret, isProductionRuntime } from "@/lib/security/secrets";

export type InsecureSecret = {
  name: string;
  reason: "missing" | "placeholder";
};

/**
 * `TOKEN_ENCRYPTION_KEY` intentionally falls back to `AUTH_SECRET` (see
 * `lib/crypto/token-encryption`). Rotating it invalidates every stored token,
 * so we require a real *effective* key rather than forcing both variables.
 */
export function findInsecureProductionSecrets(
  env: NodeJS.ProcessEnv = process.env,
): InsecureSecret[] {
  const problems: InsecureSecret[] = [];

  const authSecret = env.AUTH_SECRET?.trim();
  if (!authSecret) {
    problems.push({ name: "AUTH_SECRET", reason: "missing" });
  } else if (isPlaceholderSecret(authSecret)) {
    problems.push({ name: "AUTH_SECRET", reason: "placeholder" });
  }

  const tokenKey = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (tokenKey) {
    if (isPlaceholderSecret(tokenKey)) {
      problems.push({ name: "TOKEN_ENCRYPTION_KEY", reason: "placeholder" });
    }
  } else if (!authSecret || isPlaceholderSecret(authSecret)) {
    // No dedicated key and no usable fallback — mailbox tokens would be
    // encrypted with the published placeholder.
    problems.push({ name: "TOKEN_ENCRYPTION_KEY", reason: "missing" });
  }

  return problems;
}

export function describeInsecureSecrets(problems: InsecureSecret[]): string {
  const parts = problems.map((p) =>
    p.reason === "missing"
      ? `${p.name} is not set`
      : `${p.name} is still the development placeholder`,
  );
  return `Refusing to start: ${parts.join("; ")}. Set real random values (openssl rand -hex 32) in the deployment environment.`;
}

/** Throws in production when session/token secrets are unsafe. No-op locally. */
export function assertProductionSecrets(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isProductionRuntime(env)) return;
  const problems = findInsecureProductionSecrets(env);
  if (problems.length === 0) return;
  throw new Error(describeInsecureSecrets(problems));
}
