import { NextResponse } from "next/server";
import { z } from "zod";
import { scheduleAccountDeletion } from "@/lib/account/data-requests";

const schema = z.object({
  organizationId: z.string().min(1),
  confirmEmail: z.string().email(),
  /** Account email the confirmation must match */
  accountEmail: z.string().email(),
  acknowledged: z.boolean(),
  /** Optional caller scope — when present must match organizationId */
  callerOrganizationId: z.string().min(1).optional(),
});

/** Account deletion with cooling-off — never immediately destroys without confirmation */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = scheduleAccountDeletion({
    organizationId: parsed.data.organizationId,
    confirmEmail: parsed.data.confirmEmail,
    accountEmail: parsed.data.accountEmail,
    acknowledged: parsed.data.acknowledged,
    callerOrganizationId: parsed.data.callerOrganizationId,
  });

  if (!result.ok) {
    const status = result.code === "tenant_mismatch" ? 403 : 400;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json({
    ok: true,
    status: result.status,
    organizationId: result.organizationId,
    coolOffEndsAt: result.coolOffEndsAt.toISOString(),
    message: result.message,
  });
}
