-- AlterTable
ALTER TABLE "CallSession" ADD COLUMN     "costUsd" DECIMAL(12,6),
ADD COLUMN     "durationSeconds" DOUBLE PRECISION,
ADD COLUMN     "endedReason" TEXT,
ADD COLUMN     "costSource" TEXT,
ADD COLUMN     "costBreakdown" JSONB;

-- CreateIndex
CREATE INDEX "CallSession_organizationId_userId_startedAt_idx" ON "CallSession"("organizationId", "userId", "startedAt");
