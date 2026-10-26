import { NextResponse } from "next/server";
import { requireResearchScope } from "@/lib/research/http";
import { researchStore } from "@/lib/research/runtime";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const sessions = await researchStore().listSessions(auth.scope, 20);
  return NextResponse.json({ ok: true, sessions });
}
