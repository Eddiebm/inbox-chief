import { NextResponse } from "next/server";
import { getNodePrisma } from "@/lib/db-node";
import { requireResearchScope } from "@/lib/research/http";
import { createResearchDeps, researchStore } from "@/lib/research/runtime";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const ensured = await researchStore().ensureWorkspace(auth.scope);
  const monthCents = await researchStore().sumEstimatedCents(auth.scope, new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString());
  const configured = createResearchDeps(auth.scope).configured.map((item) => ({ id: item.id, model: item.model }));
  return NextResponse.json({ ok: true, preference: ensured.preference, projects: ensured.projects, glossary: ensured.glossary, monthCents, configured });
}

export async function PATCH(request: Request) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const patch = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!patch) return NextResponse.json({ ok: false }, { status: 400 });
  await researchStore().ensureWorkspace(auth.scope);
  const preference = await researchStore().savePreference(auth.scope, {
    ...(typeof patch.speechRate === "number" ? { speechRate: patch.speechRate } : {}),
    ...(typeof patch.endOfTurnMs === "number" ? { endOfTurnMs: Math.min(8000, Math.max(800, patch.endOfTurnMs)) } : {}),
    ...(typeof patch.thinkingPauseMs === "number" ? { thinkingPauseMs: Math.min(180000, Math.max(5000, patch.thinkingPauseMs)) } : {}),
    ...(typeof patch.speakAloud === "boolean" ? { speakAloud: patch.speakAloud } : {}),
    ...(typeof patch.emailSelfSummaries === "boolean" ? { emailSelfSummaries: patch.emailSelfSummaries } : {}),
    ...(typeof patch.retainAudio === "boolean" ? { retainAudio: patch.retainAudio } : {}),
    ...(typeof patch.audioRetentionDays === "number" ? { audioRetentionDays: Math.min(365, Math.max(1, patch.audioRetentionDays)) } : {}),
    ...(typeof patch.monthlyCostLimitCents === "number" ? { monthlyCostLimitCents: Math.max(0, patch.monthlyCostLimitCents) } : {}),
    ...(patch.listenMode === "CONVERSATION" || patch.listenMode === "PUSH_TO_TALK" || patch.listenMode === "DICTATION" ? { listenMode: patch.listenMode } : {}),
    ...(patch.defaultProvider === "openai" || patch.defaultProvider === "anthropic" || patch.defaultProvider === "xai" || patch.defaultProvider === "none"
      ? { defaultProvider: patch.defaultProvider }
      : {}),
  });
  if (typeof patch.projectId === "string" && Array.isArray(patch.allowedProviders)) {
    const allowed = patch.allowedProviders.filter((item): item is "OPENAI" | "ANTHROPIC" | "XAI" => item === "OPENAI" || item === "ANTHROPIC" || item === "XAI");
    await getNodePrisma().researchProject.updateMany({
      where: { id: patch.projectId, organizationId: auth.scope.organizationId, workspaceId: auth.scope.workspaceId, ownerId: auth.scope.userId },
      data: { allowedProviders: allowed },
    });
  }
  return NextResponse.json({ ok: true, preference });
}
