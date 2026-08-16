-- Durable cursor for announcing new Primary mail on the next successful call.
ALTER TABLE "CallInIdentity"
  ADD COLUMN "lastSuccessfulCallAt" TIMESTAMP(3);
