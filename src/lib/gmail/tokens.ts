import { assertTenantMatch, type TenantScope } from "@/lib/tenant";
import { decryptSecret } from "@/lib/crypto/token-encryption";

export type MailboxOAuthTokenRecord = {
  id: string;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date | null;
  scopes: string[];
};

/**
 * Pure tenant gate for mailbox OAuth token access.
 * Tokens must never be loaded by mailboxId alone.
 */
export function assertMailboxTokenTenantAccess(
  token: Pick<
    MailboxOAuthTokenRecord,
    "organizationId" | "workspaceId" | "mailboxId"
  >,
  scope: TenantScope & { mailboxId: string },
): void {
  if (!scope.organizationId || !scope.workspaceId || !scope.mailboxId) {
    throw new Error("Mailbox token access requires full tenant scope");
  }
  assertTenantMatch(scope, token);
}

/**
 * Filter helper for tests / in-memory stores — only returns tokens matching scope.
 */
export function selectMailboxTokensForTenant<
  T extends Pick<
    MailboxOAuthTokenRecord,
    "organizationId" | "workspaceId" | "mailboxId"
  >,
>(tokens: T[], scope: TenantScope & { mailboxId: string }): T[] {
  return tokens.filter((token) => {
    try {
      assertMailboxTokenTenantAccess(token, scope);
      return true;
    } catch {
      return false;
    }
  });
}

export async function getMailboxOAuthTokenForTenant(
  scope: TenantScope & { mailboxId: string },
): Promise<MailboxOAuthTokenRecord | null> {
  if (!scope.organizationId || !scope.workspaceId || !scope.mailboxId) {
    throw new Error("Mailbox token access requires full tenant scope");
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  const token = await prisma.mailboxOAuthToken.findFirst({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId,
    },
  });

  if (!token) return null;
  assertMailboxTokenTenantAccess(token, scope);
  return token;
}

export async function getDecryptedMailboxTokensForTenant(
  scope: TenantScope & { mailboxId: string },
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  scopes: string[];
} | null> {
  const token = await getMailboxOAuthTokenForTenant(scope);
  if (!token) return null;
  try {
    return {
      accessToken: decryptSecret(token.accessTokenEnc),
      refreshToken: decryptSecret(token.refreshTokenEnc),
      expiresAt: token.expiresAt,
      scopes: token.scopes,
    };
  } catch (error) {
    // A token we cannot decrypt (rotated key) is unusable. Report it as missing
    // so callers ask the patron to reconnect instead of reading stale mail.
    console.warn("[gmail] mailbox token decrypt failed; treating as missing", {
      mailboxId: scope.mailboxId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
