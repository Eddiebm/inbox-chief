import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { loadEmailCallPlan } from "@/lib/call-in/email-call-plan";
import { getNodePrisma } from "@/lib/db-node";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";

export const runtime = "nodejs";

const updateSchema = z.object({
  enabled: z.boolean(),
});

async function loadContext() {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") return null;
  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) return null;
  const prisma = getNodePrisma();
  const mailbox = await prisma.mailbox.findFirst({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ownerId: user.id,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, connectionStatus: true },
  });
  if (!mailbox) return null;
  return { user, scope, prisma, mailbox };
}

export async function GET() {
  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      hasPhone: false,
      mailboxConnected: false,
      allowsEmailCalls: false,
      planId: "patron",
      persisted: false,
    });
  }
  const context = await loadContext();
  if (!context) {
    return NextResponse.json({ error: "Sign in and connect Gmail first." }, { status: 401 });
  }
  const identity = await context.prisma.callInIdentity.findFirst({
    where: {
      organizationId: context.scope.organizationId,
      workspaceId: context.scope.workspaceId,
      mailboxId: context.mailbox.id,
      userId: context.user.id,
      enabled: true,
    },
    orderBy: { updatedAt: "desc" },
    select: { callOnNewPrimary: true, phoneE164: true, lastOutboundEmailCallAt: true },
  });
  const plan = await loadEmailCallPlan(
    context.prisma,
    context.scope.organizationId,
  );
  return NextResponse.json({
    ok: true,
    enabled: plan.allowsEmailCalls && (identity?.callOnNewPrimary ?? false),
    allowsEmailCalls: plan.allowsEmailCalls,
    planId: plan.planId,
    hasPhone: Boolean(identity?.phoneE164),
    mailboxConnected: context.mailbox.connectionStatus === "connected",
    lastCalledAt: identity?.lastOutboundEmailCallAt?.toISOString() ?? null,
    persisted: true,
  });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enabled must be true or false." }, { status: 400 });
  }
  const context = await loadContext();
  if (!context) {
    return NextResponse.json({ error: "Sign in and connect Gmail first." }, { status: 401 });
  }
  const identity = await context.prisma.callInIdentity.findFirst({
    where: {
      organizationId: context.scope.organizationId,
      workspaceId: context.scope.workspaceId,
      mailboxId: context.mailbox.id,
      userId: context.user.id,
      enabled: true,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, phoneE164: true },
  });
  if (!identity?.phoneE164) {
    return NextResponse.json(
      { error: "Save your call-in phone number before enabling email calls." },
      { status: 409 },
    );
  }
  const plan = await loadEmailCallPlan(
    context.prisma,
    context.scope.organizationId,
  );
  if (parsed.data.enabled && !plan.allowsEmailCalls) {
    return NextResponse.json(
      {
        error: "Email call alerts are included on Pro and Business.",
        blocked: "email_calls_require_pro",
        planId: plan.planId,
      },
      { status: 403 },
    );
  }
  if (parsed.data.enabled && context.mailbox.connectionStatus !== "connected") {
    return NextResponse.json(
      { error: "Reconnect Gmail before enabling email calls." },
      { status: 409 },
    );
  }
  await context.prisma.callInIdentity.updateMany({
    where: {
      id: identity.id,
      organizationId: context.scope.organizationId,
      workspaceId: context.scope.workspaceId,
      mailboxId: context.mailbox.id,
      userId: context.user.id,
    },
    data: { callOnNewPrimary: parsed.data.enabled },
  });
  return NextResponse.json({
    ok: true,
    enabled: parsed.data.enabled,
    message: parsed.data.enabled
      ? "Email calls are on. New Primary mail may trigger one batched call."
      : "Email calls are off.",
  });
}
