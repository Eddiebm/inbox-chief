-- One-time spoken tip when minutes ≥80% forces Standard voice
ALTER TABLE "AccessibilityPreference"
ADD COLUMN IF NOT EXISTS "callInCostGuardTipSpoken" BOOLEAN NOT NULL DEFAULT false;
