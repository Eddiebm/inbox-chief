-- CreateEnum
CREATE TYPE "TriageStatus" AS ENUM ('NEW', 'TRIAGED', 'DEFERRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RetentionDecision" AS ENUM ('CANDIDATE', 'KEPT', 'TRASH_APPROVED');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "triageStatus" "TriageStatus" NOT NULL DEFAULT 'NEW';
ALTER TABLE "Message" ADD COLUMN "retentionDecision" "RetentionDecision";
