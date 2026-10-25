"use client";

import { useEffect, useRef, useState } from "react";
import { talkCommand, talkInterrupt } from "@/lib/voice/talk-commands";
import {
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  listenForLatestPiece,
  listenUntilSilence,
  speak,
  stopListening,
  stopSpeaking,
} from "@/lib/voice/speech";

const QUESTION = "What do you want?";
const END_OF_TURN_MS = 1400;
const THINKING_PAUSE_MS = 8000;

const WEB_RATE: Record<string, number> = {
  slow: 0.85,
  normal: 1,
  brisk: 1.15,
  fast: 1.3,
};

type Phase = "idle" | "listening" | "working";

type AskResponse = {
  spoken?: string;
  error?: string;
  intent?: string;
  draftId?: string | null;
  speechRate?: string | null;
};

function speakBounded(
  text: string,
  rate: number,
  onStart: () => void,
  onBoundary: (charIndex: number) => void,
): Promise<void> {
  const cap = Math.min(90_000, 4_000 + text.length * 70);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      stopSpeaking();
      resolve();
    }, cap);
    void speak(text, { rate, onStart, onBoundary }).finally(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

function micLabel(phase: Phase): string {
  switch (phase) {
    case "listening":
      return "Microphone. Listening.";
    case "working":
      return "Microphone. Working.";
    case "idle":
      return "Microphone. Tap to speak to Inbox Chief.";
    default: {
      const neverPhase: never = phase;
      return neverPhase;
    }
  }
}

export function TalkHome() {
  const talkRef = useRef<HTMLButtonElement>(null);
  const handsFreeRef = useRef(true);
  const listeningRef = useRef(false);
  const turnRef = useRef(0);
  const rateRef = useRef(WEB_RATE.brisk ?? 1.15);
  const lastSpokenRef = useRef(QUESTION);
  const pendingDraftIdRef = useRef<string | null>(null);
  const charIndexRef = useRef<number | null>(null);
  const interruptRef = useRef<string | null>(null);
  const sessionIdRef = useRef(`talk_${crypto.randomUUID()}`);
  const [phase, setPhase] = useState<Phase>("idle");
  const [live, setLive] = useState(QUESTION);

  useEffect(() => {
    const focusTalk = window.setTimeout(() => talkRef.current?.focus(), 0);
    const arrival = window.setTimeout(() => {
      void arrive();
    }, 300);
    return () => {
      window.clearTimeout(focusTalk);
      window.clearTimeout(arrival);
      handsFreeRef.current = false;
      turnRef.current += 1;
      stopSpeaking();
      stopListening();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      stopSpeaking();
      setLive("Speech stopped. Listening.");
      void listenOnce(beginTurn());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function beginTurn(): number {
    turnRef.current += 1;
    stopListening();
    listeningRef.current = false;
    return turnRef.current;
  }

  async function arrive() {
    const turn = beginTurn();
    handsFreeRef.current = true;
    setPhase("idle");
    setLive(QUESTION);
    if (isSpeechSynthesisSupported()) {
      const outcome = await speakAndWatch(QUESTION, turn);
      if (outcome !== "done") return;
    }
    if (turn !== turnRef.current || !handsFreeRef.current) return;
    window.setTimeout(() => void listenOnce(turn), 400);
  }

  function watchInterrupts(spokenText: string, turn: number): () => void {
    let timer: number | null = null;
    let staged = "";
    const stop = listenForLatestPiece({
      onPiece: (piece) => {
        const command = talkInterrupt(piece, spokenText, charIndexRef.current);
        if (!command) {
          staged = "";
          if (timer != null) window.clearTimeout(timer);
          timer = null;
          return;
        }
        if (staged === piece && timer != null) return;
        staged = piece;
        if (timer != null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          timer = null;
          if (turn !== turnRef.current) return;
          interruptRef.current = piece;
          stopSpeaking();
        }, 420);
      },
    });
    return () => {
      if (timer != null) window.clearTimeout(timer);
      stop();
    };
  }

  async function speakAndWatch(text: string, turn: number): Promise<"done" | "interrupted" | "stale"> {
    charIndexRef.current = null;
    interruptRef.current = null;
    const stopWatch = watchInterrupts(text, turn);
    await speakBounded(
      text,
      rateRef.current,
      () => {
        charIndexRef.current = 0;
      },
      (index) => {
        charIndexRef.current = index;
      },
    );
    stopWatch();
    if (turn !== turnRef.current) return "stale";
    const interrupted = interruptRef.current;
    interruptRef.current = null;
    if (!interrupted) return "done";
    await handleUtterance(interrupted, turn);
    return "interrupted";
  }

  async function say(text: string, turn: number): Promise<"done" | "interrupted" | "stale"> {
    lastSpokenRef.current = text;
    if (!isSpeechSynthesisSupported()) {
      setPhase("idle");
      setLive(text);
      return "done";
    }
    return speakAndWatch(text, turn);
  }

  async function ask(text: string, turn: number) {
    setPhase("working");
    setLive("Working.");
    try {
      const response = await fetch("/api/call-in/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          sessionId: sessionIdRef.current,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(pendingDraftIdRef.current
            ? { pendingDraftId: pendingDraftIdRef.current }
            : {}),
        }),
      });
      const data = (await response.json()) as AskResponse;
      if (turn !== turnRef.current) return;
      if (
        data.intent === "compose_email" ||
        data.intent === "send_email" ||
        data.intent === "decline_send"
      ) {
        pendingDraftIdRef.current = data.draftId ?? null;
      }
      if (data.speechRate && WEB_RATE[data.speechRate] != null) {
        rateRef.current = WEB_RATE[data.speechRate]!;
      }
      const spoken = data.spoken ?? data.error ?? "I could not answer that.";
      const outcome = await say(spoken, turn);
      if (outcome !== "done") return;
      if (data.intent === "goodbye") {
        handsFreeRef.current = false;
        setPhase("idle");
        setLive(spoken);
        return;
      }
    } catch {
      const outcome = await say(
        "I could not reach Inbox Chief. Tap the microphone and try again.",
        turn,
      );
      if (outcome === "interrupted") return;
      handsFreeRef.current = false;
      setPhase("idle");
      return;
    }
    if (turn === turnRef.current && handsFreeRef.current) {
      window.setTimeout(() => void listenOnce(turn), 400);
    }
  }

  async function handleUtterance(text: string, turn: number) {
    const command = talkCommand(text);
    switch (command) {
      case "stop":
        stopSpeaking();
        setLive("Speech stopped. Listening.");
        window.setTimeout(() => void listenOnce(turn), 400);
        return;
      case "repeat":
      case "slower":
      case "faster":
      case "normal":
      case "next":
      case "previous":
      case "continue":
      case null:
        await ask(text, turn);
        return;
      default: {
        const neverCommand: never = command;
        return neverCommand;
      }
    }
  }

  async function listenOnce(turn: number) {
    if (!handsFreeRef.current || turn !== turnRef.current || listeningRef.current) return;
    if (!isSpeechRecognitionSupported()) {
      setPhase("idle");
      setLive("This browser cannot hear you.");
      return;
    }
    listeningRef.current = true;
    setPhase("listening");
    setLive("Listening.");
    try {
      const text = await listenUntilSilence({
        endOfTurnMs: END_OF_TURN_MS,
        thinkingPauseMs: THINKING_PAUSE_MS,
      });
      if (turn !== turnRef.current) return;
      listeningRef.current = false;
      await handleUtterance(text, turn);
    } catch (error) {
      listeningRef.current = false;
      if (turn !== turnRef.current || !handsFreeRef.current) return;
      const code = error instanceof Error ? error.message : "";
      if (code === "no-speech" || code === "aborted") {
        setLive("Listening.");
        window.setTimeout(() => void listenOnce(turn), 300);
        return;
      }
      handsFreeRef.current = false;
      setPhase("idle");
      if (code === "not-allowed" || code === "service-not-allowed") {
        setLive("Allow the microphone, then tap it.");
        return;
      }
      setLive("Tap the microphone.");
    }
  }

  function onTap() {
    stopSpeaking();
    handsFreeRef.current = true;
    const turn = beginTurn();
    setLive("Listening.");
    void listenOnce(turn);
  }

  return (
    <div className="talk-only">
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
      <button
        ref={talkRef}
        type="button"
        className="talk-mic"
        data-state={phase}
        aria-pressed={phase === "listening"}
        aria-label={micLabel(phase)}
        onClick={onTap}
      >
        <span className="talk-mic__ring" aria-hidden="true" />
        <span className="talk-mic__ring talk-mic__ring--late" aria-hidden="true" />
        <svg className="talk-mic__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 0-2 0 3 3 0 0 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.1A5 5 0 0 0 17 11z"
          />
        </svg>
      </button>
    </div>
  );
}
