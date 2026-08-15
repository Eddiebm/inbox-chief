"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { gmailConnectedSpoken } from "@/lib/a11y/copy";
import {
  formatCallInDisplay,
  publicCallInNumber,
} from "@/lib/call-in/phone-display";
import { humanizeMailboxConnectReason } from "@/lib/mail/connect-errors";
import {
  phoneAlreadySavedAnnouncement,
  selectOnboardingSteps,
  type OnboardingStepId,
} from "@/lib/onboarding/skip-steps";
import { product } from "@/lib/product";
import {
  describeSpeechSupport,
  listen,
  speak,
  SPEECH_SUPPORT_SERVER,
  stopListening,
  stopSpeaking,
} from "@/lib/voice/speech";
import { LiveRegion } from "./LiveRegion";
import { QuestionStep } from "./QuestionStep";
import { VoiceControls } from "./VoiceControls";
import {
  CALL_IN_PHONE_STORAGE_KEY,
  ONBOARDING_QUESTIONS,
  STORAGE_KEY,
  type OnboardingAnswers,
  type OnboardingQuestion,
} from "./questions";

type StoredOnboarding = {
  answers: OnboardingAnswers;
  step: number;
  completedAt?: string;
};

const EMPTY_STORED: StoredOnboarding = { answers: {}, step: 0 };

function clampStep(step: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(Math.max(0, step), total - 1);
}

function readStored(): StoredOnboarding {
  if (typeof window === "undefined") return EMPTY_STORED;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STORED;
    const parsed = JSON.parse(raw) as {
      answers?: OnboardingAnswers;
      currentStep?: number;
      completedAt?: string;
    };
    return {
      answers: parsed.answers ?? {},
      step: typeof parsed.currentStep === "number" ? parsed.currentStep : 0,
      completedAt: parsed.completedAt,
    };
  } catch {
    return EMPTY_STORED;
  }
}

function writeStored(answers: OnboardingAnswers, currentStep: number) {
  const updatedAt = new Date().toISOString();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ answers, currentStep, updatedAt }),
  );
}

function readSavedPhone(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(CALL_IN_PHONE_STORAGE_KEY)?.trim() ?? "";
}

async function postOnboarding(body: Record<string, unknown>) {
  try {
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Offline — localStorage remains source of truth.
  }
}

function useSpeechSupport() {
  return useSyncExternalStore(
    () => () => {},
    describeSpeechSupport,
    () => SPEECH_SUPPORT_SERVER,
  );
}

function buildActiveSteps(opts: {
  gmailConnected: boolean;
  phoneSaved: boolean;
  welcomeDone: boolean;
}): OnboardingQuestion[] {
  const ids = new Set(
    selectOnboardingSteps({
      gmailConnected: opts.gmailConnected,
      phoneSaved: opts.phoneSaved,
      welcomeDone: opts.welcomeDone,
    }),
  );
  return ONBOARDING_QUESTIONS.filter((q) => ids.has(q.id as OnboardingStepId));
}

export function OnboardingWizard() {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const inputRef = useRef<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
  >(null);
  const stepSpokenRef = useRef<string | null>(null);
  const advancingRef = useRef(false);
  const support = useSpeechSupport();

  const [answers, setAnswers] = useState<OnboardingAnswers>({});
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showTypeInput, setShowTypeInput] = useState(true);
  const [clientReady, setClientReady] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [connectBusy, setConnectBusy] = useState(false);
  /** Skip welcome only when it was already completed on a previous visit — not mid-session. */
  const [skipWelcome, setSkipWelcome] = useState(false);

  const steps = useMemo(
    () =>
      buildActiveSteps({
        gmailConnected,
        phoneSaved,
        welcomeDone: skipWelcome,
      }),
    [gmailConnected, phoneSaved, skipWelcome],
  );
  const total = steps.length;
  const question = steps[stepIndex] ?? steps[0];

  const announce = useCallback((message: string) => {
    setStatus(message);
  }, []);

  const speakPrompt = useCallback(
    async (text: string) => {
      setIsSpeaking(true);
      announce(text);
      try {
        await speak(text, {
          onUnsupported: () => {
            announce(
              `${text} (Voice playback is not available in this browser.)`,
            );
          },
        });
      } finally {
        setIsSpeaking(false);
      }
    },
    [announce],
  );

  const speakError = useCallback(
    async (message: string) => {
      setErrorMessage(message);
      announce(message);
      setIsSpeaking(true);
      try {
        await speak(message);
      } finally {
        setIsSpeaking(false);
      }
    },
    [announce],
  );

  // Load storage + mail status; handle OAuth return query
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const stored = readStored();
      const savedPhone = readSavedPhone();
      const params = new URLSearchParams(window.location.search);
      const mailboxParam = params.get("mailbox") ?? params.get("gmail");
      const emailParam = params.get("email");
      const reason = params.get("reason");

      let connected = false;
      let connectedEmail: string | null = null;
      let identityPhone = "";

      try {
        const res = await fetch("/api/mail/status");
        const data = (await res.json()) as {
          connected?: boolean;
          mailboxes?: { emailAddress: string }[];
        };
        if (data.connected && data.mailboxes?.[0]) {
          connected = true;
          connectedEmail = data.mailboxes[0].emailAddress;
        }
      } catch {
        /* ignore */
      }

      try {
        const idRes = await fetch("/api/call-in/identity");
        if (idRes.ok) {
          const idData = (await idRes.json()) as {
            phones?: Array<{ phoneE164: string }>;
          };
          identityPhone = idData.phones?.[0]?.phoneE164?.trim() ?? "";
        }
      } catch {
        /* localStorage fallback below */
      }

      if (mailboxParam === "connected") {
        connected = true;
        connectedEmail = emailParam || connectedEmail;
      }

      if (cancelled) return;

      const phoneFromServerOrLocal = identityPhone || savedPhone;
      const nextAnswers = { ...stored.answers };
      if (mailboxParam === "connected") {
        nextAnswers.connectGmail = "connected";
      }
      if (phoneFromServerOrLocal) {
        nextAnswers.callInPhone = phoneFromServerOrLocal;
      }
      if (mailboxParam === "connected") {
        nextAnswers.welcomeConsent = nextAnswers.welcomeConsent ?? "agreed";
      }

      const welcomeAlreadyDone = Boolean(nextAnswers.welcomeConsent);
      const phoneAlready = Boolean(phoneFromServerOrLocal);
      const active = buildActiveSteps({
        gmailConnected: connected,
        phoneSaved: phoneAlready,
        welcomeDone: welcomeAlreadyDone,
      });
      const clamped = clampStep(stored.step, active.length);

      startTransition(() => {
        setAnswers(nextAnswers);
        setGmailConnected(connected);
        setGmailEmail(connectedEmail);
        setPhoneSaved(phoneAlready);
        setSkipWelcome(welcomeAlreadyDone);
        setStepIndex(clamped);
        setDraft(
          active[clamped]?.id === "callInPhone"
            ? (nextAnswers.callInPhone ?? phoneFromServerOrLocal ?? "")
            : (nextAnswers[active[clamped]?.id ?? ""] ?? ""),
        );
        setShowTypeInput(true);
        setClientReady(true);
      });

      if (mailboxParam === "connected") {
        const msg = gmailConnectedSpoken(connectedEmail);
        announce(msg);
        await speak(msg);
        window.history.replaceState({}, "", "/onboarding");
      } else if (mailboxParam === "error") {
        const msg = humanizeMailboxConnectReason(reason ?? "unknown");
        setErrorMessage(msg);
        announce(msg);
        await speak(msg);
        window.history.replaceState({}, "", "/onboarding");
      } else if (identityPhone) {
        const msg = phoneAlreadySavedAnnouncement(identityPhone);
        announce(msg);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [announce]);

  useEffect(() => {
    if (!clientReady) return;
    writeStored(answers, stepIndex);
  }, [answers, stepIndex, clientReady]);

  // Keep step index valid when skip filters change
  useEffect(() => {
    if (!clientReady || total === 0) return;
    if (stepIndex >= total) {
      setStepIndex(Math.max(0, total - 1));
    }
  }, [clientReady, stepIndex, total]);

  // Speak each step once — do NOT auto-listen (never trap in listening loops)
  useEffect(() => {
    if (!clientReady || !question) return;
    const key = `${question.id}:${stepIndex}`;
    if (stepSpokenRef.current === key) return;
    stepSpokenRef.current = key;

    headingRef.current?.focus();

    let cancelled = false;
    void (async () => {
      stopSpeaking();
      stopListening();
      startTransition(() => setIsListening(false));
      if (cancelled) return;

      const progress = `Step ${stepIndex + 1} of ${total}.`;
      const optionalHint = question.optional
        ? " This step is optional. You can skip."
        : "";
      await speakPrompt(`${progress} ${question.spokenPrompt}${optionalHint}`);
    })();

    return () => {
      cancelled = true;
      stopSpeaking();
      stopListening();
    };
  }, [clientReady, stepIndex, question, speakPrompt, total]);

  const finishOnboarding = useCallback(
    async (finalAnswers: OnboardingAnswers) => {
      const completedAt = new Date().toISOString();
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          answers: finalAnswers,
          currentStep: stepIndex,
          completedAt,
        }),
      );
      const done = "Onboarding complete. Opening your dashboard.";
      announce(done);
      await speak(done);
      await postOnboarding({ ...finalAnswers, completedAt, currentStep: stepIndex });
      router.push("/dashboard");
    },
    [announce, router, stepIndex],
  );

  const finishedRef = useRef(false);
  // If welcome + gmail + phone are already done, go straight to dashboard
  useEffect(() => {
    if (!clientReady || total > 0 || finishedRef.current) return;
    finishedRef.current = true;
    void finishOnboarding({
      ...answers,
      welcomeConsent: answers.welcomeConsent ?? "agreed",
    });
  }, [clientReady, total, finishOnboarding, answers]);

  const advanceWithAnswer = useCallback(
    async (rawAnswer: string) => {
      if (advancingRef.current || !question) return;
      advancingRef.current = true;
      setErrorMessage("");

      try {
        const answer =
          question.inputKind === "consent" || question.inputKind === "gmail"
            ? rawAnswer.trim() || "ok"
            : rawAnswer.trim();

        if (!question.optional && question.inputKind === "tel" && !answer) {
          await speakError("Please enter your phone number, or skip for now.");
          return;
        }

        if (question.inputKind === "tel" && answer) {
          try {
            const digits = answer.replace(/\D/g, "");
            let phoneE164 = answer.trim();
            if (!phoneE164.startsWith("+")) {
              if (digits.length === 10) phoneE164 = `+1${digits}`;
              else if (digits.length === 11 && digits.startsWith("1"))
                phoneE164 = `+${digits}`;
              else if (digits.length >= 8) phoneE164 = `+${digits}`;
            }
            const res = await fetch("/api/call-in/identity", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ phoneE164 }),
            });
            const data = (await res.json()) as {
              ok?: boolean;
              error?: string;
              phoneE164?: string;
            };
            if (!res.ok || !data.ok) {
              await speakError(
                data.error ??
                  "Could not save that phone number. Check the format and try again.",
              );
              return;
            }
            const saved = data.phoneE164 ?? phoneE164;
            localStorage.setItem(CALL_IN_PHONE_STORAGE_KEY, saved);
            setPhoneSaved(true);
            const dial = publicCallInNumber();
            if (dial) {
              announce(
                `Phone saved. After you finish, call ${formatCallInDisplay(dial)} from this number. Nothing sends without your approval.`,
              );
            }
          } catch {
            await speakError("Could not save that phone number. Try again.");
            return;
          }
        }

        const nextAnswers = { ...answers, [question.id]: answer };
        setAnswers(nextAnswers);
        writeStored(nextAnswers, stepIndex);

        const isLast = stepIndex >= total - 1;
        if (isLast) {
          await finishOnboarding(nextAnswers);
          return;
        }

        const nextStep = stepIndex + 1;
        const nextQ = steps[nextStep];
        setStepIndex(nextStep);
        setDraft(nextAnswers[nextQ?.id ?? ""] ?? "");
        await postOnboarding({ ...nextAnswers, currentStep: nextStep });
      } finally {
        advancingRef.current = false;
      }
    },
    [
      announce,
      answers,
      finishOnboarding,
      question,
      speakError,
      stepIndex,
      steps,
      total,
    ],
  );

  const handleConnectGmail = async () => {
    setConnectBusy(true);
    setErrorMessage("");
    announce("Starting secure Google connection…");
    try {
      const res = await fetch("/api/gmail/connect?returnTo=/onboarding", {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        url?: string;
        reason?: string;
        message?: string;
      };
      if (data.url) {
        announce("Redirecting to Google for permission…");
        window.location.href = data.url;
        return;
      }
      const msg = humanizeMailboxConnectReason(
        data.reason ?? "gmail_not_configured",
      );
      await speakError(msg);
    } catch {
      await speakError("Could not start Gmail connection. Please try again.");
    } finally {
      setConnectBusy(false);
    }
  };

  const handleHearAgain = async () => {
    if (!question) return;
    stopListening();
    setIsListening(false);
    await speakPrompt(question.spokenPrompt);
  };

  const handleStartListening = async () => {
    if (!question) return;
    if (question.inputKind === "consent" || question.inputKind === "gmail") {
      announce("Press Continue, or use the primary button on this screen.");
      return;
    }

    stopSpeaking();
    setIsSpeaking(false);
    setIsListening(true);
    announce("Listening…");

    try {
      const transcript = await listen({
        onInterim: (t) => announce(`Hearing: ${t}`),
        onUnsupported: () => {
          setShowTypeInput(true);
          announce("Voice input is not available. Please type your answer.");
        },
      });
      setIsListening(false);
      const normalized = transcript.trim().toLowerCase();
      if (
        question.optional &&
        (normalized === "skip" || normalized === "skip this")
      ) {
        await advanceWithAnswer("");
        return;
      }
      setDraft(transcript.trim());
      await advanceWithAnswer(transcript.trim());
    } catch (err) {
      setIsListening(false);
      const message = err instanceof Error ? err.message : "error";
      if (message === "unsupported") {
        setShowTypeInput(true);
        await speakError("Voice input is not available. Please type your answer.");
      } else if (message === "aborted" || message === "no-speech") {
        await speakError("No speech detected. Try again, or type your answer.");
      } else if (message === "timeout") {
        await speakError("Listening timed out. Try again, or type your answer.");
      } else if (message === "not-allowed") {
        setShowTypeInput(true);
        await speakError(
          "Microphone permission denied. Type your answer, or allow the microphone and try again.",
        );
      } else {
        await speakError("Listening stopped. You can try again or type your answer.");
      }
    }
  };

  const handleStopListening = () => {
    stopListening();
    setIsListening(false);
    announce("Stopped listening.");
  };

  const handleSkipVoiceAndType = () => {
    stopListening();
    setIsListening(false);
    setShowTypeInput(true);
    announce("Typing mode on. Use the field and Continue when ready.");
    queueMicrotask(() => inputRef.current?.focus());
  };

  const handleGoBack = () => {
    if (stepIndex <= 0) return;
    stopSpeaking();
    stopListening();
    setIsListening(false);
    setIsSpeaking(false);
    setErrorMessage("");
    const prev = stepIndex - 1;
    stepSpokenRef.current = null;
    setStepIndex(prev);
    setDraft(answers[steps[prev]?.id ?? ""] ?? "");
    announce(`Going back to step ${prev + 1}.`);
  };

  const handleSubmit = () => {
    if (question?.inputKind === "gmail") {
      void advanceWithAnswer(gmailConnected ? "connected" : "skipped");
      return;
    }
    if (question?.inputKind === "consent") {
      void advanceWithAnswer("agreed");
      return;
    }
    void advanceWithAnswer(draft);
  };

  if (!clientReady || !question || total === 0) {
    return (
      <div className="onboarding-shell">
        <p className="onboarding-loading">
          {clientReady && total === 0
            ? "Opening your dashboard…"
            : "Loading onboarding…"}
        </p>
      </div>
    );
  }

  return (
    <div className="onboarding-shell">
      <header className="onboarding-brand">
        <p className="onboarding-product-name">{product.name}</p>
        <p className="onboarding-tagline">{product.tagline}</p>
        <p className="onboarding-handsfree-hint">
          Voice is optional. Each step is spoken aloud — use Continue, Skip, or
          the keyboard anytime.
        </p>
        {gmailConnected && gmailEmail ? (
          <p className="onboarding-handsfree-hint">
            Gmail connected as {gmailEmail}.
          </p>
        ) : null}
      </header>

      <LiveRegion message={status} politeness="assertive" />

      <QuestionStep
        question={question}
        stepIndex={stepIndex}
        totalSteps={total}
        value={draft}
        onChange={setDraft}
        onSubmit={handleSubmit}
        onPrimaryAction={
          question.inputKind === "gmail" ? () => void handleConnectGmail() : undefined
        }
        primaryBusy={connectBusy}
        inputRef={inputRef}
        headingRef={headingRef}
        errorMessage={errorMessage}
      />

      <VoiceControls
        canGoBack={stepIndex > 0}
        isSpeaking={isSpeaking}
        isListening={isListening}
        speechSynthesisAvailable={support.synthesis}
        speechRecognitionAvailable={support.recognition}
        showTypeInput={showTypeInput}
        onHearAgain={() => void handleHearAgain()}
        onStartListening={() => void handleStartListening()}
        onStopListening={handleStopListening}
        onSkipVoiceAndType={handleSkipVoiceAndType}
        onGoBack={handleGoBack}
      />
    </div>
  );
}
