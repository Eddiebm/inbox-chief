-- Server-side body/attachment continuation so a long email is read in full
-- across several spoken turns instead of being truncated mid-sentence.
ALTER TABLE "CallInIdentity"
  ADD COLUMN "readBodyOffset" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "readBodyKey" TEXT,
  ADD COLUMN "readAttachmentOffset" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "readAttachmentKey" TEXT;
