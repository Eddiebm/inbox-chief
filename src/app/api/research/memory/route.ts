import { NextResponse } from "next/server";
import { requireResearchScope } from "@/lib/research/http";
import { researchStore } from "@/lib/research/runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const records = await researchStore().listRecords(auth.scope, {
    query: url.searchParams.get("q") || undefined,
    kinds: url.searchParams.get("kind") ? [url.searchParams.get("kind") as string] : undefined,
    speaker: url.searchParams.get("speaker") === "OWNER" ? "OWNER" : undefined,
    limit: 20,
  });
  return NextResponse.json({ ok: true, records });
}
