import { NextResponse } from "next/server";
import { requireResearchScope } from "@/lib/research/http";
import { researchStore } from "@/lib/research/runtime";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const session = await researchStore().getSession(auth.scope, id);
  if (!session) return NextResponse.json({ ok: false, spoken: "I cannot find that session in your account." }, { status: 404 });
  const [records, sources, task] = await Promise.all([
    researchStore().listRecords(auth.scope, { sessionId: id, limit: 200 }),
    researchStore().listSources(auth.scope, id),
    session.activeTaskId ? researchStore().getTask(auth.scope, session.activeTaskId) : Promise.resolve(null),
  ]);
  return NextResponse.json({ ok: true, session, records, sources, task });
}

export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const deleted = await researchStore().deleteSession(auth.scope, id);
  return NextResponse.json({ ok: deleted, spoken: deleted ? "Deleted. The session is hidden from your list." : "I could not delete that session." });
}
