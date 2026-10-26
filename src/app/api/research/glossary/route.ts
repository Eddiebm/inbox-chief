import { NextResponse } from "next/server";
import { requireResearchScope } from "@/lib/research/http";
import { researchStore } from "@/lib/research/runtime";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const ensured = await researchStore().ensureWorkspace(auth.scope);
  return NextResponse.json({ ok: true, glossary: ensured.glossary });
}

export async function POST(request: Request) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { term?: string; spokenAs?: string; aliases?: string[] } | null;
  if (!body?.term?.trim()) return NextResponse.json({ ok: false, spoken: "Say the term to save." }, { status: 400 });
  const term = await researchStore().upsertGlossary(auth.scope, {
    term: body.term.trim(),
    spokenAs: body.spokenAs ?? null,
    aliases: body.aliases ?? [],
  });
  return NextResponse.json({ ok: true, term, spoken: `Saved the term ${term.term}.` });
}

export async function DELETE(request: Request) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  const deleted = await researchStore().deleteGlossary(auth.scope, id);
  return NextResponse.json({ ok: deleted, spoken: deleted ? "Removed that glossary term." : "I could not find that term." });
}
