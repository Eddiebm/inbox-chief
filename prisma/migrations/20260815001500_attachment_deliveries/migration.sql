CREATE TABLE "AttachmentDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "gmailAttachmentId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "fileBytes" BYTEA NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "emailSubject" TEXT NOT NULL,
    "emailReceivedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "downloadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttachmentDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AttachmentDelivery_organizationId_requestedById_expiresAt_idx"
ON "AttachmentDelivery"("organizationId", "requestedById", "expiresAt");

CREATE INDEX "AttachmentDelivery_workspaceId_mailboxId_idx"
ON "AttachmentDelivery"("workspaceId", "mailboxId");

ALTER TABLE "AttachmentDelivery"
ADD CONSTRAINT "AttachmentDelivery_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttachmentDelivery"
ADD CONSTRAINT "AttachmentDelivery_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttachmentDelivery"
ADD CONSTRAINT "AttachmentDelivery_mailboxId_fkey"
FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttachmentDelivery"
ADD CONSTRAINT "AttachmentDelivery_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttachmentDelivery"
ADD CONSTRAINT "AttachmentDelivery_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
