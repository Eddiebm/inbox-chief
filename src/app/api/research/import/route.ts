import { NextResponse } from "next/server";
import { requireResearchScope } from "@/lib/research/http";
import { researchStore } from "@/lib/research/runtime";
import type { ExportBundle } from "@/lib/research/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const bundle = (await request.json().catch(() => null)) as ExportBundle | null;
  if (!bundle || bundle.version !== 1 || !Array.isArray(bundle.sessions) || !Array.isArray(bundle.records)) {
    return NextResponse.json({ ok: false, spoken: "That file is not an Inbox Chief research export." }, { status: 400 });
  }
  const result = await researchStore().importBundle(auth.scope, bundle, new Date());
  return NextResponse.json({
    ok: true,
    ...result,
    spoken: `Restored ${result.sessions} sessions and ${result.records} records into your account. Nothing was emailed.`,
  });
}
