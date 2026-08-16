import { NextResponse } from "next/server";
import { z } from "zod";
import { DELETION_COOL_OFF_DAYS, scheduleAccountDeletion } from "@/lib/account/data-requests";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { getNodePrisma } from "@/lib/db-node";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";

const schema = z.object({
  confirmEmail: z.string().email().optional(),
  acknowledged: z.boolean().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json({ ok: false, error: "Sign in to delete your account." }, { status: 401 });
  }
  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    return NextResponse.json({ ok: false, error: "Account scope is unavailable." }, { status: 403 });
  }
  const prisma = getNodePrisma();
  const ownerMembership = await prisma.organizationMember.findFirst({
    where: {
      organizationId: scope.organizationId,
      userId: user.id,
      role: { key: "workspace_owner" },
    },
    select: { id: true },
  });
  if (!ownerMembership) {
    return NextResponse.json(
      { ok: false, error: "Only the workspace owner can delete the organization." },
      { status: 403 },
    );
  }
  const body: unknown = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "We could not read that deletion request. Please try again." },
      { status: 400 },
    );
  }

  const result = scheduleAccountDeletion({
    organizationId: scope.organizationId,
    confirmEmail: parsed.data.confirmEmail ?? user.email,
    accountEmail: user.email,
    acknowledged: parsed.data.acknowledged ?? true,
    callerOrganizationId: scope.organizationId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
  }

  const prior = await prisma.accountDeletionRequest.findFirst({
    where: {
      organizationId: scope.organizationId,
      requestedById: user.id,
      status: { in: ["REQUESTED", "COOLING_OFF"] },
    },
    orderBy: { createdAt: "desc" },
  });
  const deletion = prior
    ? await prisma.accountDeletionRequest.update({
        where: { id: prior.id },
        data: { status: "COOLING_OFF", coolOffEndsAt: result.coolOffEndsAt },
      })
    : await prisma.accountDeletionRequest.create({
        data: {
          organizationId: scope.organizationId,
          requestedById: user.id,
          status: "COOLING_OFF",
          coolOffEndsAt: result.coolOffEndsAt,
        },
      });
  await writeAuditLog({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    actorId: user.id,
    action: "SYSTEM",
    resourceType: "account_deletion",
    resourceId: deletion.id,
    summary: `Scheduled tenant deletion after ${DELETION_COOL_OFF_DAYS}-day cooling-off period`,
  });

  return NextResponse.json({
    ok: true,
    status: result.status,
    coolOffEndsAt: result.coolOffEndsAt.toISOString(),
    message: `${result.message} Deletion will complete automatically after the cooling-off period.`,
  });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json(
      { ok: false, error: "Sign in to view account deletion status." },
      { status: 401 },
    );
  }
  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    return NextResponse.json(
      { ok: false, error: "Your account is not ready yet." },
      { status: 403 },
    );
  }
  const pending = await getNodePrisma().accountDeletionRequest.findFirst({
    where: {
      organizationId: scope.organizationId,
      requestedById: user.id,
      status: "COOLING_OFF",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, coolOffEndsAt: true },
  });
  return NextResponse.json({
    ok: true,
    scheduled: Boolean(pending),
    coolOffEndsAt: pending?.coolOffEndsAt?.toISOString() ?? null,
  });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json(
      { ok: false, error: "Sign in to keep your account." },
      { status: 401 },
    );
  }
  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    return NextResponse.json(
      { ok: false, error: "Your account is not ready yet." },
      { status: 403 },
    );
  }
  const updated = await getNodePrisma().accountDeletionRequest.updateMany({
    where: {
      organizationId: scope.organizationId,
      requestedById: user.id,
      status: "COOLING_OFF",
    },
    data: { status: "CANCELED" },
  });
  if (updated.count === 0) {
    return NextResponse.json(
      { ok: false, error: "No scheduled deletion was found." },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ok: true,
    message: "Account deletion canceled. Your account will stay active.",
  });
}
