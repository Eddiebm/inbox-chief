import type { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient as Client } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { nodePrisma?: PrismaClient };

/** Node/Vercel only — do not import this module from Workers-facing entrypoints at top level. */
export function getNodePrisma(): PrismaClient {
  if (globalForPrisma.nodePrisma) return globalForPrisma.nodePrisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to initialize PrismaClient");
  }
  const adapter = new PrismaPg({ connectionString });
  globalForPrisma.nodePrisma = new Client({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  return globalForPrisma.nodePrisma;
}

export const prisma = {
  get client() {
    return getNodePrisma();
  },
};
