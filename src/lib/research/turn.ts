import { dateWindow, formatWhen } from "@/lib/research/dates";
import {
  assembleFromSources,
  buildModelInput,
  compareAnswers,
  finalizeExplanation,
  generalKnowledgeBanner,
  sourceSpoken,
} from "@/lib/research/explain";
import { applyTerm, findUncertainTerms } from "@/lib/research/glossary";
import { parseTurn, type ParsedTurn, type SpokenCommand } from "@/lib/research/parse";
import {
  authorizeTool,
  budgetBlock,
  estimateCents,
  logResearchFailure,
  providerAllowed,
  RESEARCH_LIMITS,
  taskIsStale,
  tokensFromText,
  whatHappened,
} from "@/lib/research/policy";
import { providerLabel, selectProvider } from "@/lib/research/providers";
import { matchProject } from "@/lib/research/store";
import { blank, draftReply, editDraft, emailSessionToOwner, prepareOutside, readBack, readInbox, sendPendingDraft } from "@/lib/research/turn-mail";
import type { TurnDeps } from "@/lib/research/turn-types";
import type {
  AgentPreference,
  GlossaryTerm,
  ProviderId,
  ResearchProject,
  ResearchScope,
  ResearchSession,
  ResearchTask,
  TaskCheckpoint,
  TurnResult,
} from "@/lib/research/types";

const HELP =
  "I'm listening. After I finish, just speak. Say stop to interrupt me. Say cancel to stop research. You can also say repeat, slower, faster, explain more, give me the short version, go back, correct that, save this, email this to me, continue yesterday's discussion, and what are you doing. I keep listening until you leave this page.";

type Base = Pick<TurnResult, "monthCents" | "costLimitCents" | "audioRetained" | "audioNote">;

export async function runTurn(input: {
  scope: ResearchScope;
  text: string;
  sessionId?: string | null;
  mode?: "conversation" | "dictation" | "push_to_talk";
  deps: TurnDeps;
}): Promise<TurnResult> {
  const { deps, scope } = input;
  let ensured;
  try {
    ensured = await deps.store.ensureWorkspace(scope);
    await deps.store.deleteExpiredAudio(scope, deps.now);
  } catch {
    logResearchFailure({ code: "storage" });
    return blank({ ok: false, persisted: false, spoken: whatHappened("storage").spoken, whatHappened: whatHappened("storage").spoken });
  }
  const preference = ensured.preference;
  const monthCents = await deps.store.sumEstimatedCents(scope, monthStart(deps.now)).catch(() => 0);
  const base: Base = {
    monthCents,
    costLimitCents: preference.monthlyCostLimitCents,
    audioRetained: false,
    audioNote: preference.retainAudio
      ? `Audio retention is on for ${preference.audioRetentionDays} days. A clip is kept only when you send one with this turn.`
      : "Audio is not retained. Transcripts are saved only after the server confirms the save.",
  };
  let session = input.sessionId ? await deps.store.getSession(scope, input.sessionId) : null;
  const dictating = input.mode === "dictation" || preference.listenMode === "DICTATION";
  const parsed = parseTurn(input.text, dictating ? "dictation" : "conversation");
  if (session?.pending && resolvesPending(session.pending.type, parsed)) {
    return handlePending({ scope, session, parsed, text: input.text, projects: ensured.projects, glossary: ensured.glossary, preference, deps, base });
  }
  if (session?.pending && (parsed.type === "research" || parsed.type === "dictate" || parsed.type === "provider")) {
    session = await deps.store.updateSession(scope, session.id, { pending: null });
  }

  switch (parsed.type) {
    case "command":
      return handleCommand(parsed.command, { scope, session, preference, deps, base, projects: ensured.projects });
    case "confirm_yes":
    case "confirm_no":
    case "delete_confirm":
      return blank({ ...base, sessionId: session?.id ?? null, spoken: "Nothing is waiting for that confirmation." });
    case "correct_to":
      return applyCorrection(scope, session, parsed.replacement, deps, base);
    case "research":
      return beginResearch({
        scope,
        text: input.text,
        question: parsed.question,
        projectHint: parsed.projectHint,
        emailSelf: parsed.emailSelf,
        generalKnowledge: parsed.generalKnowledge,
        provider: null,
        session,
        projects: ensured.projects,
        glossary: ensured.glossary,
        preference,
        deps,
        base,
        kind: "research",
      });
    case "dictate":
      return dictate({ scope, text: parsed.text, projectHint: parsed.projectHint, session, projects: ensured.projects, deps, base });
    case "analyze":
      return analyze({ scope, session, projects: ensured.projects, preference, deps, base });
    case "resume":
      return resumeByQuery(scope, parsed.query, deps, base);
    case "retrieve":
      return retrieve(scope, parsed, deps, base);
    case "provider":
      return beginResearch({
        scope,
        text: input.text,
        question: parsed.question ?? "",
        projectHint: null,
        emailSelf: false,
        generalKnowledge: false,
        provider: parsed.provider,
        session,
        projects: ensured.projects,
        glossary: ensured.glossary,
        preference,
        deps,
        base,
        kind: "research",
        reuseSources: !parsed.question,
      });
    case "compare":
      return compare(scope, session, ensured.projects, preference, deps, base);
    case "email_other":
      return prepareOutside({ scope, session, recipient: parsed.recipient, deps, base });
    case "inbox_read":
      return readInbox({ scope, session, projects: ensured.projects, deps, base });
    case "inbox_draft":
      return draftReply({ scope, session, instruction: parsed.instruction, deps, base });
    case "inbox_readback":
      return readBack(session, base);
    case "inbox_edit":
      return editDraft({ scope, session, instruction: parsed.instruction, deps, base });
    case "inbox_send":
      return sendPendingDraft({ scope, session, deps, base });
    case "delete_session":
      if (!session) return blank({ ...base, spoken: "There is no session to delete." });
      await deps.store.updateSession(scope, session.id, { pending: { type: "delete_session" } });
      return blank({ ...base, persisted: true, sessionId: session.id, spoken: "Say yes, delete it to hide this session. I have not deleted it yet." });
    case "conversation":
      if (!parsed.text.trim()) return blank({ ...base, sessionId: session?.id ?? null, spoken: "I did not hear any words. Press Talk or type your request." });
      return converse({ scope, text: parsed.text, session, projects: ensured.projects, preference, deps, base });
    default: {
      const never: never = parsed;
      return never;
    }
  }
}

export async function resumeResearchTask(input: { scope: ResearchScope; taskId: string; deps: TurnDeps }): Promise<TurnResult> {
  const ensured = await input.deps.store.ensureWorkspace(input.scope);
  const task = await input.deps.store.getTask(input.scope, input.taskId);
  if (!task) return blank({ spoken: "I cannot find that research task in your account." });
  const session = await input.deps.store.getSession(input.scope, task.sessionId);
  if (!session) return blank({ spoken: "I cannot find that session in your account." });
  if (task.status === "CANCELED") {
    return blank({ sessionId: session.id, taskId: task.id, taskStatus: "CANCELED", spoken: "That research task was canceled. Saved words are still saved." });
  }
  if (task.checkpoint.emailStatus === "unknown") {
    return blank({
      persisted: true,
      sessionId: session.id,
      taskId: task.id,
      taskStatus: task.status,
      spoken: `${session.lastSpoken ? `${session.lastSpoken} ` : ""}${whatHappened("email_unknown").spoken}`,
      whatHappened: whatHappened("email_unknown").spoken,
    });
  }
  if (task.status === "COMPLETED") {
    return blank({ persisted: true, sessionId: session.id, taskId: task.id, taskStatus: "COMPLETED", spoken: session.lastSpoken || "That research already finished." });
  }
  const project = ensured.projects.find((item) => item.id === task.checkpoint.projectId) ?? ensured.projects[0];
  if (!project) return blank({ spoken: whatHappened("storage").spoken, whatHappened: whatHappened("storage").spoken });
  const base: Base = { monthCents: 0, costLimitCents: ensured.preference.monthlyCostLimitCents, audioRetained: false, audioNote: "Audio is not retained." };
  return executeResearch({
    scope: input.scope,
    session,
    project,
    question: task.checkpoint.question,
    emailSelf: task.checkpoint.emailSelf && task.checkpoint.emailStatus === "pending",
    generalKnowledge: task.checkpoint.generalKnowledge,
    provider: task.checkpoint.provider === "none" ? null : task.checkpoint.provider,
    preference: ensured.preference,
    deps: input.deps,
    base,
    task,
    kind: "research",
    autoEmail: task.checkpoint.emailStatus === "pending",
  });
}

export async function attachAudio(input: {
  scope: ResearchScope;
  sessionId: string | null;
  audioBase64: string | null;
  deps: TurnDeps;
}): Promise<{ audioRetained: boolean; audioNote: string }> {
  const preference = (await input.deps.store.ensureWorkspace(input.scope)).preference;
  if (!preference.retainAudio) {
    return { audioRetained: false, audioNote: "Audio is not retained. Transcripts are saved only after the server confirms the save." };
  }
  if (!input.sessionId || !input.audioBase64) {
    return { audioRetained: false, audioNote: `Audio retention is on for ${preference.audioRetentionDays} days. This turn did not include an audio clip.` };
  }
  const bytes = Buffer.from(input.audioBase64, "base64");
  const saved = await input.deps.store.saveAudio(input.scope, { sessionId: input.sessionId, bytes, mimeType: "audio/webm", now: input.deps.now });
  if (!saved.ok) {
    return { audioRetained: false, audioNote: saved.code === "too_large" ? "The audio clip was too large, so I did not retain it." : "Audio was not retained." };
  }
  return { audioRetained: true, audioNote: `Original audio is retained for ${preference.audioRetentionDays} days.` };
}

function resolvesPending(type: string, parsed: ParsedTurn): boolean {
  if (type === "term") return parsed.type === "confirm_yes" || parsed.type === "confirm_no";
  if (type === "spell" || type === "correct") return parsed.type === "conversation" || parsed.type === "correct_to";
  if (type === "delete_session") return parsed.type === "delete_confirm";
  return false;
}

async function handlePending(input: {
  scope: ResearchScope;
  session: ResearchSession;
  parsed: ParsedTurn;
  text: string;
  projects: ResearchProject[];
  glossary: GlossaryTerm[];
  preference: AgentPreference;
  deps: TurnDeps;
  base: Base;
}): Promise<TurnResult> {
  const pending = input.session.pending;
  if (!pending) return blank({ ...input.base, spoken: "Nothing is waiting." });
  if (pending.type === "delete_session") {
    const deleted = await input.deps.store.deleteSession(input.scope, input.session.id);
    return blank({ ...input.base, persisted: deleted, spoken: deleted ? "Deleted. The session is hidden from your list." : "I could not delete that session." });
  }
  if (pending.type === "correct") {
    const replacement = input.parsed.type === "correct_to" ? input.parsed.replacement : input.text;
    return applyCorrection(input.scope, input.session, replacement, input.deps, input.base);
  }
  if (pending.type === "term" && input.parsed.type === "confirm_no") {
    await input.deps.store.updateSession(input.scope, input.session.id, {
      pending: { type: "spell", heard: pending.heard, question: pending.question, projectHint: pending.projectHint, emailSelf: pending.emailSelf },
    });
    return blank({ ...input.base, persisted: true, sessionId: input.session.id, spoken: `Please say the spelling you want instead of ${pending.heard}.` });
  }
  if ((pending.type === "term" && input.parsed.type === "confirm_yes") || pending.type === "spell") {
    const canonical = pending.type === "term" ? pending.canonical : input.parsed.type === "correct_to" ? input.parsed.replacement : input.text.trim();
    if (pending.type === "spell") await input.deps.store.upsertGlossary(input.scope, { term: canonical, aliases: [pending.heard] });
    const question = applyTerm(pending.question, pending.heard, canonical);
    await input.deps.store.updateSession(input.scope, input.session.id, { pending: null });
    return beginResearch({
      scope: input.scope,
      text: question,
      question,
      projectHint: pending.projectHint,
      emailSelf: pending.emailSelf,
      generalKnowledge: false,
      provider: null,
      session: { ...input.session, pending: null },
      projects: input.projects,
      glossary: input.glossary,
      preference: input.preference,
      deps: input.deps,
      base: input.base,
      kind: "research",
      alreadyStored: true,
    });
  }
  return blank({ ...input.base, sessionId: input.session.id, spoken: "Nothing is waiting for that confirmation." });
}

async function handleCommand(
  command: SpokenCommand,
  ctx: { scope: ResearchScope; session: ResearchSession | null; preference: AgentPreference; deps: TurnDeps; base: Base; projects: ResearchProject[] },
): Promise<TurnResult> {
  switch (command) {
    case "stop":
      return blank({ ...ctx.base, sessionId: ctx.session?.id ?? null, spoken: "Stopped speaking. I did not cancel research." });
    case "repeat":
      return blank({ ...ctx.base, sessionId: ctx.session?.id ?? null, spoken: ctx.session?.lastSpoken || "There is nothing to repeat yet." });
    case "slower":
    case "faster": {
      const next = clampRate(ctx.preference.speechRate + (command === "faster" ? 0.15 : -0.15));
      await ctx.deps.store.savePreference(ctx.scope, { speechRate: next });
      return blank({ ...ctx.base, persisted: true, sessionId: ctx.session?.id ?? null, spoken: `Speaking rate is now ${next.toFixed(2)}.` });
    }
    case "back":
      return blank({ ...ctx.base, sessionId: ctx.session?.id ?? null, spoken: "Go back uses the previous spoken answer on this device. Press Repeat to hear the latest saved answer." });
    case "help":
      return blank({ ...ctx.base, sessionId: ctx.session?.id ?? null, spoken: HELP, detail: HELP });
    case "status":
      return taskStatus(ctx);
    case "cancel":
      return cancelTask(ctx);
    case "save":
      return confirmSave(ctx);
    case "correct":
      if (!ctx.session) return blank({ ...ctx.base, spoken: "There is no transcript to correct." });
      await ctx.deps.store.updateSession(ctx.scope, ctx.session.id, { pending: { type: "correct" } });
      return blank({ ...ctx.base, persisted: true, sessionId: ctx.session.id, spoken: "What should I change it to? I will keep the original transcript." });
    case "email_self":
      if (!ctx.session) return blank({ ...ctx.base, spoken: "There is no session to email." });
      return emailSessionToOwner({ scope: ctx.scope, session: ctx.session, preference: ctx.preference, explicit: true, deps: ctx.deps, base: ctx.base });
    case "resume_yesterday": {
      const window = dateWindow({ when: "yesterday", weekday: null, now: ctx.deps.now, timeZone: ctx.deps.timeZone });
      const sessions = await ctx.deps.store.listSessions(ctx.scope, 20);
      const match = sessions.find((item) => item.lastActiveAt >= window.from && item.lastActiveAt < window.to);
      if (!match) return blank({ ...ctx.base, spoken: "I could not find a discussion from yesterday in your account." });
      return blank({ ...ctx.base, persisted: true, sessionId: match.id, spoken: `Continuing ${match.title} from ${formatWhen(match.lastActiveAt, ctx.deps.timeZone)}. ${match.lastSpoken ?? "There is no answer stored yet."}` });
    }
    case "short":
    case "explain_more":
    case "sources":
      return readStoredAnswer(ctx, command);
    default: {
      const never: never = command;
      return never;
    }
  }
}

async function beginResearch(input: {
  scope: ResearchScope;
  text: string;
  question: string;
  projectHint: string | null;
  emailSelf: boolean;
  generalKnowledge: boolean;
  provider: ProviderId | null;
  session: ResearchSession | null;
  projects: ResearchProject[];
  glossary: GlossaryTerm[];
  preference: AgentPreference;
  deps: TurnDeps;
  base: Base;
  kind: "research" | "conversation";
  alreadyStored?: boolean;
  reuseSources?: boolean;
}): Promise<TurnResult> {
  const hinted = matchProject(input.projects, input.projectHint);
  const project = hinted ?? (input.session ? input.projects.find((item) => item.id === input.session?.projectId) ?? null : null) ?? input.projects.find((item) => item.kind === "PERSONAL") ?? null;
  if (!project) return blank({ ...input.base, spoken: whatHappened("storage").spoken, whatHappened: whatHappened("storage").spoken });
  if (input.projectHint && !hinted) {
    const personal = input.projects.find((item) => item.kind === "PERSONAL") ?? project;
    const session = await openSession(input.scope, input.session, personal, input.text || "Unfiled note", input.deps);
    const persisted = await persistOwner(input.scope, session, personal.id, input.text, "SPEECH_TRANSCRIPT", input.deps);
    if (!persisted.ok) return persisted.result;
    return blank({
      ...input.base,
      persisted: true,
      sessionId: session.id,
      spoken: `I could not match the project ${input.projectHint}. I saved your words in Personal and did not file them under a guessed name.`,
    });
  }
  let question = input.question.trim();
  if ((input.generalKnowledge || input.reuseSources) && !question && input.session) {
    question = (await latestOwnerText(input.scope, input.session.id, input.deps)) ?? "";
  }
  if (input.kind === "research" && !input.generalKnowledge && question.length < 8 && !input.reuseSources) {
    const session = await openSession(input.scope, input.session, project, "Research question", input.deps);
    const persisted = await persistOwner(input.scope, session, project.id, input.text, "SPEECH_TRANSCRIPT", input.deps);
    if (!persisted.ok) return persisted.result;
    return blank({ ...input.base, persisted: true, sessionId: session.id, spoken: "What should I research? I need the scientific question before I search." });
  }
  const uncertain = input.generalKnowledge ? [] : findUncertainTerms(question, input.glossary);
  const session = await openSession(input.scope, input.session, project, question || input.text, input.deps);
  if (!input.alreadyStored) {
    const persisted = await persistOwner(input.scope, session, project.id, input.text, "SPEECH_TRANSCRIPT", input.deps);
    if (!persisted.ok) return persisted.result;
  }
  const first = uncertain[0];
  if (first) {
    await input.deps.store.updateSession(input.scope, session.id, {
      pending: { type: "term", heard: first.heard, canonical: first.canonical, question, projectHint: input.projectHint, emailSelf: input.emailSelf },
    });
    return blank({ ...input.base, persisted: true, sessionId: session.id, spoken: `I heard ${first.heard}. Did you mean ${first.canonical}? Say yes or no. I have not searched yet.` });
  }
  if (input.provider && !providerAllowed(project.allowedProviders, input.provider)) {
    return blank({
      ...input.base,
      persisted: true,
      sessionId: session.id,
      spoken: `${providerLabel(input.provider)} is not allowed to receive material from ${project.name}. I did not send this project to that provider.`,
    });
  }
  return executeResearch({
    scope: input.scope,
    session,
    project,
    question: question || input.text,
    emailSelf: input.emailSelf,
    generalKnowledge: input.generalKnowledge,
    provider: input.provider,
    preference: input.preference,
    deps: input.deps,
    base: input.base,
    kind: input.kind,
    reuseSources: input.reuseSources,
    autoEmail: input.emailSelf || input.preference.emailSelfSummaries,
  });
}

async function executeResearch(input: {
  scope: ResearchScope;
  session: ResearchSession;
  project: ResearchProject;
  question: string;
  emailSelf: boolean;
  generalKnowledge: boolean;
  provider: ProviderId | null;
  preference: AgentPreference;
  deps: TurnDeps;
  base: Base;
  task?: ResearchTask;
  kind: "research" | "conversation";
  reuseSources?: boolean;
  autoEmail?: boolean;
}): Promise<TurnResult> {
  const checkpoint: TaskCheckpoint = input.task?.checkpoint ?? {
    question: input.question,
    projectId: input.project.id,
    emailSelf: input.emailSelf,
    provider: input.provider ?? input.session.provider,
    searchDone: Boolean(input.reuseSources) || input.kind === "conversation",
    explainDone: false,
    emailStatus: input.autoEmail ? "pending" : "skipped",
    generalKnowledge: input.generalKnowledge,
  };
  let task = input.task;
  try {
    if (!task) {
      task = await input.deps.store.createTask(input.scope, { sessionId: input.session.id, kind: input.kind, step: checkpoint.searchDone ? "explain" : "search", checkpoint });
      await input.deps.store.updateSession(input.scope, input.session.id, { activeTaskId: task.id });
    }
  } catch {
    logResearchFailure({ code: "storage" });
    return blank({ ...input.base, ok: false, persisted: true, sessionId: input.session.id, spoken: "Your words are saved. I could not start the task.", whatHappened: whatHappened("storage").spoken });
  }
  const started = new Date(task.startedAt).getTime();
  let toolCalls = task.toolCalls;
  const hitBudget = () => budgetBlock({ toolCalls, startedAtMs: started, nowMs: input.deps.now.getTime(), attempts: task?.attempt ?? 1 });
  let sources = await input.deps.store.listSources(input.scope, input.session.id);

  if (!checkpoint.searchDone) {
    const blocked = hitBudget();
    if (blocked) return failTask(input, task, blocked);
    const allowed = authorizeTool({ tool: "search_publications", args: {}, ownerEmail: input.scope.email });
    if (!allowed.ok) return failTask(input, task, allowed.reason);
    toolCalls += 1;
    try {
      const hits = await input.deps.searchPublications(input.question);
      sources = await input.deps.store.saveSources(input.scope, input.session.id, hits);
      checkpoint.searchDone = true;
      task = await touch(input, task, { step: "explain", toolCalls, checkpoint, status: "RUNNING" });
    } catch {
      logResearchFailure({ taskId: task.id, code: "research_unavailable" });
      await touch(input, task, { status: "FAILED", errorCode: "research_unavailable", step: "search", finishedAt: input.deps.now.toISOString() });
      return blank({
        ...input.base,
        persisted: true,
        sessionId: input.session.id,
        taskId: task.id,
        taskStatus: "FAILED",
        spoken: whatHappened("research_unavailable").spoken,
        whatHappened: whatHappened("research_unavailable").spoken,
      });
    }
  }

  let providerMeta: TurnResult["provider"] = { id: "none", model: null };
  let spoken = input.session.lastSpoken ?? "";
  if (!checkpoint.explainDone) {
    const monthCents = await input.deps.store.sumEstimatedCents(input.scope, monthStart(input.deps.now));
    const overBudget = monthCents >= input.preference.monthlyCostLimitCents;
    const configured = input.deps.configured.filter((item) => providerAllowed(input.project.allowedProviders, item.id));
    const choice = selectProvider({ requested: input.provider ?? (input.session.provider === "none" ? null : input.session.provider), preference: input.preference.defaultProvider, configured });
    if (input.provider && choice.refusal) {
      await touch(input, task, { status: "FAILED", errorCode: "provider_missing", finishedAt: input.deps.now.toISOString() });
      return blank({ ...input.base, persisted: true, sessionId: input.session.id, taskId: task.id, taskStatus: "FAILED", spoken: choice.refusal, sources });
    }
    const useModel = Boolean(choice.config) && !overBudget && (sources.length > 0 || input.kind === "conversation" || checkpoint.generalKnowledge);
    let explanation = "";
    if (!useModel && input.kind === "research" && sources.length === 0 && !checkpoint.generalKnowledge) {
      explanation = assembleFromSources(input.question, []);
    } else if (!useModel && overBudget) {
      explanation = `SHORT:\n${whatHappened("cost_limit").spoken}\nEVIDENCE:\n${assembleFromSources(input.question, sources)}`;
    } else if (!useModel) {
      explanation = checkpoint.generalKnowledge
        ? "SHORT:\nNo language model is configured, so I cannot answer from general knowledge.\nEVIDENCE:\nNo provider API key is set.\nOPEN_QUESTIONS:\n-\nNEXT:\n-"
        : assembleFromSources(input.question, sources);
    } else if (choice.config) {
      const blocked = hitBudget();
      if (blocked) return failTask(input, task, blocked);
      toolCalls += 1;
      const history = (await input.deps.store.listRecords(input.scope, { sessionId: input.session.id, limit: RESEARCH_LIMITS.maxContextRecords })).reverse();
      const memory = await input.deps.store.listRecords(input.scope, { query: input.question.slice(0, 80), limit: 6 });
      const knowledgeOnly = checkpoint.generalKnowledge || (input.kind === "conversation" && sources.length === 0);
      const built = buildModelInput({ question: input.question, history, memory, sources: knowledgeOnly ? [] : sources, generalKnowledge: knowledgeOnly });
      const completed = await input.deps.complete(
        { provider: choice.config.id, system: built.system, messages: [{ role: "user", content: built.user }], maxTokens: 900 },
        choice.config,
      );
      if (!completed.ok) {
        logResearchFailure({ taskId: task.id, code: completed.code });
        await touch(input, task, { status: "FAILED", errorCode: completed.code, step: "explain", toolCalls, finishedAt: input.deps.now.toISOString() });
        const sourceNote = sources[0]
          ? ` I did retrieve ${sources.length} publication record${sources.length === 1 ? "" : "s"}. The first is ${sources[0].title}. ${sources[0].accessLevel === "FULL_TEXT" ? "Full text was retrieved for that record." : "I did not review the full paper."}`
          : "";
        return blank({
          ...input.base,
          persisted: true,
          sessionId: input.session.id,
          taskId: task.id,
          taskStatus: "FAILED",
          spoken: `${completed.spoken}${sourceNote}`,
          whatHappened: whatHappened(completed.code).spoken,
          sources,
          provider: { id: completed.provider, model: completed.model },
        });
      }
      const cents = estimateCents({
        provider: completed.provider,
        inputTokens: completed.inputTokens || tokensFromText(built.user),
        outputTokens: completed.outputTokens || tokensFromText(completed.content),
      });
      explanation = knowledgeOnly ? generalKnowledgeBanner(completed.content) : completed.content;
      providerMeta = { id: completed.provider, model: completed.model };
      checkpoint.provider = completed.provider;
      task = await touch(input, task, { estimatedCents: task.estimatedCents + cents, toolCalls });
    }
    const finalized = finalizeExplanation(explanation, sources);
    try {
      await input.deps.store.appendRecord(input.scope, {
        sessionId: input.session.id,
        projectId: input.project.id,
        kind: "ASSISTANT_RESPONSE",
        speaker: "ASSISTANT",
        text: `${finalized.short}\n\n${finalized.detail}`.trim(),
        provider: providerMeta.id,
        model: providerMeta.model,
      });
      await input.deps.store.appendRecord(input.scope, {
        sessionId: input.session.id,
        projectId: input.project.id,
        kind: "SUMMARY",
        speaker: "ASSISTANT",
        text: finalized.short,
        provider: providerMeta.id,
        model: providerMeta.model,
      });
      for (const item of finalized.openQuestions) {
        await input.deps.store.appendRecord(input.scope, {
          sessionId: input.session.id,
          projectId: input.project.id,
          kind: "FOLLOW_UP",
          speaker: "ASSISTANT",
          text: item,
          provider: providerMeta.id,
          model: providerMeta.model,
        });
      }
    } catch {
      logResearchFailure({ taskId: task.id, code: "storage" });
      return blank({ ...input.base, ok: false, persisted: true, sessionId: input.session.id, taskId: task.id, spoken: "I could not store the answer. I am not calling it saved.", whatHappened: whatHappened("storage").spoken, sources });
    }
    checkpoint.explainDone = true;
    spoken = `${finalized.short} Say explain more for the evidence, limits, and sources.`;
    await input.deps.store.updateSession(input.scope, input.session.id, { lastSpoken: spoken, provider: providerMeta.id });
    task = await touch(input, task, { step: "email", checkpoint, status: "RUNNING" });
  }

  let email: TurnResult["email"] = null;
  if (checkpoint.emailStatus === "pending" && (input.emailSelf || input.autoEmail)) {
    const sent = await emailSessionToOwner({
      scope: input.scope,
      session: { ...input.session, lastSpoken: spoken || input.session.lastSpoken },
      preference: input.preference,
      explicit: input.emailSelf || input.preference.emailSelfSummaries,
      deps: input.deps,
      base: input.base,
    });
    email = sent.email;
    checkpoint.emailStatus = sent.email?.status === "PROVIDER_ACCEPTED" ? "accepted" : sent.email?.status === "UNKNOWN" ? "unknown" : sent.email ? "failed" : "skipped";
    if (sent.spoken) spoken = `${spoken} ${sent.spoken}`.trim();
    await input.deps.store.updateSession(input.scope, input.session.id, { lastSpoken: spoken });
  }
  task = await touch(input, task, { status: "COMPLETED", step: "done", checkpoint, finishedAt: input.deps.now.toISOString(), toolCalls });
  await input.deps.store.updateSession(input.scope, input.session.id, { activeTaskId: null });
  return blank({
    ...input.base,
    persisted: true,
    sessionId: input.session.id,
    taskId: task.id,
    taskStatus: "COMPLETED",
    spoken: spoken || "Saved.",
    detail: spoken,
    provider: providerMeta,
    sources,
    email,
  });
}

async function converse(input: {
  scope: ResearchScope;
  text: string;
  session: ResearchSession | null;
  projects: ResearchProject[];
  preference: AgentPreference;
  deps: TurnDeps;
  base: Base;
}): Promise<TurnResult> {
  const project = input.projects.find((item) => item.id === input.session?.projectId) ?? input.projects.find((item) => item.kind === "PERSONAL");
  if (!project) return blank({ ...input.base, spoken: whatHappened("storage").spoken });
  const session = await openSession(input.scope, input.session, project, input.text.slice(0, 80), input.deps);
  const persisted = await persistOwner(input.scope, session, project.id, input.text, "SPEECH_TRANSCRIPT", input.deps);
  if (!persisted.ok) return persisted.result;
  return executeResearch({
    scope: input.scope,
    session,
    project,
    question: input.text,
    emailSelf: false,
    generalKnowledge: false,
    provider: session.provider === "none" ? null : session.provider,
    preference: input.preference,
    deps: input.deps,
    base: input.base,
    kind: "conversation",
    reuseSources: true,
    autoEmail: false,
  });
}

async function dictate(input: {
  scope: ResearchScope;
  text: string;
  projectHint: string | null;
  session: ResearchSession | null;
  projects: ResearchProject[];
  deps: TurnDeps;
  base: Base;
}): Promise<TurnResult> {
  const project = matchProject(input.projects, input.projectHint) ?? input.projects.find((item) => item.id === input.session?.projectId) ?? input.projects.find((item) => item.kind === "SCIENTIFIC_IDEAS") ?? input.projects[0];
  if (!project) return blank({ ...input.base, spoken: whatHappened("storage").spoken });
  const session = await openSession(input.scope, input.session, project, input.text.slice(0, 80) || "Dictation", input.deps);
  const persisted = await persistOwner(input.scope, session, project.id, input.text, "DICTATION", input.deps);
  if (!persisted.ok) return persisted.result;
  if (/\bhypothesis\b/i.test(input.text)) {
    await input.deps.store.appendRecord(input.scope, { sessionId: session.id, projectId: project.id, kind: "HYPOTHESIS", speaker: "OWNER", text: input.text, provider: null, model: null });
  }
  return blank({ ...input.base, persisted: true, sessionId: session.id, spoken: `Saved in ${project.name} as your words. I have not analyzed them. Say analyze this when you want that.` });
}

async function analyze(input: {
  scope: ResearchScope;
  session: ResearchSession | null;
  projects: ResearchProject[];
  preference: AgentPreference;
  deps: TurnDeps;
  base: Base;
}): Promise<TurnResult> {
  if (!input.session) return blank({ ...input.base, spoken: "There is no dictation in the current session to analyze." });
  const notes = await input.deps.store.listRecords(input.scope, { sessionId: input.session.id, kinds: ["DICTATION"], speaker: "OWNER", limit: 8 });
  if (notes.length === 0) return blank({ ...input.base, sessionId: input.session.id, spoken: "I do not have dictated ideas in this session yet." });
  const project = input.projects.find((item) => item.id === input.session?.projectId) ?? input.projects[0];
  if (!project) return blank({ ...input.base, spoken: whatHappened("storage").spoken });
  return executeResearch({
    scope: input.scope,
    session: input.session,
    project,
    question: notes.map((note) => note.correctedText ?? note.text).reverse().join("\n"),
    emailSelf: false,
    generalKnowledge: false,
    provider: null,
    preference: input.preference,
    deps: input.deps,
    base: input.base,
    kind: "research",
    autoEmail: false,
  });
}

async function compare(
  scope: ResearchScope,
  session: ResearchSession | null,
  projects: ResearchProject[],
  preference: AgentPreference,
  deps: TurnDeps,
  base: Base,
): Promise<TurnResult> {
  if (!session) return blank({ ...base, spoken: "There are not two answers to compare yet." });
  const answers = await deps.store.listRecords(scope, { sessionId: session.id, kinds: ["ASSISTANT_RESPONSE"], limit: 8 });
  const distinct: typeof answers = [];
  for (const record of answers) {
    if (!distinct.some((item) => item.provider === record.provider)) distinct.push(record);
  }
  if (distinct.length < 2) {
    const current = distinct[0]?.provider ?? null;
    const alternate = deps.configured.find((item) => item.id !== current)?.id ?? null;
    if (!alternate) return blank({ ...base, persisted: true, sessionId: session.id, spoken: "I only have one answer, and no other provider is configured. I did not invent a second opinion." });
    const project = projects.find((item) => item.id === session.projectId);
    if (!project) return blank({ ...base, spoken: whatHappened("storage").spoken });
    await executeResearch({
      scope,
      session,
      project,
      question: (await latestOwnerText(scope, session.id, deps)) || session.title,
      emailSelf: false,
      generalKnowledge: false,
      provider: alternate,
      preference,
      deps,
      base,
      kind: "research",
      reuseSources: true,
      autoEmail: false,
    });
  }
  const refreshed = await deps.store.listRecords(scope, { sessionId: session.id, kinds: ["ASSISTANT_RESPONSE"], limit: 8 });
  const left = refreshed[1] ?? refreshed[0];
  const right = refreshed[0];
  if (!left || !right || left.id === right.id) return blank({ ...base, sessionId: session.id, spoken: "I still do not have two answers to compare." });
  const spoken = compareAnswers({ provider: left.provider ?? "none", text: left.text }, { provider: right.provider ?? "none", text: right.text });
  await deps.store.appendRecord(scope, { sessionId: session.id, projectId: session.projectId, kind: "SUMMARY", speaker: "ASSISTANT", text: spoken, provider: null, model: null });
  await deps.store.updateSession(scope, session.id, { lastSpoken: spoken });
  return blank({ ...base, persisted: true, sessionId: session.id, spoken, provider: right.provider ? { id: right.provider, model: right.model } : null });
}

async function retrieve(scope: ResearchScope, parsed: Extract<ParsedTurn, { type: "retrieve" }>, deps: TurnDeps, base: Base): Promise<TurnResult> {
  const window = parsed.when ? dateWindow({ when: parsed.when, weekday: parsed.weekday, now: deps.now, timeZone: deps.timeZone }) : null;
  const records = await deps.store.listRecords(scope, {
    query: parsed.about || undefined,
    kinds: parsed.kind === "dictation" ? ["DICTATION"] : parsed.kind === "follow_up" ? ["FOLLOW_UP"] : undefined,
    speaker: parsed.speaker === "OWNER" ? "OWNER" : undefined,
    from: window?.from,
    to: window?.to,
    limit: RESEARCH_LIMITS.maxRetrievedHits,
  });
  if (records.length === 0) return blank({ ...base, spoken: "I did not find matching records in your account." });
  const sessions = await deps.store.listSessions(scope, 50);
  const spoken = records.map((record) => {
    const title = sessions.find((item) => item.id === record.sessionId)?.title ?? "a session";
    const body = record.correctedText ?? record.text;
    const original = record.correctedText ? ` Original transcript kept: ${record.text}.` : "";
    const who = record.speaker === "OWNER" ? "You said" : record.speaker === "ASSISTANT" ? "The assistant said" : "A system note said";
    return `${formatWhen(record.createdAt, deps.timeZone)}, in ${title}. ${who}: ${body.slice(0, 400)}.${original}`;
  }).join(" ");
  return blank({ ...base, persisted: true, spoken, detail: spoken });
}

async function resumeByQuery(scope: ResearchScope, query: string, deps: TurnDeps, base: Base): Promise<TurnResult> {
  const session = (await deps.store.findSessions(scope, query, 1))[0];
  if (!session) return blank({ ...base, spoken: `I could not find a saved discussion matching ${query}.` });
  return blank({
    ...base,
    persisted: true,
    sessionId: session.id,
    spoken: `Continuing ${session.title}, last active ${formatWhen(session.lastActiveAt, deps.timeZone)}. ${session.lastSpoken ?? "No answer is stored yet."}`,
  });
}

async function taskStatus(ctx: { scope: ResearchScope; session: ResearchSession | null; deps: TurnDeps; base: Base }): Promise<TurnResult> {
  if (!ctx.session?.activeTaskId) return blank({ ...ctx.base, sessionId: ctx.session?.id ?? null, spoken: "I am not running a research task. I am ready for you to talk." });
  const task = await ctx.deps.store.getTask(ctx.scope, ctx.session.activeTaskId);
  if (!task) return blank({ ...ctx.base, sessionId: ctx.session.id, spoken: "I am not running a research task." });
  if (task.status === "RUNNING" && taskIsStale(task.heartbeatAt, ctx.deps.now)) {
    return blank({ ...ctx.base, sessionId: ctx.session.id, taskId: task.id, taskStatus: task.status, spoken: whatHappened("task_interrupted").spoken, whatHappened: whatHappened("task_interrupted").spoken });
  }
  return blank({ ...ctx.base, sessionId: ctx.session.id, taskId: task.id, taskStatus: task.status, spoken: `The research task is ${task.status.toLowerCase()}, on step ${task.step}.` });
}

async function cancelTask(ctx: { scope: ResearchScope; session: ResearchSession | null; deps: TurnDeps; base: Base }): Promise<TurnResult> {
  if (!ctx.session?.activeTaskId) return blank({ ...ctx.base, sessionId: ctx.session?.id ?? null, spoken: "There is no research task to cancel." });
  await ctx.deps.store.updateTask(ctx.scope, ctx.session.activeTaskId, { status: "CANCELED", finishedAt: ctx.deps.now.toISOString() }, ctx.deps.now);
  await ctx.deps.store.updateSession(ctx.scope, ctx.session.id, { activeTaskId: null });
  return blank({ ...ctx.base, persisted: true, sessionId: ctx.session.id, taskStatus: "CANCELED", spoken: "Canceled the research task. I did not undo words that were already saved." });
}

async function confirmSave(ctx: { scope: ResearchScope; session: ResearchSession | null; deps: TurnDeps; base: Base }): Promise<TurnResult> {
  if (!ctx.session) return blank({ ...ctx.base, spoken: "There is nothing new to save yet." });
  try {
    await ctx.deps.store.appendRecord(ctx.scope, {
      sessionId: ctx.session.id,
      projectId: ctx.session.projectId,
      kind: "SYSTEM_NOTE",
      speaker: "SYSTEM",
      text: "Owner confirmed this session is saved.",
      provider: null,
      model: null,
    });
  } catch {
    return blank({ ...ctx.base, ok: false, persisted: false, sessionId: ctx.session.id, spoken: whatHappened("storage").spoken, whatHappened: whatHappened("storage").spoken });
  }
  return blank({ ...ctx.base, persisted: true, sessionId: ctx.session.id, spoken: "Saved. Your words and the responses already stored in this session remain in the project." });
}

async function readStoredAnswer(
  ctx: { scope: ResearchScope; session: ResearchSession | null; deps: TurnDeps; base: Base },
  command: "short" | "explain_more" | "sources",
): Promise<TurnResult> {
  if (!ctx.session) return blank({ ...ctx.base, spoken: "There is no answer to read yet." });
  if (command === "sources") {
    const sources = await ctx.deps.store.listSources(ctx.scope, ctx.session.id);
    return blank({ ...ctx.base, persisted: true, sessionId: ctx.session.id, spoken: sourceSpoken(sources), sources });
  }
  const answer = (await ctx.deps.store.listRecords(ctx.scope, { sessionId: ctx.session.id, kinds: ["ASSISTANT_RESPONSE"], limit: 1 }))[0];
  if (!answer) return blank({ ...ctx.base, persisted: true, sessionId: ctx.session.id, spoken: "There is no stored answer yet." });
  const short = answer.text.split(/\n\n/)[0] ?? answer.text;
  return blank({
    ...ctx.base,
    persisted: true,
    sessionId: ctx.session.id,
    spoken: command === "short" ? short : answer.text,
    detail: answer.text,
    provider: answer.provider ? { id: answer.provider, model: answer.model } : null,
  });
}

async function applyCorrection(scope: ResearchScope, session: ResearchSession | null, replacement: string, deps: TurnDeps, base: Base): Promise<TurnResult> {
  if (!session) return blank({ ...base, spoken: "There is no transcript to correct." });
  const record = (await deps.store.listRecords(scope, { sessionId: session.id, speaker: "OWNER", limit: 1 }))[0];
  if (!record) return blank({ ...base, sessionId: session.id, spoken: "There is no transcript to correct." });
  const corrected = await deps.store.correctRecord(scope, record.id, replacement, deps.now);
  if (!corrected) return blank({ ...base, ok: false, sessionId: session.id, spoken: whatHappened("storage").spoken });
  await deps.store.appendRecord(scope, { sessionId: session.id, projectId: session.projectId, kind: "CORRECTION", speaker: "OWNER", text: replacement, provider: null, model: null });
  const spoken = `Corrected. I kept the original transcript and stored your correction: ${replacement}`;
  await deps.store.updateSession(scope, session.id, { pending: null, lastSpoken: spoken });
  return blank({ ...base, persisted: true, sessionId: session.id, spoken });
}

async function openSession(scope: ResearchScope, session: ResearchSession | null, project: ResearchProject, title: string, deps: TurnDeps): Promise<ResearchSession> {
  if (session && session.projectId === project.id) return session;
  return deps.store.createSession(scope, { projectId: project.id, title: title.slice(0, 80) || "Session", provider: session?.provider ?? "none" });
}

async function persistOwner(
  scope: ResearchScope,
  session: ResearchSession,
  projectId: string,
  text: string,
  kind: "SPEECH_TRANSCRIPT" | "DICTATION",
  deps: TurnDeps,
): Promise<{ ok: true } | { ok: false; result: TurnResult }> {
  try {
    await deps.store.appendRecord(scope, { sessionId: session.id, projectId, kind, speaker: "OWNER", text, provider: null, model: null });
    return { ok: true };
  } catch {
    logResearchFailure({ code: "storage" });
    return { ok: false, result: blank({ ok: false, persisted: false, sessionId: session.id, spoken: whatHappened("storage").spoken, whatHappened: whatHappened("storage").spoken }) };
  }
}

async function latestOwnerText(scope: ResearchScope, sessionId: string, deps: TurnDeps): Promise<string | null> {
  const record = (await deps.store.listRecords(scope, { sessionId, speaker: "OWNER", limit: 1 }))[0];
  return record?.correctedText ?? record?.text ?? null;
}

async function touch(input: { scope: ResearchScope; deps: TurnDeps }, task: ResearchTask, patch: Partial<ResearchTask>): Promise<ResearchTask> {
  return (await input.deps.store.updateTask(input.scope, task.id, patch, input.deps.now)) ?? task;
}

async function failTask(
  input: { scope: ResearchScope; session: ResearchSession; deps: TurnDeps; base: Base },
  task: ResearchTask,
  code: string,
): Promise<TurnResult> {
  logResearchFailure({ taskId: task.id, code });
  await input.deps.store.updateTask(input.scope, task.id, { status: "FAILED", errorCode: code, finishedAt: input.deps.now.toISOString() }, input.deps.now);
  return blank({
    ...input.base,
    persisted: true,
    sessionId: input.session.id,
    taskId: task.id,
    taskStatus: "FAILED",
    spoken: whatHappened(code).spoken,
    whatHappened: whatHappened(code).spoken,
  });
}

function clampRate(rate: number): number {
  return Math.round(Math.min(1.5, Math.max(0.7, rate)) * 100) / 100;
}

function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export type { TurnDeps };
