-- CreateTable
CREATE TABLE "MailboxImapCredentials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "imapHost" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxImapCredentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailboxImapCredentials_mailboxId_key" ON "MailboxImapCredentials"("mailboxId");

-- CreateIndex
CREATE INDEX "MailboxImapCredentials_organizationId_workspaceId_idx" ON "MailboxImapCredentials"("organizationId", "workspaceId");

-- AddForeignKey
ALTER TABLE "MailboxImapCredentials" ADD CONSTRAINT "MailboxImapCredentials_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
