import { formatWhen } from "@/lib/research/dates";
import { sessionEmailBody } from "@/lib/research/explain";
import { authorizeTool, decideEmailSend, emailIdempotencyKey, replaceSecondParagraph, whatHappened } from "@/lib/research/policy";
import { providerLabel } from "@/lib/research/providers";
import type { ResearchStore } from "@/lib/research/store";
import type { AgentPreference, ResearchProject, ResearchScope, ResearchSession, TurnResult } from "@/lib/research/types";
import type { DeliveryResult, RecentMail } from "@/lib/research/turn-types";

type MailDeps = {
  now: Date;
  store: ResearchStore;
  deliverEmail: (input: { to: string; subject: string; body: string }) => Promise<DeliveryResult>;
  readRecentMail: () => Promise<{ messages: RecentMail[]; reconnect: boolean }>;
  prepareDraft: (input: { recipient: string; subject: string; body: string }) => Promise<
    { ok: true; draftId: string; spoken: string } | { ok: false; spoken: string; code?: string }
  >;
  reviseDraft: (input: { draftId: string; body: string }) => Promise<{ ok: true } | { ok: false; spoken: string }>;
  sendDraft: (input: { draftId: string; confirmed: boolean }) => Promise<
    { ok: true; providerMessageId: string; spoken: string } | { ok: false; spoken: string; code?: string }
  >;
  appOrigin: string;
  timeZone?: string;
};

export async function emailSessionToOwner(input: {
  scope: ResearchScope;
  session: ResearchSession;
  preference: AgentPreference;
  explicit: boolean;
  deps: MailDeps;
  base: Partial<TurnResult>;
}): Promise<TurnResult> {
  const fresh = await input.deps.store.getSession(input.scope, input.session.id);
  const session = fresh ?? input.session;
  const records = await input.deps.store.listRecords(input.scope, { sessionId: session.id, limit: 40 });
  const sources = await input.deps.store.listSources(input.scope, session.id);
  const projects = (await input.deps.store.ensureWorkspace(input.scope)).projects;
  const project = projects.find((item) => item.id === session.projectId);
  const oldestOwner = [...records].reverse().find((record) => record.speaker === "OWNER" && record.kind === "SPEECH_TRANSCRIPT");
  const body = sessionEmailBody({
    title: session.title,
    date: formatWhen(session.createdAt, input.deps.timeZone),
    question: oldestOwner?.text ?? session.title,
    summary: records.find((record) => record.kind === "SUMMARY")?.text || session.lastSpoken || "No summary stored.",
    sources,
    dictations: records.filter((record) => record.kind === "DICTATION").map((record) => record.correctedText ?? record.text),
    openQuestions: records.filter((record) => record.kind === "FOLLOW_UP").map((record) => record.text),
    nextActions: [],
    recordUrl: `${input.deps.appOrigin}/dashboard/agent?session=${session.id}`,
    provider: providerLabel(session.provider),
  });
  const subject = `Inbox Chief: ${session.title}`;
  const key = emailIdempotencyKey({ sessionId: input.session.id, to: input.scope.email, subject, body });
  const existing = await input.deps.store.findEmail(input.scope, key);
  const decision = decideEmailSend({
    existing: existing ? { status: existing.status, updatedAt: new Date(existing.updatedAt) } : null,
    now: input.deps.now,
    recipient: input.scope.email,
    ownerEmail: input.scope.email,
    explicitSelf: input.explicit,
    autoSelfAllowed: input.preference.emailSelfSummaries,
    confidential: project?.confidential ?? true,
    externalConfirmed: false,
  });
  if (decision.action === "hold") {
    const spoken = decision.reason === "needs_confirmation"
      ? "Say email this to me to send the record to your verified address. Nothing was sent."
      : whatHappened(decision.reason === "unknown_outcome" ? "email_unknown" : decision.reason).spoken;
    return blank({ ...input.base, persisted: true, sessionId: input.session.id, spoken, whatHappened: spoken });
  }
  if (decision.action === "reuse") {
    return blank({
      ...input.base,
      persisted: true,
      sessionId: input.session.id,
      spoken: "I already have an accepted send for this same record. I did not send a duplicate. Acceptance is not proof of inbox delivery.",
      email: existing ? { id: existing.id, status: existing.status, spoken: "Already accepted." } : null,
    });
  }
  const auth = authorizeTool({
    tool: "send_email",
    args: { self: true, userAuthorized: true, recipient: input.scope.email },
    ownerEmail: input.scope.email,
  });
  if (!auth.ok) return blank({ ...input.base, sessionId: input.session.id, spoken: "I did not send the email." });
  const email = existing ?? await input.deps.store.createEmail(input.scope, {
    sessionId: input.session.id,
    idempotencyKey: key,
    toAddress: input.scope.email,
    subject,
    bodyText: body,
    status: "QUEUED",
    isSelf: true,
    providerMessageId: null,
    errorCode: null,
  });
  const delivered = await input.deps.deliverEmail({ to: input.scope.email, subject, body });
  if (delivered.outcome === "provider_accepted") {
    const updated = await input.deps.store.updateEmail(input.scope, email.id, { status: "PROVIDER_ACCEPTED", providerMessageId: delivered.providerMessageId }, input.deps.now);
    return blank({
      ...input.base,
      persisted: true,
      sessionId: input.session.id,
      spoken: "I sent the research record to your verified address. The mail provider accepted it. That is not the same as proof it reached the inbox.",
      email: { id: email.id, status: updated?.status ?? "PROVIDER_ACCEPTED", spoken: "Provider accepted." },
    });
  }
  const status = delivered.outcome === "unknown" ? "UNKNOWN" : "FAILED";
  const code = delivered.code;
  await input.deps.store.updateEmail(input.scope, email.id, { status, errorCode: code }, input.deps.now);
  return blank({
    ...input.base,
    persisted: true,
    sessionId: input.session.id,
    spoken: whatHappened(code).spoken,
    whatHappened: whatHappened(code).spoken,
    email: { id: email.id, status, spoken: whatHappened(code).spoken },
  });
}

export async function readInbox(input: {
  scope: ResearchScope;
  session: ResearchSession | null;
  projects: ResearchProject[];
  deps: MailDeps;
  base: Partial<TurnResult>;
}): Promise<TurnResult> {
  const mail = await input.deps.readRecentMail();
  const first = mail.messages[0];
  if (!first) {
    const spoken = mail.reconnect
      ? `No new emails to read. ${whatHappened("gmail_reconnect").spoken}`
      : "No new emails to read. I do not have new stored primary messages.";
    return blank({ ...input.base, sessionId: input.session?.id ?? null, spoken, whatHappened: mail.reconnect ? whatHappened("gmail_reconnect").spoken : null });
  }
  const project = input.projects.find((item) => item.kind === "CORRESPONDENCE") ?? input.projects[0];
  const active = input.session ?? (project ? await input.deps.store.createSession(input.scope, { projectId: project.id, title: "Correspondence", provider: "none" }) : null);
  if (active) {
    await input.deps.store.updateSession(input.scope, active.id, {
      pending: { type: "mail_cursor", messageId: first.id, from: first.from, subject: first.subject },
    });
  }
  const reconnect = mail.reconnect ? ` ${whatHappened("gmail_reconnect").spoken}` : "";
  return blank({
    ...input.base,
    persisted: true,
    sessionId: active?.id ?? null,
    spoken: `Email 1 of ${mail.messages.length}. From ${first.from}. Subject ${first.subject}. ${first.snippet}.${reconnect} Say draft a reply when you want one. Nothing was sent.`,
    whatHappened: mail.reconnect ? whatHappened("gmail_reconnect").spoken : null,
  });
}

export async function draftReply(input: {
  scope: ResearchScope;
  session: ResearchSession | null;
  instruction: string;
  deps: MailDeps;
  base: Partial<TurnResult>;
}): Promise<TurnResult> {
  const cursor = input.session?.pending?.type === "mail_cursor" ? input.session.pending : null;
  if (!input.session || !cursor) {
    return blank({ ...input.base, sessionId: input.session?.id ?? null, spoken: "Read an email first, then say draft a reply. Nothing was sent." });
  }
  const body = `Thank you for your email about ${cursor.subject}. ${input.instruction}`.trim();
  const prepared = await input.deps.prepareDraft({ recipient: cursor.from, subject: `Re: ${cursor.subject}`, body });
  if (!prepared.ok) return blank({ ...input.base, persisted: true, sessionId: input.session.id, spoken: prepared.spoken });
  await input.deps.store.updateSession(input.scope, input.session.id, {
    pending: { type: "draft", draftId: prepared.draftId, recipient: cursor.from, subject: `Re: ${cursor.subject}`, body },
  });
  return blank({ ...input.base, persisted: true, sessionId: input.session.id, spoken: `${prepared.spoken} Nothing has been sent.` });
}

export function readBack(session: ResearchSession | null, base: Partial<TurnResult>): TurnResult {
  if (session?.pending?.type !== "draft") {
    return blank({ ...base, sessionId: session?.id ?? null, spoken: "There is no draft to read back. Nothing was sent." });
  }
  const draft = session.pending;
  return blank({
    ...base,
    sessionId: session.id,
    spoken: `Draft, not sent. To ${draft.recipient}. Subject ${draft.subject}. Message: ${draft.body}. Say send it to send this exact message, or change the second paragraph.`,
  });
}

export async function editDraft(input: {
  scope: ResearchScope;
  session: ResearchSession | null;
  instruction: string;
  deps: MailDeps;
  base: Partial<TurnResult>;
}): Promise<TurnResult> {
  if (!input.session || input.session.pending?.type !== "draft") {
    return blank({ ...input.base, sessionId: input.session?.id ?? null, spoken: "There is no draft to change. Nothing was sent." });
  }
  const body = replaceSecondParagraph(input.session.pending.body, input.instruction);
  const revised = await input.deps.reviseDraft({ draftId: input.session.pending.draftId, body });
  if (!revised.ok) return blank({ ...input.base, sessionId: input.session.id, spoken: revised.spoken });
  await input.deps.store.updateSession(input.scope, input.session.id, { pending: { ...input.session.pending, body } });
  return blank({ ...input.base, persisted: true, sessionId: input.session.id, spoken: `Updated the second paragraph. Nothing was sent. Message now: ${body}` });
}

export async function sendPendingDraft(input: {
  scope: ResearchScope;
  session: ResearchSession | null;
  deps: MailDeps;
  base: Partial<TurnResult>;
}): Promise<TurnResult> {
  if (!input.session || input.session.pending?.type !== "draft") {
    return blank({ ...input.base, sessionId: input.session?.id ?? null, spoken: "There is no draft waiting. Nothing was sent." });
  }
  const draft = input.session.pending;
  const auth = authorizeTool({
    tool: "send_email",
    args: { confirmed: true, recipient: draft.recipient, userAuthorized: true },
    ownerEmail: input.scope.email,
  });
  if (!auth.ok) return blank({ ...input.base, sessionId: input.session.id, spoken: "I did not send it." });
  const sent = await input.deps.sendDraft({ draftId: draft.draftId, confirmed: true });
  if (!sent.ok) {
    return blank({
      ...input.base,
      persisted: true,
      sessionId: input.session.id,
      spoken: sent.spoken,
      whatHappened: whatHappened(sent.code === "gmail_reconnect" ? "gmail_reconnect" : "provider_down").spoken,
    });
  }
  await input.deps.store.updateSession(input.scope, input.session.id, { pending: null });
  return blank({
    ...input.base,
    persisted: true,
    sessionId: input.session.id,
    spoken: `${sent.spoken} The mail provider accepted it. That does not by itself prove delivery.`,
  });
}

export async function prepareOutside(input: {
  scope: ResearchScope;
  session: ResearchSession | null;
  recipient: string | null;
  deps: MailDeps;
  base: Partial<TurnResult>;
}): Promise<TurnResult> {
  if (!input.session) return blank({ ...input.base, spoken: "Open a session before preparing outside correspondence. Nothing was sent." });
  if (!input.recipient) return blank({ ...input.base, persisted: true, sessionId: input.session.id, spoken: "Who should receive it? Say the email address. Nothing was sent." });
  const auth = authorizeTool({ tool: "prepare_email", args: { userAuthorized: true, recipient: input.recipient }, ownerEmail: input.scope.email });
  if (!auth.ok) return blank({ ...input.base, sessionId: input.session.id, spoken: "I did not prepare that email." });
  const body = input.session.lastSpoken || "Draft prepared from the current session.";
  const prepared = await input.deps.prepareDraft({ recipient: input.recipient, subject: input.session.title, body });
  if (!prepared.ok) return blank({ ...input.base, persisted: true, sessionId: input.session.id, spoken: prepared.spoken });
  await input.deps.store.updateSession(input.scope, input.session.id, {
    pending: { type: "draft", draftId: prepared.draftId, recipient: input.recipient, subject: input.session.title, body },
  });
  return blank({ ...input.base, persisted: true, sessionId: input.session.id, spoken: `${prepared.spoken} Nothing has been sent.` });
}

export function blank(partial: Partial<TurnResult>): TurnResult {
  return {
    ok: partial.ok ?? true,
    persisted: partial.persisted ?? false,
    sessionId: partial.sessionId ?? null,
    taskId: partial.taskId ?? null,
    taskStatus: partial.taskStatus ?? null,
    spoken: partial.spoken ?? "",
    detail: partial.detail ?? null,
    provider: partial.provider ?? null,
    sources: partial.sources ?? [],
    email: partial.email ?? null,
    whatHappened: partial.whatHappened ?? null,
    audioRetained: partial.audioRetained ?? false,
    audioNote: partial.audioNote ?? "Audio is not retained.",
    monthCents: partial.monthCents ?? 0,
    costLimitCents: partial.costLimitCents ?? 2000,
  };
}
