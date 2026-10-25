import { isHandsFreeResearchTurn, parseTurn, startsNewResearchSession } from "@/lib/research/parse";
import { createResearchDeps } from "@/lib/research/runtime";
import { runTurn } from "@/lib/research/turn";
import type { ResearchScope } from "@/lib/research/types";

const RECENT_MS = 2 * 60 * 60 * 1000;

/**
 * Run a spoken research turn for a matched owner.
 * Returns null when the words belong to the inbox reader instead.
 */
export async function speakResearchForOwner(input: {
  scope: ResearchScope;
  text: string;
}): Promise<string | null> {
  const turn = parseTurn(input.text);
  if (!isHandsFreeResearchTurn(turn)) return null;
  const deps = createResearchDeps(input.scope);
  const latest = (await deps.store.listSessions(input.scope, 1))[0] ?? null;
  const recent = latest != null && Date.now() - new Date(latest.lastActiveAt).getTime() < RECENT_MS;
  if (!startsNewResearchSession(turn) && !recent) return null;
  const result = await runTurn({
    scope: input.scope,
    text: input.text,
    sessionId: startsNewResearchSession(turn) ? null : latest?.id ?? null,
    mode: "conversation",
    deps,
  });
  return result.spoken;
}
