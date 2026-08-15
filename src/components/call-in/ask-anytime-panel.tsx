"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { formatCallInDisplay } from "@/lib/call-in/phone-display";
import { listen, speak, stopListening, stopSpeaking } from "@/lib/voice/speech";
import { product } from "@/lib/product";

const NAME_KEY = "inbox-chief-onboarding";

function preferredNameFromStorage(): string {
  try {
    const raw = localStorage.getItem(NAME_KEY);
    if (!raw) return "there";
    const data = JSON.parse(raw) as Record<string, string>;
    return (
      data.assistantCallYou ||
      data.preferredName ||
      data.whatShouldTheAssistantCallYou ||
      "there"
    );
  } catch {
    return "there";
  }
}

/**
 * Anytime voice assistant — call-in equivalent in the browser.
 * User can ask anything about correspondence status; never sends mail.
 */
export function AskAnytimePanel() {
  const statusId = useId();
  const callInNumber =
    process.env.NEXT_PUBLIC_VAPI_CALL_IN_NUMBER ??
    process.env.NEXT_PUBLIC_TWILIO_CALL_IN_NUMBER ??
    null;
  const [status, setStatus] = useState(
    `${product.name} is ready. Ask anything about your mail anytime.`,
  );
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [typed, setTyped] = useState("");
  const [sessionId] = useState(() => `web_${crypto.randomUUID()}`);
  const [opening, setOpening] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/call-in/ask");
        const data = (await res.json()) as { opening?: string };
        if (!cancelled && data.opening) {
          setOpening(data.opening);
          setStatus(data.opening);
        }
      } catch {
        /* keep default */
      }
    })();
    return () => {
      cancelled = true;
      stopSpeaking();
      stopListening();
    };
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q) {
        setStatus("Ask a question, or press Start listening.");
        return;
      }
      setStatus("Thinking…");
      try {
        const res = await fetch("/api/call-in/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: q,
            preferredName: preferredNameFromStorage(),
            sessionId,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        const data = (await res.json()) as {
          spoken?: string;
          error?: string;
        };
        const spoken = data.spoken ?? data.error ?? "I could not answer that.";
        setStatus(spoken);
        setTranscript(q);
        setTyped("");
        await speak(spoken);
      } catch {
        setStatus("Network error. Try again.");
      }
    },
    [sessionId],
  );

  const startListening = useCallback(async () => {
    stopSpeaking();
    stopListening();
    setListening(true);
    setStatus("Listening… speak your question.");
    try {
      const heard = await listen({
        onInterim: (partial) => setStatus(`Hearing: ${partial}`),
      });
      setListening(false);
      await ask(heard);
    } catch (err) {
      setListening(false);
      const message = err instanceof Error ? err.message : "recognition-error";
      if (message === "unsupported") {
        setStatus("Voice input unavailable here. Type your question below.");
      } else if (message === "not-allowed" || message === "service-not-allowed") {
        setStatus("Microphone blocked. Type your question, or allow the mic.");
      } else if (message === "no-speech" || message === "timeout") {
        setStatus("No speech detected. Try again or type your question.");
      } else {
        setStatus("Listening stopped. Type your question anytime.");
      }
    }
  }, [ask]);

  return (
    <section className="ask-anytime" aria-labelledby="ask-anytime-heading">
      <h2 id="ask-anytime-heading">Ask by voice</h2>
      <p className="lede">
        Phone or speak here whenever you want — briefing, drafts, approvals,
        follow-ups, or connection status. {product.name} never sends mail from
        this conversation.
      </p>

      <div className="ask-anytime__phone" role="region" aria-label="Phone call-in">
        <h2>Phone</h2>
        <p>
          {callInNumber ? (
            <>
              Dial{" "}
              <a href={`tel:${callInNumber}`}>
                <strong>{formatCallInDisplay(callInNumber)}</strong>
              </a>{" "}
              anytime ({callInNumber}). Register your caller ID under Settings
              so we recognize you. {product.name} never sends email from a call.
            </>
          ) : (
            <>
              Phone calling isn’t ready yet. Until then, use voice ask below —
              same answers, anytime.
            </>
          )}
        </p>
      </div>

      <div
        className="ask-anytime__web"
        role="region"
        aria-label="Voice ask in browser"
      >
        <h2>Ask by voice now</h2>
        <p
          id={statusId}
          className="status-line"
          role="status"
          aria-live="assertive"
        >
          {status}
        </p>
        {transcript ? (
          <p className="ask-anytime__heard">
            <span className="sr-only">Last question: </span>
            You asked: {transcript}
          </p>
        ) : null}

        <div className="ask-anytime__controls">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void startListening()}
            disabled={listening}
            aria-describedby={statusId}
          >
            {listening ? "Listening…" : "Start listening"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              stopSpeaking();
              if (opening) {
                setStatus(opening);
                void speak(opening);
              }
            }}
          >
            Hear intro again
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              stopSpeaking();
              stopListening();
              setListening(false);
              setStatus("Stopped. Ask again whenever you are ready.");
            }}
          >
            Stop
          </button>
        </div>

        <form
          className="ask-anytime__type"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(typed);
          }}
        >
          <label htmlFor="ask-typed">
            Or type any question
            <input
              id="ask-typed"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="e.g. What needs attention?"
              autoComplete="off"
            />
          </label>
          <button type="submit" className="btn-primary">
            Ask
          </button>
        </form>

        <ul className="ask-anytime__examples">
          <li>
            <button
              type="button"
              className="linkish"
              onClick={() => void ask("Give me a briefing")}
            >
              Give me a briefing
            </button>
          </li>
          <li>
            <button
              type="button"
              className="linkish"
              onClick={() => void ask("What needs attention?")}
            >
              What needs attention?
            </button>
          </li>
          <li>
            <button
              type="button"
              className="linkish"
              onClick={() => void ask("Any drafts waiting?")}
            >
              Any drafts waiting?
            </button>
          </li>
          <li>
            <button
              type="button"
              className="linkish"
              onClick={() => void ask("Is my Gmail connected?")}
            >
              Is my Gmail connected?
            </button>
          </li>
        </ul>
      </div>
    </section>
  );
}
