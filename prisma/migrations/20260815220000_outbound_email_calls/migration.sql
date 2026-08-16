-- Outbound Primary-mail call preference and durable burst cooldown.
ALTER TABLE "CallInIdentity"
  ADD COLUMN "callOnNewPrimary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastOutboundEmailCallAt" TIMESTAMP(3);
