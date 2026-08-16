import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getNodePrisma } from "@/lib/db-node";
import { resolveUserGmailScope } from "@/lib/gmail/tenant-context";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json({ ok: false, connected: false }, { status: 401 });
  }
  const scope = await resolveUserGmailScope(user.id);
  if (!scope) return NextResponse.json({ ok: true, connected: false });
  const connection = await getNodePrisma().calendarConnection.findFirst({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      userId: user.id,
    },
    select: { timeZone: true, updatedAt: true },
  });
  return NextResponse.json({
    ok: true,
    connected: Boolean(connection),
    timeZone: connection?.timeZone ?? null,
    updatedAt: connection?.updatedAt.toISOString() ?? null,
  });
}
