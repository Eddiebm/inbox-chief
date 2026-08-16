import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getNodePrisma } from "@/lib/db-node";
import { runGmailSyncJob } from "@/lib/gmail/sync-job";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!secret || !provided || secret.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(secret), Buffer.from(provided));
}

/** Vercel Cron entry point for opted-in outbound Primary-mail alerts. */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const prisma = getNodePrisma();
  const identities = await prisma.callInIdentity.findMany({
    where: {
      enabled: true,
      callOnNewPrimary: true,
      mailboxId: { not: null },
    },
    orderBy: { updatedAt: "asc" },
    take: 50,
    select: {
      organizationId: true,
      workspaceId: true,
      mailboxId: true,
      userId: true,
    },
  });

  let synced = 0;
  let callsPlaced = 0;
  let skipped = 0;
  let failed = 0;
  for (const identity of identities) {
    if (!identity.mailboxId) continue;
    const mailbox = await prisma.mailbox.findFirst({
      where: {
        id: identity.mailboxId,
        organizationId: identity.organizationId,
        workspaceId: identity.workspaceId,
        ownerId: identity.userId,
        connectionStatus: "connected",
      },
      select: { id: true },
    });
    if (!mailbox) {
      skipped += 1;
      continue;
    }
    try {
      const result = await runGmailSyncJob({
        organizationId: identity.organizationId,
        workspaceId: identity.workspaceId,
        mailboxId: mailbox.id,
        userId: identity.userId,
      });
      if (result.ok) synced += 1;
      if (result.outboundEmailAlert?.called) callsPlaced += 1;
    } catch (error) {
      failed += 1;
      console.error("[cron/gmail-sync] tenant sync failed", {
        organizationId: identity.organizationId,
        mailboxId: mailbox.id,
        error,
      });
    }
  }

  return NextResponse.json({
    ok: failed === 0,
    checked: identities.length,
    synced,
    callsPlaced,
    skipped,
    failed,
  });
}
