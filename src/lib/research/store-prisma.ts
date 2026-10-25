import { Prisma } from "@/generated/prisma/client";
import { getNodePrisma } from "@/lib/db-node";
import { DEFAULT_GLOSSARY } from "@/lib/research/glossary";
import { RESEARCH_LIMITS } from "@/lib/research/policy";
import { DEFAULT_PROJECTS, defaultPreference, type ResearchStore } from "@/lib/research/store";
import type {
  AgentPreference,
  ExportBundle,
  GlossaryTerm,
  OutboundEmail,
  ProviderId,
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

type DbProvider = "OPENAI" | "ANTHROPIC" | "XAI" | "NONE";

function db() {
  return getNodePrisma();
}

function toDbProvider(value: ProviderId | "none" | null | undefined): DbProvider | null {
  if (!value || value === "none") return value === undefined ? null : "NONE";
  if (value === "openai") return "OPENAI";
  if (value === "anthropic") return "ANTHROPIC";
  return "XAI";
}

function fromDbProvider(value: DbProvider | null | undefined): ProviderId | "none" | null {
  if (!value) return null;
  if (value === "NONE") return "none";
  if (value === "OPENAI") return "openai";
  if (value === "ANTHROPIC") return "anthropic";
  return "xai";
}

function scopeWhere(scope: ResearchScope) {
  return { organizationId: scope.organizationId, workspaceId: scope.workspaceId, ownerId: scope.userId };
}

function asPending(value: unknown): SessionPending | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { type?: string };
  if (!record.type) return null;
  return value as SessionPending;
}

function asCheckpoint(value: unknown): TaskCheckpoint {
  const record = (value ?? {}) as Partial<TaskCheckpoint>;
  return {
    question: record.question ?? "",
    projectId: record.projectId ?? "",
    emailSelf: Boolean(record.emailSelf),
    provider: record.provider ?? "none",
    searchDone: Boolean(record.searchDone),
    explainDone: Boolean(record.explainDone),
    emailStatus: record.emailStatus ?? "skipped",
    generalKnowledge: Boolean(record.generalKnowledge),
  };
}

export class PrismaResearchStore implements ResearchStore {
  async ensureWorkspace(scope: ResearchScope) {
    const prisma = db();
    const where = scopeWhere(scope);
    let projects = await prisma.researchProject.findMany({ where, orderBy: { createdAt: "asc" } });
    if (projects.length === 0) {
      await prisma.researchProject.createMany({
        data: DEFAULT_PROJECTS.map((project) => ({
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          ownerId: scope.userId,
          name: project.name,
          slug: project.slug,
          kind: project.kind,
          confidential: project.confidential,
          allowedProviders: [],
        })),
      });
      projects = await prisma.researchProject.findMany({ where, orderBy: { createdAt: "asc" } });
    }
    let glossary = await prisma.researchGlossaryTerm.findMany({ where });
    if (glossary.length === 0) {
      await prisma.researchGlossaryTerm.createMany({
        data: DEFAULT_GLOSSARY.map((term) => ({
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          ownerId: scope.userId,
          term: term.term,
          spokenAs: term.spokenAs,
          aliases: term.aliases,
        })),
      });
      glossary = await prisma.researchGlossaryTerm.findMany({ where });
    }
    let preference = await prisma.researchAgentPreference.findUnique({ where: { userId: scope.userId } });
    if (!preference) {
      const seed = defaultPreference();
      preference = await prisma.researchAgentPreference.create({
        data: {
          userId: scope.userId,
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          defaultProvider: "NONE",
          listenMode: seed.listenMode,
          speechRate: seed.speechRate,
          endOfTurnMs: seed.endOfTurnMs,
          thinkingPauseMs: seed.thinkingPauseMs,
          speakAloud: seed.speakAloud,
          emailSelfSummaries: seed.emailSelfSummaries,
          retainAudio: seed.retainAudio,
          audioRetentionDays: seed.audioRetentionDays,
          monthlyCostLimitCents: seed.monthlyCostLimitCents,
        },
      });
    }
    return {
      projects: projects.map(mapProject),
      glossary: glossary.map(mapGlossary),
      preference: mapPreference(preference),
    };
  }

  async savePreference(scope: ResearchScope, patch: Partial<AgentPreference>) {
    const prisma = db();
    const saved = await prisma.researchAgentPreference.update({
      where: { userId: scope.userId },
      data: {
        ...(patch.defaultProvider ? { defaultProvider: toDbProvider(patch.defaultProvider) ?? "NONE" } : {}),
        ...(patch.listenMode ? { listenMode: patch.listenMode } : {}),
        ...(patch.speechRate !== undefined ? { speechRate: patch.speechRate } : {}),
        ...(patch.endOfTurnMs !== undefined ? { endOfTurnMs: patch.endOfTurnMs } : {}),
        ...(patch.thinkingPauseMs !== undefined ? { thinkingPauseMs: patch.thinkingPauseMs } : {}),
        ...(patch.speakAloud !== undefined ? { speakAloud: patch.speakAloud } : {}),
        ...(patch.emailSelfSummaries !== undefined ? { emailSelfSummaries: patch.emailSelfSummaries } : {}),
        ...(patch.retainAudio !== undefined ? { retainAudio: patch.retainAudio } : {}),
        ...(patch.audioRetentionDays !== undefined ? { audioRetentionDays: patch.audioRetentionDays } : {}),
        ...(patch.monthlyCostLimitCents !== undefined ? { monthlyCostLimitCents: patch.monthlyCostLimitCents } : {}),
      },
    });
    return mapPreference(saved);
  }

  async upsertGlossary(scope: ResearchScope, input: { term: string; spokenAs?: string | null; aliases?: string[] }) {
    const prisma = db();
    const saved = await prisma.researchGlossaryTerm.upsert({
      where: { workspaceId_ownerId_term: { workspaceId: scope.workspaceId, ownerId: scope.userId, term: input.term } },
      create: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: scope.userId,
        term: input.term,
        spokenAs: input.spokenAs ?? null,
        aliases: input.aliases ?? [],
      },
      update: {
        spokenAs: input.spokenAs ?? undefined,
        aliases: input.aliases ?? undefined,
      },
    });
    return mapGlossary(saved);
  }

  async deleteGlossary(scope: ResearchScope, id: string) {
    const prisma = db();
    const result = await prisma.researchGlossaryTerm.deleteMany({ where: { id, ...scopeWhere(scope) } });
    return result.count === 1;
  }

  async createSession(scope: ResearchScope, input: { projectId: string; title: string; provider: ResearchSession["provider"] }) {
    const prisma = db();
    const owned = await prisma.researchProject.findFirst({ where: { id: input.projectId, ...scopeWhere(scope) } });
    if (!owned) throw new Error("storage_failed");
    const session = await prisma.researchSession.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: scope.userId,
        projectId: input.projectId,
        title: input.title,
        provider: toDbProvider(input.provider) ?? "NONE",
      },
    });
    return mapSession(session);
  }

  async updateSession(scope: ResearchScope, id: string, patch: Partial<Pick<ResearchSession, "title" | "status" | "provider" | "pending" | "activeTaskId" | "lastSpoken">>) {
    const prisma = db();
    const existing = await prisma.researchSession.findFirst({ where: { id, ...scopeWhere(scope), deletedAt: null } });
    if (!existing) return null;
    const session = await prisma.researchSession.update({
      where: { id: existing.id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.provider !== undefined ? { provider: toDbProvider(patch.provider) ?? "NONE" } : {}),
        ...(patch.pending !== undefined ? { pendingJson: patch.pending === null ? Prisma.DbNull : (patch.pending as Prisma.InputJsonValue) } : {}),
        ...(patch.activeTaskId !== undefined ? { activeTaskId: patch.activeTaskId } : {}),
        ...(patch.lastSpoken !== undefined ? { lastSpoken: patch.lastSpoken } : {}),
        lastActiveAt: new Date(),
      },
    });
    return mapSession(session);
  }

  async getSession(scope: ResearchScope, id: string) {
    const session = await db().researchSession.findFirst({ where: { id, ...scopeWhere(scope), deletedAt: null } });
    return session ? mapSession(session) : null;
  }

  async listSessions(scope: ResearchScope, limit = 20) {
    const sessions = await db().researchSession.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      orderBy: { lastActiveAt: "desc" },
      take: limit,
    });
    return sessions.map(mapSession);
  }

  async findSessions(scope: ResearchScope, query: string, limit = 5) {
    const sessions = await db().researchSession.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { records: { some: { deletedAt: null, text: { contains: query, mode: "insensitive" } } } },
        ],
      },
      orderBy: { lastActiveAt: "desc" },
      take: limit,
    });
    return sessions.map(mapSession);
  }

  async deleteSession(scope: ResearchScope, id: string) {
    const prisma = db();
    const now = new Date();
    const result = await prisma.researchSession.updateMany({ where: { id, ...scopeWhere(scope), deletedAt: null }, data: { deletedAt: now } });
    await prisma.researchRecord.updateMany({ where: { sessionId: id, ...scopeWhere(scope), deletedAt: null }, data: { deletedAt: now } });
    return result.count === 1;
  }

  async appendRecord(scope: ResearchScope, input: Omit<ResearchRecord, "id" | "sequence" | "createdAt" | "corrections" | "correctedText"> & { correctedText?: string | null }) {
    const prisma = db();
    const session = await prisma.researchSession.findFirst({ where: { id: input.sessionId, ...scopeWhere(scope), deletedAt: null } });
    if (!session) throw new Error("storage_failed");
    const last = await prisma.researchRecord.aggregate({ where: { sessionId: input.sessionId }, _max: { sequence: true } });
    const record = await prisma.researchRecord.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: scope.userId,
        sessionId: input.sessionId,
        projectId: input.projectId,
        kind: input.kind as "SPEECH_TRANSCRIPT",
        speaker: input.speaker,
        text: input.text,
        correctedText: input.correctedText ?? null,
        provider: input.provider ? toDbProvider(input.provider) : null,
        model: input.model,
        sequence: (last._max.sequence ?? 0) + 1,
      },
      include: { corrections: true },
    });
    return mapRecord(record);
  }

  async correctRecord(scope: ResearchScope, id: string, correctedText: string, now: Date) {
    const prisma = db();
    const record = await prisma.researchRecord.findFirst({ where: { id, ...scopeWhere(scope), deletedAt: null } });
    if (!record) return null;
    await prisma.researchCorrection.create({
      data: {
        recordId: record.id,
        organizationId: scope.organizationId,
        previousText: record.correctedText ?? record.text,
        correctedText,
        createdAt: now,
      },
    });
    const updated = await prisma.researchRecord.update({
      where: { id: record.id },
      data: { correctedText },
      include: { corrections: { orderBy: { createdAt: "asc" } } },
    });
    return mapRecord(updated);
  }

  async deleteRecord(scope: ResearchScope, id: string, now: Date) {
    const result = await db().researchRecord.updateMany({ where: { id, ...scopeWhere(scope), deletedAt: null }, data: { deletedAt: now } });
    return result.count === 1;
  }

  async listRecords(scope: ResearchScope, filter: RecordFilter) {
    const records = await db().researchRecord.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
        ...(filter.speaker ? { speaker: filter.speaker } : {}),
        ...(filter.kinds ? { kind: { in: filter.kinds as ["SPEECH_TRANSCRIPT"] } } : {}),
        ...(filter.from || filter.to
          ? { createdAt: { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lt: new Date(filter.to) } : {}) } }
          : {}),
        ...(filter.query
          ? {
              OR: [
                { text: { contains: filter.query, mode: "insensitive" } },
                { correctedText: { contains: filter.query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { corrections: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: filter.limit ?? 20,
    });
    return records.map(mapRecord);
  }

  async saveSources(scope: ResearchScope, sessionId: string, sources: Array<Omit<ResearchSource, "id" | "sessionId">>) {
    const prisma = db();
    const session = await prisma.researchSession.findFirst({ where: { id: sessionId, ...scopeWhere(scope) } });
    if (!session) throw new Error("storage_failed");
    const saved = [];
    for (const source of sources) {
      saved.push(await prisma.researchSource.create({
        data: {
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          ownerId: scope.userId,
          sessionId,
          title: source.title,
          authors: source.authors,
          published: source.published,
          url: source.url,
          doi: source.doi,
          pmid: source.pmid,
          pmcid: source.pmcid,
          retrievedAt: new Date(source.retrievedAt),
          accessLevel: source.accessLevel,
          excerpt: source.excerpt,
        },
      }));
    }
    return saved.map(mapSource);
  }

  async listSources(scope: ResearchScope, sessionId: string) {
    const sources = await db().researchSource.findMany({ where: { sessionId, ...scopeWhere(scope) }, orderBy: { createdAt: "asc" } });
    return sources.map(mapSource);
  }

  async createTask(scope: ResearchScope, input: { sessionId: string; kind: string; step: string; checkpoint: TaskCheckpoint }) {
    const task = await db().researchTask.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: scope.userId,
        sessionId: input.sessionId,
        kind: input.kind,
        step: input.step,
        status: "RUNNING",
        checkpoint: input.checkpoint as Prisma.InputJsonValue,
      },
    });
    return mapTask(task);
  }

  async updateTask(scope: ResearchScope, id: string, patch: Partial<ResearchTask>, now: Date) {
    const existing = await db().researchTask.findFirst({ where: { id, ...scopeWhere(scope) } });
    if (!existing) return null;
    const task = await db().researchTask.update({
      where: { id: existing.id },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.step ? { step: patch.step } : {}),
        ...(patch.checkpoint ? { checkpoint: patch.checkpoint as Prisma.InputJsonValue } : {}),
        ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
        ...(patch.attempt !== undefined ? { attempt: patch.attempt } : {}),
        ...(patch.toolCalls !== undefined ? { toolCalls: patch.toolCalls } : {}),
        ...(patch.estimatedCents !== undefined ? { estimatedCents: patch.estimatedCents } : {}),
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt ? new Date(patch.finishedAt) : null } : {}),
        heartbeatAt: now,
      },
    });
    return mapTask(task);
  }

  async getTask(scope: ResearchScope, id: string) {
    const task = await db().researchTask.findFirst({ where: { id, ...scopeWhere(scope) } });
    return task ? mapTask(task) : null;
  }

  async sumEstimatedCents(scope: ResearchScope, sinceIso: string) {
    const sum = await db().researchTask.aggregate({
      where: { ...scopeWhere(scope), startedAt: { gte: new Date(sinceIso) } },
      _sum: { estimatedCents: true },
    });
    return sum._sum.estimatedCents ?? 0;
  }

  async findEmail(scope: ResearchScope, idempotencyKey: string) {
    const email = await db().researchOutboundEmail.findFirst({ where: { idempotencyKey, ...scopeWhere(scope) } });
    return email ? mapEmail(email) : null;
  }

  async createEmail(scope: ResearchScope, input: Omit<OutboundEmail, "id" | "updatedAt">) {
    const prisma = db();
    try {
      const email = await prisma.researchOutboundEmail.create({
        data: {
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          ownerId: scope.userId,
          sessionId: input.sessionId,
          idempotencyKey: input.idempotencyKey,
          toAddress: input.toAddress,
          subject: input.subject,
          bodyText: input.bodyText,
          status: input.status,
          isSelf: input.isSelf,
          providerMessageId: input.providerMessageId,
          errorCode: input.errorCode,
        },
      });
      return mapEmail(email);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.researchOutboundEmail.findFirst({ where: { idempotencyKey: input.idempotencyKey, ...scopeWhere(scope) } });
        if (existing) return mapEmail(existing);
      }
      throw error;
    }
  }

  async updateEmail(scope: ResearchScope, id: string, patch: Partial<Pick<OutboundEmail, "status" | "providerMessageId" | "errorCode">>, now: Date) {
    const existing = await db().researchOutboundEmail.findFirst({ where: { id, ...scopeWhere(scope) } });
    if (!existing) return null;
    const email = await db().researchOutboundEmail.update({
      where: { id: existing.id },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.providerMessageId !== undefined ? { providerMessageId: patch.providerMessageId } : {}),
        ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
        updatedAt: now,
      },
    });
    return mapEmail(email);
  }

  async saveAudio(scope: ResearchScope, input: { sessionId: string; bytes: Uint8Array; mimeType: string; now: Date }) {
    const preference = await db().researchAgentPreference.findUnique({ where: { userId: scope.userId } });
    if (!preference?.retainAudio) return { ok: false as const, code: "consent_required" as const };
    if (input.bytes.byteLength > RESEARCH_LIMITS.maxAudioBytes) return { ok: false as const, code: "too_large" as const };
    const session = await db().researchSession.findFirst({ where: { id: input.sessionId, ...scopeWhere(scope) } });
    if (!session) return { ok: false as const, code: "consent_required" as const };
    const clip = await db().researchAudioClip.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: scope.userId,
        sessionId: input.sessionId,
        mimeType: input.mimeType,
        byteSize: input.bytes.byteLength,
        audioBytes: Buffer.from(input.bytes),
        consentGrantedAt: input.now,
        retainUntil: new Date(input.now.getTime() + preference.audioRetentionDays * 86_400_000),
      },
    });
    return { ok: true as const, id: clip.id };
  }

  async deleteExpiredAudio(scope: ResearchScope, now: Date) {
    const result = await db().researchAudioClip.deleteMany({
      where: { organizationId: scope.organizationId, ownerId: scope.userId, retainUntil: { lt: now } },
    });
    return result.count;
  }

  async exportBundle(scope: ResearchScope, projectId?: string): Promise<ExportBundle> {
    const ensured = await this.ensureWorkspace(scope);
    const sessions = await this.listSessions(scope, 200);
    const filtered = projectId ? sessions.filter((session) => session.projectId === projectId) : sessions;
    const records: ResearchRecord[] = [];
    const sources: ResearchSource[] = [];
    for (const session of filtered) {
      records.push(...(await this.listRecords(scope, { sessionId: session.id, limit: 500 })));
      sources.push(...(await this.listSources(scope, session.id)));
    }
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: projectId ? ensured.projects.filter((project) => project.id === projectId) : ensured.projects,
      sessions: filtered,
      records,
      sources,
      glossary: ensured.glossary,
    };
  }

  async importBundle(scope: ResearchScope, bundle: ExportBundle, now: Date) {
    const projectMap = new Map<string, string>();
    let sessions = 0;
    let records = 0;
    for (const project of bundle.projects) {
      const created = await db().researchProject.create({
        data: {
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          ownerId: scope.userId,
          name: `${project.name} import`,
          slug: `${project.slug}-import-${now.getTime()}`,
          kind: project.kind,
          confidential: project.confidential,
          allowedProviders: project.allowedProviders.map((provider) => toDbProvider(provider) ?? "NONE").filter((provider) => provider !== "NONE"),
        },
      });
      projectMap.set(project.id, created.id);
    }
    const sessionMap = new Map<string, string>();
    for (const session of bundle.sessions) {
      const projectId = projectMap.get(session.projectId);
      if (!projectId) continue;
      const created = await this.createSession(scope, { projectId, title: session.title, provider: session.provider });
      sessionMap.set(session.id, created.id);
      sessions += 1;
      if (session.lastSpoken) await this.updateSession(scope, created.id, { lastSpoken: session.lastSpoken });
    }
    for (const record of bundle.records) {
      const sessionId = sessionMap.get(record.sessionId);
      const projectId = projectMap.get(record.projectId);
      if (!sessionId || !projectId) continue;
      await this.appendRecord(scope, {
        sessionId,
        projectId,
        kind: record.kind,
        speaker: record.speaker,
        text: record.text,
        correctedText: record.correctedText,
        provider: record.provider,
        model: record.model,
      });
      records += 1;
    }
    return { sessions, records };
  }
}

function mapProject(project: { id: string; name: string; slug: string; kind: ResearchProject["kind"]; confidential: boolean; allowedProviders: DbProvider[] }): ResearchProject {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    kind: project.kind,
    confidential: project.confidential,
    allowedProviders: project.allowedProviders.map((provider) => fromDbProvider(provider)).filter((provider): provider is ProviderId => provider !== null && provider !== "none"),
  };
}

function mapGlossary(term: { id: string; term: string; spokenAs: string | null; aliases: string[] }): GlossaryTerm {
  return { id: term.id, term: term.term, spokenAs: term.spokenAs, aliases: term.aliases };
}

function mapPreference(preference: {
  defaultProvider: DbProvider;
  listenMode: AgentPreference["listenMode"];
  speechRate: number;
  endOfTurnMs: number;
  thinkingPauseMs: number;
  speakAloud: boolean;
  emailSelfSummaries: boolean;
  retainAudio: boolean;
  audioRetentionDays: number;
  monthlyCostLimitCents: number;
}): AgentPreference {
  return {
    defaultProvider: fromDbProvider(preference.defaultProvider) ?? "none",
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

function mapSession(session: {
  id: string;
  projectId: string;
  title: string;
  status: ResearchSession["status"];
  provider: DbProvider;
  pendingJson: unknown;
  activeTaskId: string | null;
  lastSpoken: string | null;
  createdAt: Date;
  lastActiveAt: Date;
}): ResearchSession {
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    status: session.status,
    provider: fromDbProvider(session.provider) ?? "none",
    pending: asPending(session.pendingJson),
    activeTaskId: session.activeTaskId,
    lastSpoken: session.lastSpoken,
    createdAt: session.createdAt.toISOString(),
    lastActiveAt: session.lastActiveAt.toISOString(),
  };
}

function mapRecord(record: {
  id: string;
  sessionId: string;
  projectId: string;
  kind: string;
  speaker: ResearchRecord["speaker"];
  text: string;
  correctedText: string | null;
  provider: DbProvider | null;
  model: string | null;
  sequence: number;
  createdAt: Date;
  corrections: Array<{ previousText: string; correctedText: string; createdAt: Date }>;
}): ResearchRecord {
  return {
    id: record.id,
    sessionId: record.sessionId,
    projectId: record.projectId,
    kind: record.kind,
    speaker: record.speaker,
    text: record.text,
    correctedText: record.correctedText,
    provider: fromDbProvider(record.provider),
    model: record.model,
    sequence: record.sequence,
    createdAt: record.createdAt.toISOString(),
    corrections: record.corrections.map((item) => ({
      previousText: item.previousText,
      correctedText: item.correctedText,
      createdAt: item.createdAt.toISOString(),
    })),
  };
}

function mapSource(source: {
  id: string;
  sessionId: string;
  title: string;
  authors: string;
  published: string | null;
  url: string;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  retrievedAt: Date;
  accessLevel: ResearchSource["accessLevel"];
  excerpt: string;
}): ResearchSource {
  return {
    id: source.id,
    sessionId: source.sessionId,
    title: source.title,
    authors: source.authors,
    published: source.published,
    url: source.url,
    doi: source.doi,
    pmid: source.pmid,
    pmcid: source.pmcid,
    retrievedAt: source.retrievedAt.toISOString(),
    accessLevel: source.accessLevel,
    excerpt: source.excerpt,
  };
}

function mapTask(task: {
  id: string;
  sessionId: string;
  status: ResearchTask["status"];
  kind: string;
  step: string;
  checkpoint: unknown;
  errorCode: string | null;
  attempt: number;
  toolCalls: number;
  estimatedCents: number;
  heartbeatAt: Date;
  startedAt: Date;
  finishedAt: Date | null;
}): ResearchTask {
  return {
    id: task.id,
    sessionId: task.sessionId,
    status: task.status,
    kind: task.kind,
    step: task.step,
    checkpoint: asCheckpoint(task.checkpoint),
    errorCode: task.errorCode,
    attempt: task.attempt,
    toolCalls: task.toolCalls,
    estimatedCents: task.estimatedCents,
    heartbeatAt: task.heartbeatAt.toISOString(),
    startedAt: task.startedAt.toISOString(),
    finishedAt: task.finishedAt?.toISOString() ?? null,
  };
}

function mapEmail(email: {
  id: string;
  sessionId: string;
  idempotencyKey: string;
  toAddress: string;
  subject: string;
  bodyText: string;
  status: OutboundEmail["status"];
  isSelf: boolean;
  providerMessageId: string | null;
  errorCode: string | null;
  updatedAt: Date;
}): OutboundEmail {
  return {
    id: email.id,
    sessionId: email.sessionId,
    idempotencyKey: email.idempotencyKey,
    toAddress: email.toAddress,
    subject: email.subject,
    bodyText: email.bodyText,
    status: email.status,
    isSelf: email.isSelf,
    providerMessageId: email.providerMessageId,
    errorCode: email.errorCode,
    updatedAt: email.updatedAt.toISOString(),
  };
}
