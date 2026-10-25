/**
 * Web Speech API helpers with graceful fallback when APIs are unavailable.
 */

export type SpeakOptions = {
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Called if speech synthesis is unavailable; still resolves. */
  onUnsupported?: () => void;
  onStart?: () => void;
  /** Character index of the word currently being spoken. */
  onBoundary?: (charIndex: number) => void;
};

export type ListenOptions = {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  /** Max time to wait for a final result (ms). Default 15000. */
  timeoutMs?: number;
  onInterim?: (transcript: string) => void;
  onStart?: () => void;
  onUnsupported?: () => void;
};

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
};

type SpeechRecognitionEventLike = {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorEventLike = {
  readonly error: string;
  readonly message?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((ev: Event) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeRecognition: SpeechRecognitionLike | null = null;
let speakToken = 0;

export function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export function isSpeechRecognitionSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  );
}

export function getSpeechRecognitionConstructor():
  | SpeechRecognitionConstructor
  | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function stopSpeaking(): void {
  speakToken += 1;
  activeUtterance = null;
  if (!isSpeechSynthesisSupported()) return;
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) synth.cancel();
}

/**
 * Speak text aloud. Resolves when utterance ends (or immediately if unsupported).
 * Chrome drops an utterance that starts in the same turn as recognition ending
 * or speechSynthesis.cancel(), so playback waits briefly and resumes if paused.
 */
export function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return Promise.resolve();

  if (!isSpeechSynthesisSupported()) {
    options.onUnsupported?.();
    return Promise.resolve();
  }

  stopSpeaking();
  const token = speakToken;

  return new Promise((resolve) => {
    let settled = false;
    let startTimer = 0;
    let watchdog = 0;
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.lang = options.lang ?? "en-US";
    utterance.rate = options.rate ?? 1;
    utterance.pitch = options.pitch ?? 1;
    utterance.volume = options.volume ?? 1;
    utterance.onstart = () => options.onStart?.();
    utterance.onboundary = (event) => {
      if (typeof event.charIndex === "number") options.onBoundary?.(event.charIndex);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(startTimer);
      window.clearInterval(watchdog);
      if (activeUtterance === utterance) activeUtterance = null;
      resolve();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    watchdog = window.setInterval(() => {
      if (token !== speakToken) return;
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch {
        // ignore
      }
    }, 250);

    startTimer = window.setTimeout(() => {
      if (token !== speakToken) {
        finish();
        return;
      }
      try {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.resume();
      } catch {
        // ignore
      }
      activeUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    }, 80);
  });
}

export function stopListening(): void {
  if (!activeRecognition) return;
  try {
    activeRecognition.onresult = null;
    activeRecognition.onerror = null;
    activeRecognition.onend = null;
    activeRecognition.stop();
  } catch {
    try {
      activeRecognition.abort();
    } catch {
      // ignore
    }
  }
  activeRecognition = null;
}

/**
 * Hear short phrases while speech is playing. Reports only the latest result
 * so an earlier echo of the email does not swallow a later "next".
 * Returns a stop function.
 */
export function listenForLatestPiece(options: {
  onPiece: (piece: string) => void;
}): () => void {
  const Recognition = getSpeechRecognitionConstructor();
  if (!Recognition) return () => undefined;
  let stopped = false;
  let current: SpeechRecognitionLike | null = null;

  const start = () => {
    if (stopped) return;
    if (current && activeRecognition === current) stopListening();
    const recognition = new Recognition();
    current = recognition;
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const latest = event.results[event.results.length - 1];
      const piece = latest?.[0]?.transcript?.trim() ?? "";
      if (piece) options.onPiece(piece);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        stopped = true;
      }
    };
    recognition.onend = () => {
      if (stopped || current !== recognition) return;
      window.setTimeout(() => {
        if (stopped || current !== recognition) return;
        start();
      }, 300);
    };
    activeRecognition = recognition;
    try {
      recognition.start();
    } catch {
      // The next say() will try again.
    }
  };

  start();
  return () => {
    stopped = true;
    if (current && activeRecognition === current) stopListening();
    current = null;
  };
}

/**
 * Listen for a single spoken answer. Resolves with transcript or rejects on error/timeout.
 * Rejects with Error("unsupported") when recognition is unavailable.
 */
export function listen(options: ListenOptions = {}): Promise<string> {
  const Recognition = getSpeechRecognitionConstructor();
  if (!Recognition) {
    options.onUnsupported?.();
    return Promise.reject(new Error("unsupported"));
  }

  stopListening();

  return new Promise((resolve, reject) => {
    const recognition = new Recognition();
    recognition.lang = options.lang ?? "en-US";
    recognition.continuous = options.continuous ?? false;
    recognition.interimResults = options.interimResults ?? true;
    recognition.maxAlternatives = 1;

    let settled = false;
    let finalTranscript = "";

    const timeoutMs = options.timeoutMs ?? 15_000;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      stopListening();
      reject(new Error("timeout"));
    }, timeoutMs);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      activeRecognition = null;
      fn();
    };

    recognition.onstart = () => {
      options.onStart?.();
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const piece = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalTranscript += piece;
        } else {
          interim += piece;
        }
      }

      const live = (finalTranscript || interim).trim();
      if (live) options.onInterim?.(live);

      if (finalTranscript.trim()) {
        const transcript = finalTranscript.trim();
        settle(() => {
          try {
            recognition.stop();
          } catch {
            // ignore
          }
          resolve(transcript);
        });
      }
    };

    recognition.onerror = (event) => {
      settle(() => {
        reject(new Error(event.error || "recognition-error"));
      });
    };

    recognition.onend = () => {
      if (settled) return;
      const transcript = finalTranscript.trim();
      settle(() => {
        if (transcript) resolve(transcript);
        else reject(new Error("no-speech"));
      });
    };

    activeRecognition = recognition;

    try {
      recognition.start();
    } catch (err) {
      settle(() => {
        reject(err instanceof Error ? err : new Error("start-failed"));
      });
    }
  });
}

export type PushToTalkController = {
  finish: () => Promise<string>;
  abort: () => void;
};

/**
 * Conversational listening. Waits through a long thinking pause, then ends the
 * turn after `endOfTurnMs` of silence. Does not require a wake word.
 */
export function listenUntilSilence(options: {
  lang?: string;
  endOfTurnMs: number;
  thinkingPauseMs: number;
  onInterim?: (transcript: string) => void;
  onStart?: () => void;
}): Promise<string> {
  const Recognition = getSpeechRecognitionConstructor();
  if (!Recognition) {
    return Promise.reject(new Error("unsupported"));
  }
  stopListening();
  return new Promise((resolve, reject) => {
    const recognition = new Recognition();
    recognition.lang = options.lang ?? "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    let settled = false;
    let heard = "";
    let silenceTimer: number | null = null;
    const thinkingTimer = window.setTimeout(() => {
      if (heard.trim()) return;
      finish(() => reject(new Error("no-speech")));
    }, options.thinkingPauseMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(thinkingTimer);
      if (silenceTimer) window.clearTimeout(silenceTimer);
      activeRecognition = null;
      try {
        recognition.stop();
      } catch {
        // already stopped
      }
      fn();
    };

    const armSilence = () => {
      if (silenceTimer) window.clearTimeout(silenceTimer);
      silenceTimer = window.setTimeout(() => {
        const transcript = heard.trim();
        finish(() => {
          if (transcript) resolve(transcript);
          else reject(new Error("no-speech"));
        });
      }, options.endOfTurnMs);
    };

    recognition.onstart = () => options.onStart?.();
    recognition.onresult = (event) => {
      let next = "";
      for (let i = 0; i < event.results.length; i += 1) {
        next += event.results[i]?.[0]?.transcript ?? "";
      }
      heard = next;
      if (heard.trim()) {
        window.clearTimeout(thinkingTimer);
        options.onInterim?.(heard.trim());
        armSilence();
      }
    };
    recognition.onerror = (event) => finish(() => reject(new Error(event.error || "recognition-error")));
    recognition.onend = () => {
      if (settled) return;
      const transcript = heard.trim();
      finish(() => {
        if (transcript) resolve(transcript);
        else reject(new Error("no-speech"));
      });
    };
    activeRecognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error("start-failed")));
    }
  });
}

export function startPushToTalk(options: {
  lang?: string;
  onInterim?: (transcript: string) => void;
  onStart?: () => void;
} = {}): PushToTalkController {
  const Recognition = getSpeechRecognitionConstructor();
  if (!Recognition) {
    return {
      finish: () => Promise.reject(new Error("unsupported")),
      abort: () => undefined,
    };
  }
  stopListening();
  const recognition = new Recognition();
  recognition.lang = options.lang ?? "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  let heard = "";
  recognition.onstart = () => options.onStart?.();
  recognition.onresult = (event) => {
    let next = "";
    for (let i = 0; i < event.results.length; i += 1) {
      next += event.results[i]?.[0]?.transcript ?? "";
    }
    heard = next;
    if (heard.trim()) options.onInterim?.(heard.trim());
  };
  activeRecognition = recognition;
  try {
    recognition.start();
  } catch {
    // The finish call reports the failure to the caller.
  }
  return {
    finish: () =>
      new Promise((resolve, reject) => {
        const transcript = heard.trim();
        stopListening();
        if (transcript) resolve(transcript);
        else reject(new Error("no-speech"));
      }),
    abort: () => {
      heard = "";
      stopListening();
    },
  };
}

/**
 * Stable snapshots for `useSyncExternalStore`. Returning a fresh object from
 * getSnapshot each call causes React to force infinite re-renders (production
 * crashes with "This page couldn’t load").
 */
const SPEECH_SUPPORT_SNAPSHOTS = {
  "00": Object.freeze({ synthesis: false, recognition: false }),
  "10": Object.freeze({ synthesis: true, recognition: false }),
  "01": Object.freeze({ synthesis: false, recognition: true }),
  "11": Object.freeze({ synthesis: true, recognition: true }),
} as const;

export type SpeechSupport = {
  readonly synthesis: boolean;
  readonly recognition: boolean;
};

/** Server / SSR snapshot — must be referentially stable. */
export const SPEECH_SUPPORT_SERVER: SpeechSupport =
  SPEECH_SUPPORT_SNAPSHOTS["00"];

export function describeSpeechSupport(): SpeechSupport {
  const synthesis = isSpeechSynthesisSupported();
  const recognition = isSpeechRecognitionSupported();
  const key = `${synthesis ? "1" : "0"}${recognition ? "1" : "0"}` as
    | "00"
    | "10"
    | "01"
    | "11";
  return SPEECH_SUPPORT_SNAPSHOTS[key];
}
