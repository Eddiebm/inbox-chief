-- Prepaid minute packs: org wallet + purchase audit + per-call draw tracking.
-- Purchased minutes roll over across billing periods until consumed.

CREATE TABLE "CallMinuteBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchasedMinutesRemaining" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "purchasedMinutesLifetime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallMinuteBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CallMinuteBalance_organizationId_key" ON "CallMinuteBalance"("organizationId");

ALTER TABLE "CallMinuteBalance" ADD CONSTRAINT "CallMinuteBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CallMinutePackPurchase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "balanceId" TEXT,
    "packId" TEXT NOT NULL,
    "minutesCredited" INTEGER NOT NULL,
    "amountUsdCents" INTEGER NOT NULL,
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallMinutePackPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CallMinutePackPurchase_stripeCheckoutSessionId_key" ON "CallMinutePackPurchase"("stripeCheckoutSessionId");

CREATE INDEX "CallMinutePackPurchase_organizationId_createdAt_idx" ON "CallMinutePackPurchase"("organizationId", "createdAt");

ALTER TABLE "CallMinutePackPurchase" ADD CONSTRAINT "CallMinutePackPurchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CallMinutePackPurchase" ADD CONSTRAINT "CallMinutePackPurchase_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "CallMinuteBalance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CallSession" ADD COLUMN "purchasedMinutesDrawn" DOUBLE PRECISION;
