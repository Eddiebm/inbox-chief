-- Call-in reading speed (Slow / Normal / Brisk / Fast) on accessibility prefs.
-- Brisk is the new default: modestly faster reads; patrons can slow it by voice.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CallInSpeechRate') THEN
    CREATE TYPE "CallInSpeechRate" AS ENUM ('SLOW', 'NORMAL', 'BRISK', 'FAST');
  END IF;
END$$;

ALTER TABLE "AccessibilityPreference"
  ADD COLUMN IF NOT EXISTS "callInSpeechRate" "CallInSpeechRate" NOT NULL DEFAULT 'BRISK';
