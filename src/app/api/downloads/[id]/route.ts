import { getCurrentUser } from "@/lib/auth";
import { safeDownloadFilename } from "@/lib/attachment-deliveries";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    return Response.json({ error: "Download not found." }, { status: 404 });
  }
  const { id } = await context.params;
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  const delivery = await prisma.attachmentDelivery.findFirst({
    where: {
      id,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      requestedById: user.id,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      fileBytes: true,
    },
  });
  if (!delivery) {
    return Response.json(
      { error: "This download was not found or has expired." },
      { status: 404 },
    );
  }

  await prisma.attachmentDelivery.updateMany({
    where: {
      id: delivery.id,
      organizationId: scope.organizationId,
      requestedById: user.id,
    },
    data: { downloadedAt: new Date() },
  });

  return new Response(delivery.fileBytes, {
    headers: {
      "Content-Type": delivery.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeDownloadFilename(delivery.filename)}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
