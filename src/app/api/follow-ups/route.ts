import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import {
  FOLLOW_UP_SNOOZE_DAYS,
  toFollowUpItem,
  updateFollowUp,
} from "@/lib/follow-ups";
import { loadSignedInMailbox } from "@/lib/mail/signed-in-mailbox";
import { mailboxTenantWhere } from "@/lib/tenant";

const decisionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["complete", "snooze"]),
});

export async function GET() {
  const ctx = await loadSignedInMailbox();
  if (!ctx) {
    return NextResponse.json({ ok: true, mailboxConnected: false, items: [] });
  }
  const rows = await ctx.prisma.followUp.findMany({
    where: mailboxTenantWhere(ctx.scope),
    include: {
      message: { select: { subject: true, fromAddress: true } },
    },
    orderBy: { dueAt: "asc" },
    take: 50,
  });
  const items = rows.map((row) => toFollowUpItem(row));
  return NextResponse.json({ ok: true, mailboxConnected: true, items });
}

export async function PATCH(request: Request) {
  const ctx = await loadSignedInMailbox();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, message: "Connect Gmail to manage follow-ups." },
      { status: 401 },
    );
  }
  const parsed = decisionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const row = await ctx.prisma.followUp.findFirst({
    where: mailboxTenantWhere(ctx.scope, { id: parsed.data.id }),
    include: {
      message: { select: { subject: true, fromAddress: true } },
    },
  });
  if (!row) {
    return NextResponse.json(
      { ok: false, message: "That follow-up is not in this mailbox." },
      { status: 404 },
    );
  }
  const current = toFollowUpItem(row);
  const result = updateFollowUp(current, parsed.data.action, ctx.scope);
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + FOLLOW_UP_SNOOZE_DAYS);
  await ctx.prisma.followUp.updateMany({
    where: mailboxTenantWhere(ctx.scope, { id: row.id }),
    data:
      parsed.data.action === "complete"
        ? { completedAt: new Date() }
        : { completedAt: null, dueAt },
  });
  await writeAuditLog({
    organizationId: ctx.scope.organizationId,
    workspaceId: ctx.scope.workspaceId,
    mailboxId: ctx.scope.mailboxId,
    actorId: ctx.user.id,
    action: "MANAGE_FOLLOW_UP",
    resourceType: "follow_up",
    resourceId: row.id,
    summary: result.spoken,
  });
  return NextResponse.json({ ok: true, item: result.item, spoken: result.spoken });
}
