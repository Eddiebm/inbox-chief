import { NextResponse } from "next/server";
import { z } from "zod";
import { generateDraft } from "@/lib/ai/draft";
import { writeAuditLog } from "@/lib/audit";
import type { AuditAction } from "@/generated/prisma/client";
import { parseMailboxAddress } from "@/lib/contacts";
import { updateDraft, type DraftItem } from "@/lib/drafts";
import { loadSignedInMailbox } from "@/lib/mail/signed-in-mailbox";
import { mailboxTenantWhere } from "@/lib/tenant";

const DRAFT_PAGE_STATUSES = [
  "GENERATED",
  "EDITING",
  "AWAITING_APPROVAL",
] as const;

const decisionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["edit", "request_approval", "discard"]),
  bodyText: z.string().max(20_000).optional(),
});

const createSchema = z.object({
  messageId: z.string().min(1),
});

function draftAuditAction(
  action: "edit" | "request_approval" | "discard",
): AuditAction {
  switch (action) {
    case "edit":
    case "discard":
      return "EDIT_DRAFT";
    case "request_approval":
      return "REQUEST_APPROVAL";
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function toDraftItem(row: {
  id: string;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  subject: string;
  toAddresses: string[];
  bodyText: string;
  status: string;
}): DraftItem | null {
  if (
    row.status !== "GENERATED" &&
    row.status !== "EDITING" &&
    row.status !== "AWAITING_APPROVAL" &&
    row.status !== "DISCARDED"
  ) {
    return null;
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    mailboxId: row.mailboxId,
    subject: row.subject,
    toAddresses: row.toAddresses,
    bodyText: row.bodyText,
    status: row.status,
  };
}

export async function GET() {
  const ctx = await loadSignedInMailbox();
  if (!ctx) {
    return NextResponse.json({ ok: true, mailboxConnected: false, items: [] });
  }
  const rows = await ctx.prisma.draft.findMany({
    where: mailboxTenantWhere(ctx.scope, {
      status: { in: [...DRAFT_PAGE_STATUSES] },
    }),
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const items = rows
    .map(toDraftItem)
    .filter((item): item is DraftItem => item !== null);
  return NextResponse.json({ ok: true, mailboxConnected: true, items });
}

export async function POST(request: Request) {
  const ctx = await loadSignedInMailbox();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, message: "Connect Gmail to draft from live mail." },
      { status: 401 },
    );
  }
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const message = await ctx.prisma.message.findFirst({
    where: mailboxTenantWhere(ctx.scope, { id: parsed.data.messageId }),
  });
  if (!message) {
    return NextResponse.json(
      { ok: false, message: "That message is not in this mailbox." },
      { status: 404 },
    );
  }
  const voice = await ctx.prisma.voiceProfile.findUnique({
    where: { mailboxId: ctx.scope.mailboxId },
  });
  const generated = await generateDraft({
    scope: ctx.scope,
    subject: message.subject,
    bodySnippet: (message.bodyText ?? message.snippet ?? "").slice(0, 800),
    voiceProfile: voice
      ? {
          greeting: voice.greeting,
          signature: voice.signature,
          tone: voice.tone,
          learningEnabled: voice.learningEnabled,
          consentGranted: Boolean(voice.consentGrantedAt),
        }
      : null,
  });
  const parsedFrom = parseMailboxAddress(message.fromAddress);
  const toAddresses = parsedFrom ? [parsedFrom.email] : [message.fromAddress];
  const created = await ctx.prisma.draft.create({
    data: {
      organizationId: ctx.scope.organizationId,
      workspaceId: ctx.scope.workspaceId,
      mailboxId: ctx.scope.mailboxId,
      messageId: message.id,
      createdById: ctx.user.id,
      status: "GENERATED",
      toAddresses,
      subject: generated.subject,
      bodyText: generated.bodyText,
    },
  });
  await writeAuditLog({
    organizationId: ctx.scope.organizationId,
    workspaceId: ctx.scope.workspaceId,
    mailboxId: ctx.scope.mailboxId,
    actorId: ctx.user.id,
    action: "GENERATE_DRAFT",
    resourceType: "draft",
    resourceId: created.id,
    summary: `Draft generated for ${created.subject}. Nothing was sent.`,
  });
  const item = toDraftItem(created);
  return NextResponse.json({
    ok: true,
    item,
    spoken: `Draft ready for ${created.subject}. Review it on Drafts. Nothing was sent.`,
  });
}

export async function PATCH(request: Request) {
  const ctx = await loadSignedInMailbox();
  if (!ctx) {
    return NextResponse.json(
      { ok: false, message: "Connect Gmail to edit live drafts." },
      { status: 401 },
    );
  }
  const parsed = decisionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const row = await ctx.prisma.draft.findFirst({
    where: mailboxTenantWhere(ctx.scope, { id: parsed.data.id }),
  });
  if (!row) {
    return NextResponse.json(
      { ok: false, message: "That draft is not in this mailbox." },
      { status: 404 },
    );
  }
  const current = toDraftItem(row);
  if (!current) {
    return NextResponse.json(
      { ok: false, message: "That draft is already in approvals." },
      { status: 409 },
    );
  }
  const result = updateDraft(
    current,
    parsed.data.action,
    ctx.scope,
    parsed.data.bodyText,
  );
  await ctx.prisma.draft.updateMany({
    where: mailboxTenantWhere(ctx.scope, { id: row.id }),
    data: {
      status: result.item.status,
      bodyText: result.item.bodyText,
    },
  });
  await writeAuditLog({
    organizationId: ctx.scope.organizationId,
    workspaceId: ctx.scope.workspaceId,
    mailboxId: ctx.scope.mailboxId,
    actorId: ctx.user.id,
    action: draftAuditAction(parsed.data.action),
    resourceType: "draft",
    resourceId: row.id,
    summary: result.spoken,
  });
  return NextResponse.json({ ok: true, item: result.item, spoken: result.spoken });
}
