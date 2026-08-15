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
  if (!isSpeechSynthesisSupported()) return;
  window.speechSynthesis.cancel();
  activeUtterance = null;
}

/**
 * Speak text aloud. Resolves when utterance ends (or immediately if unsupported).
 */
export function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return Promise.resolve();

  if (!isSpeechSynthesisSupported()) {
    options.onUnsupported?.();
    return Promise.resolve();
  }

  stopSpeaking();

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.lang = options.lang ?? "en-US";
    utterance.rate = options.rate ?? 1;
    utterance.pitch = options.pitch ?? 1;
    utterance.volume = options.volume ?? 1;

    const finish = () => {
      if (activeUtterance === utterance) activeUtterance = null;
      resolve();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    activeUtterance = utterance;

    // Some browsers need a brief resume after cancel.
    try {
      window.speechSynthesis.resume();
    } catch {
      // ignore
    }

    window.speechSynthesis.speak(utterance);
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
