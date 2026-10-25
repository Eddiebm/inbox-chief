/**
 * Production-vs-local checks with no Node built-ins.
 * Edge instrumentation can import this file. Keep `node:crypto` out of it.
 */

/** The placeholder shipped for local development. Never valid in production. */
export const DEV_PLACEHOLDER_SECRET = "dev-only-change-me";

/**
 * True when this process is serving real patrons. Mock mode is a local-only
 * escape hatch and deliberately keeps the relaxed development behaviour.
 */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" && env.MOCK_INTEGRATIONS !== "true";
}

export function isPlaceholderSecret(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  return !trimmed || trimmed === DEV_PLACEHOLDER_SECRET;
}
