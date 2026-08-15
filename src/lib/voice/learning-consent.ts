/**
 * Voice learning consent — never silent, never global training.
 * Learning applies only when the owner explicitly enables it with consent.
 */

export type VoiceLearningProfile = {
  greeting: string | null;
  signature: string | null;
  tone: string | null;
};

export type VoiceLearningState = {
  learningEnabled: boolean;
  consentGranted: boolean;
  consentGrantedAt: string | null;
  hasLearnedData: boolean;
  profile: VoiceLearningProfile;
};

export type VoiceLearningAction =
  | { type: "enable"; consentAcknowledged: boolean }
  | { type: "disable" }
  | { type: "reset_profile" }
  | { type: "delete_learned_data" };

export function defaultVoiceLearningState(
  seed?: Partial<VoiceLearningProfile>,
): VoiceLearningState {
  const profile: VoiceLearningProfile = {
    greeting: seed?.greeting ?? null,
    signature: seed?.signature ?? null,
    tone: seed?.tone ?? null,
  };
  const hasSeed = Boolean(profile.greeting || profile.signature || profile.tone);
  return {
    learningEnabled: false,
    consentGranted: false,
    consentGrantedAt: null,
    hasLearnedData: hasSeed,
    profile,
  };
}

/**
 * Apply a consent-gated action. Enable requires explicit acknowledgement.
 */
export function applyVoiceLearningAction(
  state: VoiceLearningState,
  action: VoiceLearningAction,
  now: Date = new Date(),
): { ok: true; state: VoiceLearningState } | { ok: false; error: string } {
  switch (action.type) {
    case "enable": {
      if (!action.consentAcknowledged) {
        return {
          ok: false,
          error:
            "Voice learning requires explicit consent. Acknowledge before enabling.",
        };
      }
      return {
        ok: true,
        state: {
          ...state,
          learningEnabled: true,
          consentGranted: true,
          consentGrantedAt: now.toISOString(),
        },
      };
    }
    case "disable": {
      return {
        ok: true,
        state: {
          ...state,
          learningEnabled: false,
          // Consent record remains until learned data is deleted; learning is off.
        },
      };
    }
    case "reset_profile": {
      return {
        ok: true,
        state: {
          ...state,
          hasLearnedData: false,
          profile: {
            greeting: null,
            signature: null,
            tone: null,
          },
        },
      };
    }
    case "delete_learned_data": {
      return {
        ok: true,
        state: {
          learningEnabled: false,
          consentGranted: false,
          consentGrantedAt: null,
          hasLearnedData: false,
          profile: {
            greeting: null,
            signature: null,
            tone: null,
          },
        },
      };
    }
    default: {
      const _exhaustive: never = action;
      return { ok: false, error: `Unknown action: ${JSON.stringify(_exhaustive)}` };
    }
  }
}

/** Draft generation may use voice only when both flags are true. */
export function voiceProfileForDraft(state: VoiceLearningState) {
  return {
    greeting: state.profile.greeting,
    signature: state.profile.signature,
    tone: state.profile.tone,
    learningEnabled: state.learningEnabled,
    consentGranted: state.consentGranted,
  };
}
