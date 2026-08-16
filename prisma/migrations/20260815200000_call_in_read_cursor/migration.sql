-- Per-call read position so "next" walks the Primary inbox instead of re-reading the newest message.
ALTER TABLE "CallInIdentity"
  ADD COLUMN "readCursorIndex" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "readCursorScope" TEXT,
  ADD COLUMN "readCursorCallId" TEXT,
  ADD COLUMN "readCursorAt" TIMESTAMP(3);
