-- Research and communications agent records. Tenant columns are always
-- organizationId + workspaceId + ownerId. Original transcript text is immutable.

CREATE TYPE "ResearchProjectKind" AS ENUM ('COARE', 'SCIENTIFIC_IDEAS', 'CORRESPONDENCE', 'PERSONAL', 'CUSTOM');
CREATE TYPE "ResearchProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'XAI', 'NONE');
CREATE TYPE "ResearchListenMode" AS ENUM ('CONVERSATION', 'PUSH_TO_TALK', 'DICTATION');
CREATE TYPE "ResearchSessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');
CREATE TYPE "ResearchSpeaker" AS ENUM ('OWNER', 'ASSISTANT', 'SYSTEM');
CREATE TYPE "ResearchRecordKind" AS ENUM ('SPEECH_TRANSCRIPT', 'CORRECTION', 'ASSISTANT_RESPONSE', 'SOURCE', 'SUMMARY', 'DECISION', 'HYPOTHESIS', 'FOLLOW_UP', 'DICTATION', 'PROGRESS', 'SYSTEM_NOTE');
CREATE TYPE "ResearchTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELED');
CREATE TYPE "ResearchEmailStatus" AS ENUM ('DRAFT', 'QUEUED', 'PROVIDER_ACCEPTED', 'FAILED', 'DELIVERED', 'UNKNOWN');
CREATE TYPE "ResearchAccessLevel" AS ENUM ('FULL_TEXT', 'ABSTRACT', 'SNIPPET', 'INACCESSIBLE');

CREATE TABLE "ResearchProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "ResearchProjectKind" NOT NULL DEFAULT 'CUSTOM',
    "confidential" BOOLEAN NOT NULL DEFAULT true,
    "allowedProviders" "ResearchProvider"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResearchProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchAgentPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "defaultProvider" "ResearchProvider" NOT NULL DEFAULT 'NONE',
    "listenMode" "ResearchListenMode" NOT NULL DEFAULT 'CONVERSATION',
    "speechRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "endOfTurnMs" INTEGER NOT NULL DEFAULT 2200,
    "thinkingPauseMs" INTEGER NOT NULL DEFAULT 180000,
    "speakAloud" BOOLEAN NOT NULL DEFAULT true,
    "emailSelfSummaries" BOOLEAN NOT NULL DEFAULT false,
    "retainAudio" BOOLEAN NOT NULL DEFAULT false,
    "audioRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "monthlyCostLimitCents" INTEGER NOT NULL DEFAULT 2000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResearchAgentPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchGlossaryTerm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "spokenAs" TEXT,
    "aliases" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResearchGlossaryTerm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ResearchSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "provider" "ResearchProvider" NOT NULL DEFAULT 'NONE',
    "pendingJson" JSONB,
    "activeTaskId" TEXT,
    "lastSpoken" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ResearchRecordKind" NOT NULL,
    "speaker" "ResearchSpeaker" NOT NULL,
    "text" TEXT NOT NULL,
    "correctedText" TEXT,
    "provider" "ResearchProvider",
    "model" TEXT,
    "sequence" INTEGER NOT NULL,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchCorrection" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "previousText" TEXT NOT NULL,
    "correctedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchCorrection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "taskId" TEXT,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL DEFAULT '',
    "published" TEXT,
    "url" TEXT NOT NULL,
    "doi" TEXT,
    "pmid" TEXT,
    "pmcid" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "accessLevel" "ResearchAccessLevel" NOT NULL,
    "excerpt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "ResearchTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "kind" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "checkpoint" JSONB NOT NULL,
    "errorCode" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "estimatedCents" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResearchTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchOutboundEmail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "status" "ResearchEmailStatus" NOT NULL DEFAULT 'DRAFT',
    "isSelf" BOOLEAN NOT NULL DEFAULT true,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResearchOutboundEmail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchAudioClip" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "audioBytes" BYTEA NOT NULL,
    "consentGrantedAt" TIMESTAMP(3) NOT NULL,
    "retainUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchAudioClip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResearchProject_workspaceId_ownerId_slug_key" ON "ResearchProject"("workspaceId", "ownerId", "slug");
CREATE INDEX "ResearchProject_organizationId_workspaceId_ownerId_idx" ON "ResearchProject"("organizationId", "workspaceId", "ownerId");
CREATE UNIQUE INDEX "ResearchAgentPreference_userId_key" ON "ResearchAgentPreference"("userId");
CREATE UNIQUE INDEX "ResearchGlossaryTerm_workspaceId_ownerId_term_key" ON "ResearchGlossaryTerm"("workspaceId", "ownerId", "term");
CREATE INDEX "ResearchGlossaryTerm_organizationId_workspaceId_ownerId_idx" ON "ResearchGlossaryTerm"("organizationId", "workspaceId", "ownerId");
CREATE INDEX "ResearchSession_organizationId_workspaceId_ownerId_lastActiveAt_idx" ON "ResearchSession"("organizationId", "workspaceId", "ownerId", "lastActiveAt");
CREATE INDEX "ResearchSession_projectId_idx" ON "ResearchSession"("projectId");
CREATE INDEX "ResearchRecord_organizationId_workspaceId_ownerId_createdAt_idx" ON "ResearchRecord"("organizationId", "workspaceId", "ownerId", "createdAt");
CREATE INDEX "ResearchRecord_sessionId_sequence_idx" ON "ResearchRecord"("sessionId", "sequence");
CREATE INDEX "ResearchRecord_projectId_kind_idx" ON "ResearchRecord"("projectId", "kind");
CREATE INDEX "ResearchCorrection_recordId_createdAt_idx" ON "ResearchCorrection"("recordId", "createdAt");
CREATE INDEX "ResearchSource_organizationId_workspaceId_ownerId_sessionId_idx" ON "ResearchSource"("organizationId", "workspaceId", "ownerId", "sessionId");
CREATE INDEX "ResearchTask_organizationId_workspaceId_ownerId_status_idx" ON "ResearchTask"("organizationId", "workspaceId", "ownerId", "status");
CREATE INDEX "ResearchTask_sessionId_createdAt_idx" ON "ResearchTask"("sessionId", "createdAt");
CREATE UNIQUE INDEX "ResearchTask_idempotencyKey_key" ON "ResearchTask"("idempotencyKey");
CREATE UNIQUE INDEX "ResearchOutboundEmail_idempotencyKey_key" ON "ResearchOutboundEmail"("idempotencyKey");
CREATE INDEX "ResearchOutboundEmail_organizationId_workspaceId_ownerId_createdAt_idx" ON "ResearchOutboundEmail"("organizationId", "workspaceId", "ownerId", "createdAt");
CREATE INDEX "ResearchOutboundEmail_sessionId_idx" ON "ResearchOutboundEmail"("sessionId");
CREATE INDEX "ResearchAudioClip_organizationId_ownerId_retainUntil_idx" ON "ResearchAudioClip"("organizationId", "ownerId", "retainUntil");

ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchAgentPreference" ADD CONSTRAINT "ResearchAgentPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchGlossaryTerm" ADD CONSTRAINT "ResearchGlossaryTerm_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchGlossaryTerm" ADD CONSTRAINT "ResearchGlossaryTerm_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchSession" ADD CONSTRAINT "ResearchSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchSession" ADD CONSTRAINT "ResearchSession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchSession" ADD CONSTRAINT "ResearchSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchRecord" ADD CONSTRAINT "ResearchRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchRecord" ADD CONSTRAINT "ResearchRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchCorrection" ADD CONSTRAINT "ResearchCorrection_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ResearchRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchOutboundEmail" ADD CONSTRAINT "ResearchOutboundEmail_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchAudioClip" ADD CONSTRAINT "ResearchAudioClip_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
