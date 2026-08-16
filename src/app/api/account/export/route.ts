import { NextResponse } from "next/server";
import { EXPORT_EXPIRY_HOURS } from "@/lib/account/data-requests";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { getNodePrisma } from "@/lib/db-node";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";

export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json({ ok: false, error: "Sign in to export your data." }, { status: 401 });
  }
  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    return NextResponse.json({ ok: false, error: "Account scope is unavailable." }, { status: 403 });
  }

  const expiresAt = new Date(Date.now() + EXPORT_EXPIRY_HOURS * 60 * 60 * 1_000);
  const prisma = getNodePrisma();
  const exportRequest = await prisma.dataExportRequest.create({
    data: {
      organizationId: scope.organizationId,
      requestedById: user.id,
      status: "READY",
      expiresAt,
      completedAt: new Date(),
    },
  });
  const downloadUrl = `/api/account/export/${exportRequest.id}`;
  await prisma.dataExportRequest.update({
    where: { id: exportRequest.id },
    data: { downloadUrl },
  });
  await writeAuditLog({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    actorId: user.id,
    action: "EXPORT_AUDIT",
    resourceType: "data_export",
    resourceId: exportRequest.id,
    summary: "Created downloadable account data export",
  });

  return NextResponse.json({
    ok: true,
    status: "READY",
    downloadUrl,
    expiresAt: expiresAt.toISOString(),
    message: "Your export is ready. The download link expires after 48 hours.",
  });
}
