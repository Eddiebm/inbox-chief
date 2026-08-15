-- Call-in voice tier (Standard / Premium) on accessibility prefs
CREATE TYPE "CallInVoiceTier" AS ENUM ('STANDARD', 'PREMIUM');

ALTER TABLE "AccessibilityPreference"
  ADD COLUMN IF NOT EXISTS "callInVoiceTier" "CallInVoiceTier" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS "callInVoiceTipSpoken" BOOLEAN NOT NULL DEFAULT false;
