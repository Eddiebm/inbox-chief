import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { queueAttachmentDelivery } from "@/lib/attachment-deliveries";
import { resolveSnapshotForUser } from "@/lib/call-in/identity";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";

const createSchema = z.object({
  emailNumber: z.number().int().min(1).max(50).default(1),
  attachmentNumber: z.number().int().min(1).max(20).default(1),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    return NextResponse.json({ downloads: [] });
  }
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  await prisma.attachmentDelivery.deleteMany({
    where: {
      organizationId: scope.organizationId,
      requestedById: user.id,
      expiresAt: { lte: new Date() },
    },
  });
  const downloads = await prisma.attachmentDelivery.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      requestedById: user.id,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      byteSize: true,
      fromAddress: true,
      emailSubject: true,
      emailReceivedAt: true,
      expiresAt: true,
      downloadedAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ downloads });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide valid email and attachment numbers." },
      { status: 400 },
    );
  }
  const snapshot = await resolveSnapshotForUser(user.id);
  const result = await queueAttachmentDelivery({
    snapshot,
    requestedById: user.id,
    ...parsed.data,
  });
  return NextResponse.json(result, { status: result.ok ? 201 : 422 });
}
