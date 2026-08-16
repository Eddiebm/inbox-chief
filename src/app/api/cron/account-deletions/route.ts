import { NextResponse } from "next/server";
import { getNodePrisma } from "@/lib/db-node";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const prisma = getNodePrisma();
  const due = await prisma.accountDeletionRequest.findMany({
    where: {
      status: "COOLING_OFF",
      coolOffEndsAt: { lte: new Date() },
    },
    orderBy: { coolOffEndsAt: "asc" },
    take: 25,
    select: { id: true, organizationId: true, requestedById: true },
  });

  let completed = 0;
  for (const item of due) {
    const claimed = await prisma.accountDeletionRequest.updateMany({
      where: { id: item.id, status: "COOLING_OFF" },
      data: { status: "PROCESSING" },
    });
    if (claimed.count !== 1) continue;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.callTurn.deleteMany({
          where: { session: { organizationId: item.organizationId } },
        });
        await tx.callSession.deleteMany({
          where: { organizationId: item.organizationId },
        });
        await tx.callInIdentity.deleteMany({
          where: { organizationId: item.organizationId },
        });
        await tx.provisioningRequest.deleteMany({
          where: { organizationId: item.organizationId },
        });
        await tx.consentRecord.deleteMany({
          where: { organizationId: item.organizationId },
        });
        await tx.invitation.deleteMany({
          where: { organizationId: item.organizationId },
        });
        await tx.usageRecord.deleteMany({
          where: { organizationId: item.organizationId },
        });
        await tx.subscription.deleteMany({
          where: { organizationId: item.organizationId },
        });
        await tx.organization.delete({ where: { id: item.organizationId } });
        const memberships = await tx.organizationMember.count({
          where: { userId: item.requestedById },
        });
        if (memberships === 0) {
          await tx.user.deleteMany({ where: { id: item.requestedById } });
        }
      });
      completed += 1;
    } catch (error) {
      console.error("[account-deletion] failed", {
        requestId: item.id,
        organizationId: item.organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      await prisma.accountDeletionRequest.updateMany({
        where: { id: item.id, status: "PROCESSING" },
        data: { status: "COOLING_OFF" },
      });
    }
  }
  return NextResponse.json({ ok: true, processed: due.length, completed });
}
