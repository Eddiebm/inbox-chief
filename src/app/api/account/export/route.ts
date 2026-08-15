import { NextResponse } from "next/server";
import { z } from "zod";
import { requestDataExport } from "@/lib/account/data-requests";

const schema = z.object({
  organizationId: z.string().min(1),
  /** Optional caller scope — when present must match organizationId */
  callerOrganizationId: z.string().min(1).optional(),
});

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

  const result = requestDataExport({
    organizationId: parsed.data.organizationId,
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
    expiresAt: result.expiresAt.toISOString(),
    message: result.message,
  });
}
