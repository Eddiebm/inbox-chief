import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createInvitationStub,
  ROLE_KEYS,
} from "@/lib/invitations";

const schema = z.object({
  organizationId: z.string().min(1),
  email: z.string().trim().email().max(254),
  roleKey: z.enum(ROLE_KEYS),
  /** Optional caller scope — when present must match organizationId */
  callerOrganizationId: z.string().min(1).optional(),
  invitedById: z.string().min(1).optional(),
});

/**
 * POST /api/invitations — tenant-scoped team invite stub.
 * Validates email + role; does not send mail or persist yet.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = createInvitationStub({
    organizationId: parsed.data.organizationId,
    email: parsed.data.email,
    roleKey: parsed.data.roleKey,
    callerOrganizationId: parsed.data.callerOrganizationId,
    invitedById: parsed.data.invitedById,
  });

  if (!result.ok) {
    const status = result.code === "tenant_mismatch" ? 403 : 400;
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    invitation: {
      ...result.invitation,
      expiresAt: result.invitation.expiresAt.toISOString(),
    },
    message: result.message,
  });
}
