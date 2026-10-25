import { NextResponse } from "next/server";
import { requireResearchScope } from "@/lib/research/http";
import { researchStore } from "@/lib/research/runtime";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { correctedText?: string } | null;
  if (!body?.correctedText?.trim()) return NextResponse.json({ ok: false, spoken: "Say the corrected words." }, { status: 400 });
  const record = await researchStore().correctRecord(auth.scope, id, body.correctedText.trim(), new Date());
  if (!record) return NextResponse.json({ ok: false, spoken: "I cannot find that record in your account." }, { status: 404 });
  return NextResponse.json({ ok: true, record, spoken: "Corrected. The original transcript is still stored." });
}

export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const deleted = await researchStore().deleteRecord(auth.scope, id, new Date());
  return NextResponse.json({ ok: deleted, spoken: deleted ? "Deleted that record." : "I cannot find that record in your account." });
}
