import { NextResponse } from "next/server";
import { requireResearchScope } from "@/lib/research/http";
import { createResearchDeps } from "@/lib/research/runtime";
import { attachAudio, runTurn } from "@/lib/research/turn";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    text?: string;
    sessionId?: string | null;
    mode?: "conversation" | "dictation" | "push_to_talk";
    audioBase64?: string | null;
  } | null;
  const text = body?.text?.trim() ?? "";
  if (!text) {
    return NextResponse.json({ ok: false, persisted: false, spoken: "I did not receive any words. Type or speak a request." }, { status: 400 });
  }
  const deps = createResearchDeps(auth.scope);
  const result = await runTurn({
    scope: auth.scope,
    text,
    sessionId: body?.sessionId ?? null,
    mode: body?.mode,
    deps,
  });
  if (result.persisted && result.sessionId && body?.audioBase64) {
    const audio = await attachAudio({ scope: auth.scope, sessionId: result.sessionId, audioBase64: body.audioBase64, deps });
    result.audioRetained = audio.audioRetained;
    result.audioNote = audio.audioNote;
  }
  return NextResponse.json(result);
}
