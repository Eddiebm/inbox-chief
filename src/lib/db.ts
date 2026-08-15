import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Default export is a stub so Cloudflare/OpenNext Workers builds never pull
 * `pg` / Prisma adapters into the Worker bundle (size + platform limits).
 *
 * Real Postgres access: `import { getNodePrisma } from "@/lib/db-node"`.
 */
function createStubPrisma(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      throw new Error(
        `Database unavailable for "${String(prop)}". Set MOCK_INTEGRATIONS=true or use getNodePrisma() on a Node host.`,
      );
    },
  });
}

export const prisma: PrismaClient = createStubPrisma();
