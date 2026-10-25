import { randomUUID } from "node:crypto";
import { DEFAULT_GLOSSARY } from "@/lib/research/glossary";
import { RESEARCH_LIMITS } from "@/lib/research/policy";
import type {
  AgentPreference,
  ExportBundle,
  GlossaryTerm,
  OutboundEmail,
  RecordFilter,
  ResearchProject,
  ResearchRecord,
  ResearchScope,
  ResearchSession,
  ResearchSource,
  ResearchTask,
  SessionPending,
  TaskCheckpoint,
} from "@/lib/research/types";

export const DEFAULT_PROJECTS: ResearchProject[] = [
  { id: "", name: "COARE Research", slug: "coare-research", kind: "COARE", confidential: true, allowedProviders: [] },
  { id: "", name: "Scientific Ideas", slug: "scientific-ideas", kind: "SCIENTIFIC_IDEAS", confidential: true, allowedProviders: [] },
  { id: "", name: "Correspondence", slug: "correspondence", kind: "CORRESPONDENCE", confidential: false, allowedProviders: [] },
  { id: "", name: "Personal", slug: "personal", kind: "PERSONAL", confidential: true, allowedProviders: [] },
];

export function matchProject(projects: ResearchProject[], hint: string | null): ResearchProject | null {
  if (!hint) return null;
  const key = hint.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!key) return null;
  return (
    projects.find((project) => {
      const name = project.name.toLowerCase();
      const slug = project.slug.replace(/-/g, " ");
      if (name === key || slug === key) return true;
      if (key.includes("coare") && project.kind === "COARE") return true;
      if (key.includes(name) || name.includes(key)) return true;
      return false;
    }) ?? null
  );
}

export function defaultPreference(): AgentPreference {
  return {
    defaultProvider: "none",
    listenMode: "CONVERSATION",
    speechRate: 1,
    endOfTurnMs: 2200,
    thinkingPauseMs: 180000,
    speakAloud: true,
    emailSelfSummaries: false,
    retainAudio: false,
    audioRetentionDays: 30,
    monthlyCostLimitCents: 2000,
  };
}

export type ResearchStore = {
  ensureWorkspace(scope: ResearchScope): Promise<{
    projects: ResearchProject[];
    glossary: GlossaryTerm[];
    preference: AgentPreference;
  }>;
  savePreference(scope: ResearchScope, patch: Partial<AgentPreference>): Promise<AgentPreference>;
  upsertGlossary(scope: ResearchScope, input: { term: string; spokenAs?: string | null; aliases?: string[] }): Promise<GlossaryTerm>;
  deleteGlossary(scope: ResearchScope, id: string): Promise<boolean>;
  createSession(scope: ResearchScope, input: { projectId: string; title: string; provider: ResearchSession["provider"] }): Promise<ResearchSession>;
  updateSession(scope: ResearchScope, id: string, patch: Partial<Pick<ResearchSession, "title" | "status" | "provider" | "pending" | "activeTaskId" | "lastSpoken">>): Promise<ResearchSession | null>;
  getSession(scope: ResearchScope, id: string): Promise<ResearchSession | null>;
  listSessions(scope: ResearchScope, limit?: number): Promise<ResearchSession[]>;
  findSessions(scope: ResearchScope, query: string, limit?: number): Promise<ResearchSession[]>;
  deleteSession(scope: ResearchScope, id: string): Promise<boolean>;
  appendRecord(scope: ResearchScope, input: Omit<ResearchRecord, "id" | "sequence" | "createdAt" | "corrections" | "correctedText"> & { correctedText?: string | null }): Promise<ResearchRecord>;
  correctRecord(scope: ResearchScope, id: string, correctedText: string, now: Date): Promise<ResearchRecord | null>;
  deleteRecord(scope: ResearchScope, id: string, now: Date): Promise<boolean>;
  listRecords(scope: ResearchScope, filter: RecordFilter): Promise<ResearchRecord[]>;
  saveSources(scope: ResearchScope, sessionId: string, sources: Array<Omit<ResearchSource, "id" | "sessionId">>): Promise<ResearchSource[]>;
  listSources(scope: ResearchScope, sessionId: string): Promise<ResearchSource[]>;
  createTask(scope: ResearchScope, input: { sessionId: string; kind: string; step: string; checkpoint: TaskCheckpoint }): Promise<ResearchTask>;
  updateTask(scope: ResearchScope, id: string, patch: Partial<ResearchTask>, now: Date): Promise<ResearchTask | null>;
  getTask(scope: ResearchScope, id: string): Promise<ResearchTask | null>;
  sumEstimatedCents(scope: ResearchScope, sinceIso: string): Promise<number>;
  findEmail(scope: ResearchScope, idempotencyKey: string): Promise<OutboundEmail | null>;
  createEmail(scope: ResearchScope, input: Omit<OutboundEmail, "id" | "updatedAt">): Promise<OutboundEmail>;
  updateEmail(scope: ResearchScope, id: string, patch: Partial<Pick<OutboundEmail, "status" | "providerMessageId" | "errorCode">>, now: Date): Promise<OutboundEmail | null>;
  saveAudio(scope: ResearchScope, input: { sessionId: string; bytes: Uint8Array; mimeType: string; now: Date }): Promise<{ ok: true; id: string } | { ok: false; code: "consent_required" | "too_large" }>;
  deleteExpiredAudio(scope: ResearchScope, now: Date): Promise<number>;
  exportBundle(scope: ResearchScope, projectId?: string): Promise<ExportBundle>;
  importBundle(scope: ResearchScope, bundle: ExportBundle, now: Date): Promise<{ sessions: number; records: number }>;
};

type Owned = { organizationId: string; workspaceId: string; ownerId: string };

function inScope(row: Owned, scope: ResearchScope): boolean {
  return row.organizationId === scope.organizationId && row.workspaceId === scope.workspaceId && row.ownerId === scope.userId;
}

export class MemoryResearchStore implements ResearchStore {
  projects: Array<ResearchProject & Owned> = [];
  glossary: Array<GlossaryTerm & Owned> = [];
  preferences: Array<AgentPreference & { userId: string; organizationId: string; workspaceId: string }> = [];
  sessions: Array<ResearchSession & Owned & { deletedAt: string | null }> = [];
  records: Array<ResearchRecord & Owned & { deletedAt: string | null }> = [];
  sources: Array<ResearchSource & Owned> = [];
  tasks: Array<ResearchTask & Owned> = [];
  emails: Array<OutboundEmail & Owned> = [];
  audio: Array<{ id: string; sessionId: string; retainUntil: string } & Owned> = [];
  failWrites = false;

  private guard(): void {
    if (this.failWrites) throw new Error("storage_failed");
  }

  async ensureWorkspace(scope: ResearchScope) {
    this.guard();
    let projects = this.projects.filter((project) => inScope(project, scope));
    if (projects.length === 0) {
      for (const seed of DEFAULT_PROJECTS) {
        this.projects.push({ ...seed, id: randomUUID(), organizationId: scope.organizationId, workspaceId: scope.workspaceId, ownerId: scope.userId });
      }
      projects = this.projects.filter((project) => inScope(project, scope));
    }
    let glossary = this.glossary.filter((term) => inScope(term, scope));
    if (glossary.length === 0) {
      for (const seed of DEFAULT_GLOSSARY) {
        this.glossary.push({ ...seed, id: randomUUID(), organizationId: scope.organizationId, workspaceId: scope.workspaceId, ownerId: scope.userId });
      }
      glossary = this.glossary.filter((term) => inScope(term, scope));
    }
    let preference = this.preferences.find((item) => item.userId === scope.userId);
    if (!preference) {
      preference = { ...defaultPreference(), userId: scope.userId, organizationId: scope.organizationId, workspaceId: scope.workspaceId };
      this.preferences.push(preference);
    }
    return {
      projects: projects.map(stripOwnedProject),
      glossary: glossary.map(stripGlossary),
      preference: stripPreference(preference),
    };
  }

  async savePreference(scope: ResearchScope, patch: Partial<AgentPreference>) {
    this.guard();
    await this.ensureWorkspace(scope);
    const preference = this.preferences.find((item) => item.userId === scope.userId);
    if (!preference) throw new Error("storage_failed");
    Object.assign(preference, patch);
    return stripPreference(preference);
  }

  async upsertGlossary(scope: ResearchScope, input: { term: string; spokenAs?: string | null; aliases?: string[] }) {
    this.guard();
    const existing = this.glossary.find((term) => inScope(term, scope) && term.term.toLowerCase() === input.term.toLowerCase());
    if (existing) {
      existing.spokenAs = input.spokenAs ?? existing.spokenAs;
      existing.aliases = input.aliases ?? existing.aliases;
      return stripGlossary(existing);
    }
    const created = { id: randomUUID(), term: input.term, spokenAs: input.spokenAs ?? null, aliases: input.aliases ?? [], organizationId: scope.organizationId, workspaceId: scope.workspaceId, ownerId: scope.userId };
    this.glossary.push(created);
    return stripGlossary(created);
  }

  async deleteGlossary(scope: ResearchScope, id: string) {
    const before = this.glossary.length;
    this.glossary = this.glossary.filter((term) => !(term.id === id && inScope(term, scope)));
    return this.glossary.length !== before;
  }

  async createSession(scope: ResearchScope, input: { projectId: string; title: string; provider: ResearchSession["provider"] }) {
    this.guard();
    const now = new Date().toISOString();
    const session: ResearchSession & Owned & { deletedAt: string | null } = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title,
      status: "ACTIVE",
      provider: input.provider,
      pending: null,
      activeTaskId: null,
      lastSpoken: null,
      createdAt: now,
      lastActiveAt: now,
      deletedAt: null,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ownerId: scope.userId,
    };
    this.sessions.push(session);
    return publicSession(session);
  }

  async updateSession(scope: ResearchScope, id: string, patch: Partial<Pick<ResearchSession, "title" | "status" | "provider" | "pending" | "activeTaskId" | "lastSpoken">>) {
    this.guard();
    const session = this.sessions.find((item) => item.id === id && inScope(item, scope) && !item.deletedAt);
    if (!session) return null;
    if (patch.title !== undefined) session.title = patch.title;
    if (patch.status !== undefined) session.status = patch.status;
    if (patch.provider !== undefined) session.provider = patch.provider;
    if (patch.pending !== undefined) session.pending = patch.pending;
    if (patch.activeTaskId !== undefined) session.activeTaskId = patch.activeTaskId;
    if (patch.lastSpoken !== undefined) session.lastSpoken = patch.lastSpoken;
    session.lastActiveAt = new Date().toISOString();
    return publicSession(session);
  }

  async getSession(scope: ResearchScope, id: string) {
    const session = this.sessions.find((item) => item.id === id && inScope(item, scope) && !item.deletedAt);
    return session ? publicSession(session) : null;
  }

  async listSessions(scope: ResearchScope, limit = 20) {
    return this.sessions
      .filter((item) => inScope(item, scope) && !item.deletedAt)
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
      .slice(0, limit)
      .map(publicSession);
  }

  async findSessions(scope: ResearchScope, query: string, limit = 5) {
    const needle = query.toLowerCase();
    const ids = new Set(
      this.records
        .filter((record) => inScope(record, scope) && !record.deletedAt && `${record.text} ${record.correctedText ?? ""}`.toLowerCase().includes(needle))
        .map((record) => record.sessionId),
    );
    return this.sessions
      .filter((session) => inScope(session, scope) && !session.deletedAt && (session.title.toLowerCase().includes(needle) || ids.has(session.id)))
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
      .slice(0, limit)
      .map(publicSession);
  }

  async deleteSession(scope: ResearchScope, id: string) {
    const session = this.sessions.find((item) => item.id === id && inScope(item, scope) && !item.deletedAt);
    if (!session) return false;
    const now = new Date().toISOString();
    session.deletedAt = now;
    for (const record of this.records) {
      if (record.sessionId === id && inScope(record, scope)) record.deletedAt = now;
    }
    return true;
  }

  async appendRecord(scope: ResearchScope, input: Omit<ResearchRecord, "id" | "sequence" | "createdAt" | "corrections" | "correctedText"> & { correctedText?: string | null }) {
    this.guard();
    const sequence = this.records.filter((record) => record.sessionId === input.sessionId).reduce((max, record) => Math.max(max, record.sequence), 0) + 1;
    const record: ResearchRecord & Owned & { deletedAt: string | null } = {
      ...input,
      correctedText: input.correctedText ?? null,
      id: randomUUID(),
      sequence,
      createdAt: new Date().toISOString(),
      corrections: [],
      deletedAt: null,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ownerId: scope.userId,
    };
    this.records.push(record);
    return publicRecord(record);
  }

  async correctRecord(scope: ResearchScope, id: string, correctedText: string, now: Date) {
    this.guard();
    const record = this.records.find((item) => item.id === id && inScope(item, scope) && !item.deletedAt);
    if (!record) return null;
    const previous = record.correctedText ?? record.text;
    record.corrections.push({ previousText: previous, correctedText, createdAt: now.toISOString() });
    record.correctedText = correctedText;
    return publicRecord(record);
  }

  async deleteRecord(scope: ResearchScope, id: string, now: Date) {
    const record = this.records.find((item) => item.id === id && inScope(item, scope) && !item.deletedAt);
    if (!record) return false;
    record.deletedAt = now.toISOString();
    return true;
  }

  async listRecords(scope: ResearchScope, filter: RecordFilter) {
    return this.records
      .filter((record) => {
        if (!inScope(record, scope) || record.deletedAt) return false;
        if (filter.sessionId && record.sessionId !== filter.sessionId) return false;
        if (filter.projectId && record.projectId !== filter.projectId) return false;
        if (filter.speaker && record.speaker !== filter.speaker) return false;
        if (filter.kinds && !filter.kinds.includes(record.kind)) return false;
        if (filter.from && record.createdAt < filter.from) return false;
        if (filter.to && record.createdAt >= filter.to) return false;
        if (filter.query) {
          const hay = `${record.text} ${record.correctedText ?? ""}`.toLowerCase();
          if (!hay.includes(filter.query.toLowerCase())) return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, filter.limit ?? 20)
      .map(publicRecord);
  }

  async saveSources(scope: ResearchScope, sessionId: string, sources: Array<Omit<ResearchSource, "id" | "sessionId">>) {
    this.guard();
    const saved = sources.map((source) => {
      const row: ResearchSource & Owned = { ...source, id: randomUUID(), sessionId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, ownerId: scope.userId };
      this.sources.push(row);
      return row;
    });
    return saved.map(stripSource);
  }

  async listSources(scope: ResearchScope, sessionId: string) {
    return this.sources.filter((source) => source.sessionId === sessionId && inScope(source, scope)).map(stripSource);
  }

  async createTask(scope: ResearchScope, input: { sessionId: string; kind: string; step: string; checkpoint: TaskCheckpoint }) {
    this.guard();
    const now = new Date().toISOString();
    const task: ResearchTask & Owned = {
      id: randomUUID(),
      sessionId: input.sessionId,
      status: "RUNNING",
      kind: input.kind,
      step: input.step,
      checkpoint: input.checkpoint,
      errorCode: null,
      attempt: 1,
      toolCalls: 0,
      estimatedCents: 0,
      heartbeatAt: now,
      startedAt: now,
      finishedAt: null,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ownerId: scope.userId,
    };
    this.tasks.push(task);
    return { ...task };
  }

  async updateTask(scope: ResearchScope, id: string, patch: Partial<ResearchTask>, now: Date) {
    this.guard();
    const task = this.tasks.find((item) => item.id === id && inScope(item, scope));
    if (!task) return null;
    Object.assign(task, patch, { heartbeatAt: now.toISOString() });
    return { ...task, checkpoint: { ...task.checkpoint } };
  }

  async getTask(scope: ResearchScope, id: string) {
    const task = this.tasks.find((item) => item.id === id && inScope(item, scope));
    return task ? { ...task, checkpoint: { ...task.checkpoint } } : null;
  }

  async sumEstimatedCents(scope: ResearchScope, sinceIso: string) {
    return this.tasks.filter((task) => inScope(task, scope) && task.startedAt >= sinceIso).reduce((sum, task) => sum + task.estimatedCents, 0);
  }

  async findEmail(scope: ResearchScope, idempotencyKey: string) {
    const email = this.emails.find((item) => item.idempotencyKey === idempotencyKey && inScope(item, scope));
    return email ? { ...email } : null;
  }

  async createEmail(scope: ResearchScope, input: Omit<OutboundEmail, "id" | "updatedAt">) {
    this.guard();
    const existing = this.emails.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (existing) {
      if (!inScope(existing, scope)) throw new Error("storage_failed");
      return { ...existing };
    }
    const email: OutboundEmail & Owned = { ...input, id: randomUUID(), updatedAt: new Date().toISOString(), organizationId: scope.organizationId, workspaceId: scope.workspaceId, ownerId: scope.userId };
    this.emails.push(email);
    return { ...email };
  }

  async updateEmail(scope: ResearchScope, id: string, patch: Partial<Pick<OutboundEmail, "status" | "providerMessageId" | "errorCode">>, now: Date) {
    this.guard();
    const email = this.emails.find((item) => item.id === id && inScope(item, scope));
    if (!email) return null;
    Object.assign(email, patch, { updatedAt: now.toISOString() });
    return { ...email };
  }

  async saveAudio(scope: ResearchScope, input: { sessionId: string; bytes: Uint8Array; mimeType: string; now: Date }) {
    const preference = this.preferences.find((item) => item.userId === scope.userId);
    if (!preference?.retainAudio) return { ok: false as const, code: "consent_required" as const };
    if (input.bytes.byteLength > RESEARCH_LIMITS.maxAudioBytes) return { ok: false as const, code: "too_large" as const };
    const retainUntil = new Date(input.now.getTime() + preference.audioRetentionDays * 86_400_000).toISOString();
    const id = randomUUID();
    this.audio.push({ id, sessionId: input.sessionId, retainUntil, organizationId: scope.organizationId, workspaceId: scope.workspaceId, ownerId: scope.userId });
    return { ok: true as const, id };
  }

  async deleteExpiredAudio(scope: ResearchScope, now: Date) {
    const before = this.audio.length;
    this.audio = this.audio.filter((clip) => !(inScope(clip, scope) && clip.retainUntil < now.toISOString()));
    return before - this.audio.length;
  }

  async exportBundle(scope: ResearchScope, projectId?: string): Promise<ExportBundle> {
    const sessions = this.sessions.filter((session) => inScope(session, scope) && !session.deletedAt && (!projectId || session.projectId === projectId));
    const sessionIds = new Set(sessions.map((session) => session.id));
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: this.projects.filter((project) => inScope(project, scope) && (!projectId || project.id === projectId)).map(stripOwnedProject),
      sessions: sessions.map(publicSession),
      records: this.records.filter((record) => inScope(record, scope) && !record.deletedAt && sessionIds.has(record.sessionId)).map(publicRecord),
      sources: this.sources.filter((source) => inScope(source, scope) && sessionIds.has(source.sessionId)).map(stripSource),
      glossary: this.glossary.filter((term) => inScope(term, scope)).map(stripGlossary),
    };
  }

  async importBundle(scope: ResearchScope, bundle: ExportBundle, now: Date) {
    this.guard();
    const projectMap = new Map<string, string>();
    for (const project of bundle.projects) {
      const created = { ...project, id: randomUUID(), organizationId: scope.organizationId, workspaceId: scope.workspaceId, ownerId: scope.userId };
      this.projects.push(created);
      projectMap.set(project.id, created.id);
    }
    const sessionMap = new Map<string, string>();
    for (const session of bundle.sessions) {
      const projectId = projectMap.get(session.projectId);
      if (!projectId) continue;
      const created: ResearchSession & Owned & { deletedAt: string | null } = {
        ...session,
        id: randomUUID(),
        projectId,
        pending: null,
        activeTaskId: null,
        createdAt: now.toISOString(),
        lastActiveAt: now.toISOString(),
        deletedAt: null,
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: scope.userId,
      };
      this.sessions.push(created);
      sessionMap.set(session.id, created.id);
    }
    let records = 0;
    for (const record of bundle.records) {
      const sessionId = sessionMap.get(record.sessionId);
      const projectId = projectMap.get(record.projectId);
      if (!sessionId || !projectId) continue;
      this.records.push({
        ...record,
        id: randomUUID(),
        sessionId,
        projectId,
        deletedAt: null,
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: scope.userId,
      });
      records += 1;
    }
    return { sessions: sessionMap.size, records };
  }
}

function stripOwnedProject(project: ResearchProject & Owned): ResearchProject {
  return { id: project.id, name: project.name, slug: project.slug, kind: project.kind, confidential: project.confidential, allowedProviders: project.allowedProviders };
}

function stripGlossary(term: GlossaryTerm & Owned): GlossaryTerm {
  return { id: term.id, term: term.term, spokenAs: term.spokenAs, aliases: term.aliases };
}

function stripPreference(preference: AgentPreference): AgentPreference {
  return {
    defaultProvider: preference.defaultProvider,
    listenMode: preference.listenMode,
    speechRate: preference.speechRate,
    endOfTurnMs: preference.endOfTurnMs,
    thinkingPauseMs: preference.thinkingPauseMs,
    speakAloud: preference.speakAloud,
    emailSelfSummaries: preference.emailSelfSummaries,
    retainAudio: preference.retainAudio,
    audioRetentionDays: preference.audioRetentionDays,
    monthlyCostLimitCents: preference.monthlyCostLimitCents,
  };
}

function publicSession(session: ResearchSession): ResearchSession {
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    status: session.status,
    provider: session.provider,
    pending: session.pending,
    activeTaskId: session.activeTaskId,
    lastSpoken: session.lastSpoken,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
  };
}

function publicRecord(record: ResearchRecord): ResearchRecord {
  return {
    id: record.id,
    sessionId: record.sessionId,
    projectId: record.projectId,
    kind: record.kind,
    speaker: record.speaker,
    text: record.text,
    correctedText: record.correctedText,
    provider: record.provider,
    model: record.model,
    sequence: record.sequence,
    createdAt: record.createdAt,
    corrections: record.corrections.map((item) => ({ ...item })),
  };
}

function stripSource(source: ResearchSource): ResearchSource {
  return { ...source };
}

export type { SessionPending };
