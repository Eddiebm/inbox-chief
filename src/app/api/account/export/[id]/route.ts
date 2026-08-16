import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getNodePrisma } from "@/lib/db-node";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const { id } = await context.params;
  const prisma = getNodePrisma();
  const request = await prisma.dataExportRequest.findFirst({
    where: {
      id,
      requestedById: user.id,
      status: "READY",
      expiresAt: { gt: new Date() },
      organization: { members: { some: { userId: user.id } } },
    },
    select: { id: true, organizationId: true, createdAt: true, expiresAt: true },
  });
  if (!request) {
    return NextResponse.json({ error: "Export not found or expired." }, { status: 404 });
  }

  const [organization, memberships, mailboxes, messages, contacts, auditEvents] =
    await Promise.all([
      prisma.organization.findFirst({
        where: { id: request.organizationId, members: { some: { userId: user.id } } },
        select: {
          id: true,
          name: true,
          accountType: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.organizationMember.findMany({
        where: { organizationId: request.organizationId },
        select: {
          createdAt: true,
          role: { select: { key: true, name: true } },
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.mailbox.findMany({
        where: { organizationId: request.organizationId },
        select: {
          id: true,
          emailAddress: true,
          displayName: true,
          provider: true,
          connectionStatus: true,
          lastSyncedAt: true,
          createdAt: true,
        },
      }),
      prisma.message.findMany({
        where: { organizationId: request.organizationId },
        orderBy: { receivedAt: "desc" },
        select: {
          id: true,
          mailboxId: true,
          threadId: true,
          fromAddress: true,
          toAddresses: true,
          subject: true,
          receivedAt: true,
          categoryName: true,
          needsAttention: true,
          isRead: true,
        },
      }),
      prisma.contact.findMany({
        where: { organizationId: request.organizationId },
        select: {
          mailboxId: true,
          email: true,
          displayName: true,
          nickname: true,
          messageCount: true,
          lastSeenAt: true,
        },
      }),
      prisma.auditLog.findMany({
        where: { organizationId: request.organizationId },
        orderBy: { createdAt: "desc" },
        select: {
          action: true,
          summary: true,
          resourceType: true,
          resourceId: true,
          createdAt: true,
        },
      }),
    ]);
  if (!organization) {
    return NextResponse.json({ error: "Organization no longer exists." }, { status: 404 });
  }

  const payload = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      exportId: request.id,
      organization,
      memberships,
      mailboxes,
      mailMetadata: messages,
      contacts,
      auditEvents,
    },
    null,
    2,
  );
  const safeDate = new Date().toISOString().slice(0, 10);
  return new NextResponse(payload, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="inbox-chief-export-${safeDate}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
