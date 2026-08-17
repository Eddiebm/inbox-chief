import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { isPrimaryInboxMessage } from "@/lib/call-in/primary-inbox";
import { FOLLOW_UP_SNOOZE_DAYS, speakDueLabel } from "@/lib/follow-ups";
import { toTriageMessage, triageMessage } from "@/lib/inbox";
import { loadSignedInMailbox } from "@/lib/mail/signed-in-mailbox";
import { mailboxTenantWhere } from "@/lib/tenant";

const decisionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["mark_triaged", "defer", "archive"]),
});

export async function GET() {
  const ctx = await loadSignedInMailbox();
  if (!ctx) {
    return NextResponse.json({ ok: true, mailboxConnected: false, items: [] });
  }
  const rows = await ctx.prisma.message.findMany({
    where: mailboxTenantWhere(ctx.scope),
    orderBy: { receivedAt: "desc" },
    take: 120,
  });
  const items = rows
    .filter(
      (row) =>
        row.triageStatus !== "ARCHIVED" && isPrimaryInboxMessage(row),
    )
    .slice(0, 50)
    .map(toTriageMessage);
  return NextResponse.json({
    ok: true,
    mailboxConnected: true,
    items,
  });
}

export async function PATCH(request: Request) {
  const ctx = await loadSignedInMailbox();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, message: "Connect Gmail to triage live mail." },
      { status: 401 },
    );
  }
  const parsed = decisionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const row = await ctx.prisma.message.findFirst({
    where: mailboxTenantWhere(ctx.scope, { id: parsed.data.id }),
  });
  if (!row) {
    return NextResponse.json(
      { ok: false, message: "That message is not in this mailbox." },
      { status: 404 },
    );
  }
  const current = toTriageMessage(row);
  const result = triageMessage(current, parsed.data.action, ctx.scope);
  await ctx.prisma.message.updateMany({
    where: mailboxTenantWhere(ctx.scope, { id: row.id }),
    data: {
      triageStatus: result.item.status,
      needsAttention: result.item.needsAttention,
    },
  });
  if (parsed.data.action === "defer") {
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + FOLLOW_UP_SNOOZE_DAYS);
    const existing = await ctx.prisma.followUp.findFirst({
      where: mailboxTenantWhere(ctx.scope, {
        messageId: row.id,
        completedAt: null,
      }),
    });
    if (existing) {
      await ctx.prisma.followUp.updateMany({
        where: mailboxTenantWhere(ctx.scope, { id: existing.id }),
        data: { dueAt },
      });
    } else {
      await ctx.prisma.followUp.create({
        data: {
          organizationId: ctx.scope.organizationId,
          workspaceId: ctx.scope.workspaceId,
          mailboxId: ctx.scope.mailboxId,
          messageId: row.id,
          dueAt,
          note: "Deferred from Inbox. Nudge if still waiting.",
          createdById: ctx.user.id,
        },
      });
    }
    result.spoken = `Deferred: ${row.subject}. Follow-up due ${speakDueLabel(dueAt)}.`;
  }
  await writeAuditLog({
    organizationId: ctx.scope.organizationId,
    workspaceId: ctx.scope.workspaceId,
    mailboxId: ctx.scope.mailboxId,
    actorId: ctx.user.id,
    action: "ORGANIZE",
    resourceType: "message",
    resourceId: row.id,
    summary: result.spoken,
  });
  return NextResponse.json({ ok: true, item: result.item, spoken: result.spoken });
}
