import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { loadSignedInMailbox } from "@/lib/mail/signed-in-mailbox";
import {
  DEFAULT_RETAIN_DAYS,
  decideRetention,
  toRetentionCandidate,
} from "@/lib/retention";
import { mailboxTenantWhere } from "@/lib/tenant";

const decisionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["keep", "approve_trash"]),
});

export async function GET() {
  const ctx = await loadSignedInMailbox();
  if (!ctx) {
    return NextResponse.json({ ok: true, mailboxConnected: false, items: [] });
  }
  const policy = await ctx.prisma.retentionPolicy.findFirst({
    where: {
      organizationId: ctx.scope.organizationId,
      workspaceId: ctx.scope.workspaceId,
    },
    orderBy: { updatedAt: "desc" },
  });
  const retainDays = policy?.retainDays ?? DEFAULT_RETAIN_DAYS;
  const cutoff = new Date(Date.now() - retainDays * 86_400_000);
  const rows = await ctx.prisma.message.findMany({
    where: {
      ...mailboxTenantWhere(ctx.scope),
      receivedAt: { lte: cutoff },
      OR: [{ retentionDecision: null }, { retentionDecision: "CANDIDATE" }],
    },
    orderBy: { receivedAt: "asc" },
    take: 50,
  });
  const items = rows.map((row) => toRetentionCandidate(row));
  return NextResponse.json({
    ok: true,
    mailboxConnected: true,
    retainDays,
    items,
  });
}

export async function PATCH(request: Request) {
  const ctx = await loadSignedInMailbox();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, message: "Connect Gmail to review retention." },
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
  const current = toRetentionCandidate(row);
  const result = decideRetention(current, parsed.data.action, ctx.scope);
  await ctx.prisma.message.updateMany({
    where: mailboxTenantWhere(ctx.scope, { id: row.id }),
    data: { retentionDecision: result.item.status },
  });
  await writeAuditLog({
    organizationId: ctx.scope.organizationId,
    workspaceId: ctx.scope.workspaceId,
    mailboxId: ctx.scope.mailboxId,
    actorId: ctx.user.id,
    action: parsed.data.action === "keep" ? "RETENTION_REVIEW" : "MOVE_TO_TRASH",
    resourceType: "message",
    resourceId: row.id,
    summary: result.spoken,
  });
  return NextResponse.json({ ok: true, item: result.item, spoken: result.spoken });
}
