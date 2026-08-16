import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getNodePrisma } from "@/lib/db-node";
import { resolveUserGmailScope } from "@/lib/gmail/tenant-context";
import { sendApprovedDraft } from "@/lib/email-send";
import { writeAuditLog } from "@/lib/audit";

const decisionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["approve", "reject", "confirm_send"]),
});

async function context() {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") return null;
  const scope = await resolveUserGmailScope(user.id);
  if (!scope) return null;
  const prisma = getNodePrisma();
  const mailbox = await prisma.mailbox.findFirst({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ownerId: user.id,
      provider: "gmail",
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!mailbox) return null;
  return { user, prisma, scope: { ...scope, mailboxId: mailbox.id } };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ ok: false, items: [] }, { status: 401 });
  const items = await ctx.prisma.draft.findMany({
    where: {
      organizationId: ctx.scope.organizationId,
      workspaceId: ctx.scope.workspaceId,
      mailboxId: ctx.scope.mailboxId,
      status: { in: ["AWAITING_APPROVAL", "APPROVED", "SENT", "REJECTED"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ ok: true, items });
}

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
  const parsed = decisionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const where = {
    id: parsed.data.id,
    organizationId: ctx.scope.organizationId,
    workspaceId: ctx.scope.workspaceId,
    mailboxId: ctx.scope.mailboxId,
  };
  if (parsed.data.action === "confirm_send") {
    try {
      const sent = await sendApprovedDraft({
        ...ctx.scope,
        userId: ctx.user.id,
        draftId: parsed.data.id,
        confirmed: true,
      });
      return NextResponse.json({ ok: true, sent });
    } catch (error) {
      return NextResponse.json(
        { ok: false, message: error instanceof Error ? error.message : "send_failed" },
        { status: 409 },
      );
    }
  }
  const status = parsed.data.action === "approve" ? "APPROVED" : "REJECTED";
  const updated = await ctx.prisma.draft.updateMany({
    where: {
      ...where,
      status: "AWAITING_APPROVAL",
    },
    data:
      status === "APPROVED"
        ? { status, approvedById: ctx.user.id }
        : { status },
  });
  if (updated.count !== 1) {
    return NextResponse.json({ ok: false, message: "draft_state_changed" }, { status: 409 });
  }
  await writeAuditLog({
    organizationId: ctx.scope.organizationId,
    workspaceId: ctx.scope.workspaceId,
    mailboxId: ctx.scope.mailboxId,
    actorId: ctx.user.id,
    action: status === "APPROVED" ? "APPROVE" : "EDIT_DRAFT",
    resourceType: "draft",
    resourceId: parsed.data.id,
    summary: status === "APPROVED" ? "Approved draft; send confirmation still required" : "Rejected draft",
  });
  return NextResponse.json({ ok: true, status });
}
