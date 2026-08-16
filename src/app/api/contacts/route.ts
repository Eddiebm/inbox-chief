import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getNodePrisma } from "@/lib/db-node";
import { resolveUserGmailScope } from "@/lib/gmail/tenant-context";
import { writeAuditLog } from "@/lib/audit";
import { parseMailboxAddress } from "@/lib/contacts";

const updateSchema = z.object({
  id: z.string().min(1),
  nickname: z.string().trim().max(80),
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
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!mailbox) return null;
  return { user, scope: { ...scope, mailboxId: mailbox.id }, prisma };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ ok: false, contacts: [] }, { status: 401 });
  const messages = await ctx.prisma.message.findMany({
    where: {
      organizationId: ctx.scope.organizationId,
      workspaceId: ctx.scope.workspaceId,
      mailboxId: ctx.scope.mailboxId,
    },
    select: { fromAddress: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
    take: 500,
  });
  const derived = new Map<
    string,
    { displayName: string | null; count: number; lastSeenAt: Date }
  >();
  for (const message of messages) {
    const address = parseMailboxAddress(message.fromAddress);
    if (!address) continue;
    const prior = derived.get(address.email);
    derived.set(address.email, {
      displayName: address.displayName || prior?.displayName || null,
      count: (prior?.count ?? 0) + 1,
      lastSeenAt: prior?.lastSeenAt ?? message.receivedAt,
    });
  }
  for (const [email, contact] of derived) {
    await ctx.prisma.contact.upsert({
      where: { mailboxId_email: { mailboxId: ctx.scope.mailboxId, email } },
      create: {
        organizationId: ctx.scope.organizationId,
        workspaceId: ctx.scope.workspaceId,
        mailboxId: ctx.scope.mailboxId,
        email,
        displayName: contact.displayName,
        messageCount: contact.count,
        lastSeenAt: contact.lastSeenAt,
      },
      update: {
        ...(contact.displayName ? { displayName: contact.displayName } : {}),
        messageCount: contact.count,
        lastSeenAt: contact.lastSeenAt,
      },
    });
  }
  const contacts = await ctx.prisma.contact.findMany({
    where: {
      organizationId: ctx.scope.organizationId,
      workspaceId: ctx.scope.workspaceId,
      mailboxId: ctx.scope.mailboxId,
    },
    orderBy: [{ nickname: "asc" }, { displayName: "asc" }, { email: "asc" }],
  });
  return NextResponse.json({ ok: true, contacts });
}

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const updated = await ctx.prisma.contact.updateMany({
    where: {
      id: parsed.data.id,
      organizationId: ctx.scope.organizationId,
      workspaceId: ctx.scope.workspaceId,
      mailboxId: ctx.scope.mailboxId,
    },
    data: { nickname: parsed.data.nickname || null },
  });
  if (updated.count !== 1) return NextResponse.json({ ok: false }, { status: 404 });
  await writeAuditLog({
    organizationId: ctx.scope.organizationId,
    workspaceId: ctx.scope.workspaceId,
    mailboxId: ctx.scope.mailboxId,
    actorId: ctx.user.id,
    action: "MANAGE_CONTACT",
    summary: parsed.data.nickname
      ? `Saved contact nickname ${parsed.data.nickname}`
      : "Removed contact nickname",
    resourceType: "contact",
    resourceId: parsed.data.id,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  const deleted = await ctx.prisma.contact.deleteMany({
    where: {
      id,
      organizationId: ctx.scope.organizationId,
      workspaceId: ctx.scope.workspaceId,
      mailboxId: ctx.scope.mailboxId,
    },
  });
  return NextResponse.json({ ok: deleted.count === 1 }, { status: deleted.count ? 200 : 404 });
}
