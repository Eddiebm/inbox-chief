import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getNodePrisma } from "@/lib/db-node";
import { resolveUserGmailScope } from "@/lib/gmail/tenant-context";
import { sendApprovedDraft } from "@/lib/email-send";
import { hasMailboxPermission } from "@/lib/mailbox-permissions";
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
  // The mailbox owner always qualifies. A non-owner qualifies only when they
  // hold a live (non-expired) MailboxPermission grant on that exact mailbox
  // for one of the approval-related permissions — this is what lets a
  // delegate (e.g. an Executive Assistant) see and act on the queue without
  // widening access to every mailbox in the tenant.
  const mailbox = await prisma.mailbox.findFirst({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      provider: "gmail",
      OR: [
        { ownerId: user.id },
        {
          permissions: {
            some: {
              userId: user.id,
              permission: { key: { in: ["approve_messages", "send_approved_messages"] } },
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          },
        },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, ownerId: true },
  });
  if (!mailbox) return null;
  return {
    user,
    prisma,
    scope: { ...scope, mailboxId: mailbox.id },
    isOwner: mailbox.ownerId === user.id,
    ownerId: mailbox.ownerId,
  };
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
  // Approving or rejecting a draft is the "approve_messages" permission —
  // the owner always has it implicitly; anyone else needs a live grant.
  const canApprove =
    ctx.isOwner ||
    (await hasMailboxPermission({
      organizationId: ctx.scope.organizationId,
      workspaceId: ctx.scope.workspaceId,
      mailboxId: ctx.scope.mailboxId,
      userId: ctx.user.id,
      ownerId: ctx.ownerId,
      permission: "approve_messages",
    }));
  if (!canApprove) {
    return NextResponse.json({ ok: false, message: "permission_denied" }, { status: 403 });
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
