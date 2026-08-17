import { assertProductionSecrets } from "@/lib/security/env-guard";

/** Runs once per server instance, before any request is served. */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  assertProductionSecrets();
}
