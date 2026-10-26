export type ProviderId = "openai" | "anthropic" | "xai";

export type ResearchScope = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  email: string;
  mailboxId: string | null;
};

export type AccessLevel = "FULL_TEXT" | "ABSTRACT" | "SNIPPET" | "INACCESSIBLE";

export type AgentPreference = {
  defaultProvider: ProviderId | "none";
  listenMode: "CONVERSATION" | "PUSH_TO_TALK" | "DICTATION";
  speechRate: number;
  endOfTurnMs: number;
  thinkingPauseMs: number;
  speakAloud: boolean;
  emailSelfSummaries: boolean;
  retainAudio: boolean;
  audioRetentionDays: number;
  monthlyCostLimitCents: number;
};

export type ResearchProject = {
  id: string;
  name: string;
  slug: string;
  kind: "COARE" | "SCIENTIFIC_IDEAS" | "CORRESPONDENCE" | "PERSONAL" | "CUSTOM";
  confidential: boolean;
  allowedProviders: ProviderId[];
};

export type GlossaryTerm = {
  id: string;
  term: string;
  spokenAs: string | null;
  aliases: string[];
};

export type SessionPending =
  | {
      type: "term";
      heard: string;
      canonical: string;
      question: string;
      projectHint: string | null;
      emailSelf: boolean;
    }
  | { type: "spell"; heard: string; question: string; projectHint: string | null; emailSelf: boolean }
  | { type: "correct" }
  | { type: "delete_session" }
  | {
      type: "draft";
      draftId: string;
      recipient: string;
      subject: string;
      body: string;
    }
  | { type: "mail_cursor"; messageId: string; from: string; subject: string };

export type ResearchSession = {
  id: string;
  projectId: string;
  title: string;
  status: "ACTIVE" | "PAUSED" | "COMPLETED";
  provider: ProviderId | "none";
  pending: SessionPending | null;
  activeTaskId: string | null;
  lastSpoken: string | null;
  createdAt: string;
  lastActiveAt: string;
};

export type ResearchRecord = {
  id: string;
  sessionId: string;
  projectId: string;
  kind: string;
  speaker: "OWNER" | "ASSISTANT" | "SYSTEM";
  text: string;
  correctedText: string | null;
  provider: ProviderId | "none" | null;
  model: string | null;
  sequence: number;
  createdAt: string;
  corrections: Array<{ previousText: string; correctedText: string; createdAt: string }>;
};

export type ResearchSource = {
  id: string;
  sessionId: string;
  title: string;
  authors: string;
  published: string | null;
  url: string;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  retrievedAt: string;
  accessLevel: AccessLevel;
  excerpt: string;
};

export type TaskCheckpoint = {
  question: string;
  projectId: string;
  emailSelf: boolean;
  provider: ProviderId | "none";
  searchDone: boolean;
  explainDone: boolean;
  emailStatus: "pending" | "accepted" | "failed" | "unknown" | "skipped";
  generalKnowledge: boolean;
};

export type ResearchTask = {
  id: string;
  sessionId: string;
  status: "QUEUED" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELED";
  kind: string;
  step: string;
  checkpoint: TaskCheckpoint;
  errorCode: string | null;
  attempt: number;
  toolCalls: number;
  estimatedCents: number;
  heartbeatAt: string;
  startedAt: string;
  finishedAt: string | null;
};

export type OutboundEmail = {
  id: string;
  sessionId: string;
  idempotencyKey: string;
  toAddress: string;
  subject: string;
  bodyText: string;
  status: "DRAFT" | "QUEUED" | "PROVIDER_ACCEPTED" | "FAILED" | "DELIVERED" | "UNKNOWN";
  isSelf: boolean;
  providerMessageId: string | null;
  errorCode: string | null;
  updatedAt: string;
};

export type RecordFilter = {
  query?: string;
  kinds?: string[];
  speaker?: "OWNER" | "ASSISTANT" | "SYSTEM";
  from?: string;
  to?: string;
  sessionId?: string;
  projectId?: string;
  limit?: number;
};

export type ExportBundle = {
  version: 1;
  exportedAt: string;
  projects: ResearchProject[];
  sessions: ResearchSession[];
  records: ResearchRecord[];
  sources: ResearchSource[];
  glossary: GlossaryTerm[];
};

export type TurnResult = {
  ok: boolean;
  persisted: boolean;
  sessionId: string | null;
  taskId: string | null;
  taskStatus: ResearchTask["status"] | null;
  spoken: string;
  detail: string | null;
  provider: { id: ProviderId | "none"; model: string | null } | null;
  sources: ResearchSource[];
  email: { id: string; status: OutboundEmail["status"]; spoken: string } | null;
  whatHappened: string | null;
  audioRetained: boolean;
  audioNote: string;
  monthCents: number;
  costLimitCents: number;
};
