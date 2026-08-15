/**
 * Cloudflare Workers stub — keeps Prisma / pg out of the OpenNext Worker bundle.
 * Real DB access lives in `db-node.ts` (Vercel / Node). CF deploys use MOCK_INTEGRATIONS.
 */

export function getNodePrisma(): never {
  throw new Error(
    "Postgres/Prisma is not available in the Cloudflare Worker build. Use MOCK_INTEGRATIONS=true or host on Node (Vercel).",
  );
}

export const prisma = {
  get client(): never {
    return getNodePrisma();
  },
};
