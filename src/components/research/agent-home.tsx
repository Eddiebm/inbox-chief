"use client";

import { useEffect, useRef, useState } from "react";
import { parseTurn } from "@/lib/research/parse";
import {
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  listenUntilSilence,
  speak,
  startPushToTalk,
  stopListening,
  stopSpeaking,
  type PushToTalkController,
} from "@/lib/voice/speech";

const DRAFT_KEY = "inbox-chief-agent-draft";

const DEFAULT_PREFERENCE: Preference = {
  listenMode: "CONVERSATION",
  speechRate: 1,
  endOfTurnMs: 2200,
  thinkingPauseMs: 180000,
  speakAloud: true,
  emailSelfSummaries: false,
  retainAudio: false,
  audioRetentionDays: 30,
  monthlyCostLimitCents: 2000,
  defaultProvider: "none",
};

function accessName(level: string): string {
  switch (level) {
    case "FULL_TEXT":
      return "Full text";
    case "ABSTRACT":
      return "Abstract only";
    case "SNIPPET":
      return "Search snippet";
    case "INACCESSIBLE":
      return "Text not available";
    default:
      return level.replaceAll("_", " ").toLowerCase();
  }
}

type SessionSummary = { id: string; title: string; lastActiveAt: string; lastSpoken: string | null };
type Preference = {
  listenMode: "CONVERSATION" | "PUSH_TO_TALK" | "DICTATION";
  speechRate: number;
  endOfTurnMs: number;
  thinkingPauseMs: number;
  speakAloud: boolean;
  emailSelfSummaries: boolean;
  retainAudio: boolean;
  audioRetentionDays: number;
  monthlyCostLimitCents: number;
  defaultProvider: string;
};

type TurnResponse = {
  ok?: boolean;
  persisted?: boolean;
  sessionId?: string | null;
  taskId?: string | null;
  taskStatus?: string | null;
  spoken?: string;
  detail?: string | null;
  whatHappened?: string | null;
  audioNote?: string;
  monthCents?: number;
  costLimitCents?: number;
  provider?: { id: string; model: string | null } | null;
  sources?: Array<{ title: string; accessLevel: string; url: string }>;
};

export function AgentHome() {
  const talkRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const handsFreeRef = useRef(false);
  const listeningRef = useRef(false);
  const preferenceRef = useRef(DEFAULT_PREFERENCE);
  const pttRef = useRef<PushToTalkController | null>(null);
  const previousSpoken = useRef<string[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [status, setStatus] = useState("Ready");
  const [transcript, setTranscript] = useState("");
  const [typed, setTyped] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskRunning, setTaskRunning] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [whatHappened, setWhatHappened] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [audioNote, setAudioNote] = useState("Audio is not retained.");
  const [costNote, setCostNote] = useState("");
  const [providerNote, setProviderNote] = useState("");
  const [sources, setSources] = useState<TurnResponse["sources"]>([]);
  const [pttOn, setPttOn] = useState(false);
  const [preference, setPreference] = useState<Preference>(DEFAULT_PREFERENCE);
  preferenceRef.current = preference;

  useEffect(() => {
    const focusTalk = window.setTimeout(() => talkRef.current?.focus(), 0);
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("session");
    if (requested) setSessionId(requested);
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as { text?: string };
        if (draft.text) {
          setTyped(draft.text);
          setDraftNote("This draft is only on this device. It is not saved on the server.");
        }
      }
    } catch {
      // Ignore a damaged local draft.
    }
    void refreshSessions();
    void fetch("/api/research/preferences")
      .then((response) => response.json())
      .then((data: { preference?: Preference; monthCents?: number }) => {
        if (data.preference) setPreference(data.preference);
        if (typeof data.monthCents === "number" && data.preference) {
          setCostNote(`Estimated model cost this month: $${(data.monthCents / 100).toFixed(2)} of $${(data.preference.monthlyCostLimitCents / 100).toFixed(2)}. API usage is billed separately from ChatGPT, Claude, or Grok subscriptions.`);
        }
      })
      .catch(() => undefined);
    return () => window.clearTimeout(focusTalk);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      stopSpeaking();
      setStatus(taskRunning ? "Speech stopped. Research continues." : "Speech stopped. I'm listening.");
      if (handsFreeRef.current) window.setTimeout(() => void listenOnce(), 300);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [taskRunning]);

  async function refreshSessions() {
    const response = await fetch("/api/research/sessions");
    if (!response.ok) return;
    const data = (await response.json()) as { sessions?: SessionSummary[] };
    setSessions(data.sessions ?? []);
  }

  async function say(text: string) {
    previousSpoken.current.push(text);
    setTranscript((current) => `${current}\n\n${text}`.trim());
    if (!preference.speakAloud || !isSpeechSynthesisSupported()) {
      setStatus("Response ready in the transcript. Spoken playback is off.");
      return;
    }
    setStatus("Speaking.");
    await speak(text, { rate: preference.speechRate });
    setStatus(taskRunning ? "Research continues." : "Finished speaking. I'm listening.");
  }

  function keepListening() {
    if (!handsFreeRef.current || preferenceRef.current.listenMode === "PUSH_TO_TALK") return;
    window.setTimeout(() => void listenOnce(), 300);
  }

  async function listenOnce() {
    const pref = preferenceRef.current;
    if (!handsFreeRef.current || pref.listenMode === "PUSH_TO_TALK" || listeningRef.current) return;
    if (!isSpeechRecognitionSupported()) {
      setStatus("This browser cannot hear you.");
      await say("This browser cannot hear you. There is no wake word on this page.");
      return;
    }
    listeningRef.current = true;
    setStatus("Listening.");
    try {
      await startClip();
      const text = await listenUntilSilence({
        endOfTurnMs: pref.endOfTurnMs,
        thinkingPauseMs: pref.thinkingPauseMs,
        onInterim: (value) => setTyped(value),
      });
      listeningRef.current = false;
      const audio = await takeClip();
      await submit(text, audio);
    } catch (error) {
      listeningRef.current = false;
      const code = error instanceof Error ? error.message : "";
      if ((code === "no-speech" || code === "aborted") && handsFreeRef.current) {
        setStatus("I'm still listening.");
        await say("I'm still listening.");
        void listenOnce();
        return;
      }
      handleListenError(error);
    }
  }

  async function startClip() {
    if (!preference.retainAudio || typeof MediaRecorder === "undefined") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();
      recorderRef.current = recorder;
    } catch {
      setAudioNote("Audio retention is on, but the microphone did not provide a clip. The transcript can still be saved.");
    }
  }

  async function takeClip(): Promise<string | null> {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return null;
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      if (recorder.state !== "inactive") recorder.stop();
      else resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
    });
    recorder.stream.getTracks().forEach((track) => track.stop());
    if (blob.size === 0 || blob.size > 1_500_000) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  async function submit(raw: string, audioBase64?: string | null) {
    const text = raw.trim();
    if (!text) return;
    const parsed = parseTurn(text, preference.listenMode === "DICTATION" ? "dictation" : "conversation");
    if (parsed.type === "command" && parsed.command === "stop") {
      stopSpeaking();
      setStatus(taskRunning ? "Speech stopped. Research continues." : "Speech stopped. I'm listening.");
      keepListening();
      return;
    }
    if (parsed.type === "command" && parsed.command === "repeat") {
      const last = previousSpoken.current[previousSpoken.current.length - 1];
      if (last) await say(last);
      keepListening();
      return;
    }
    if (parsed.type === "command" && parsed.command === "back") {
      const prior = previousSpoken.current[previousSpoken.current.length - 2];
      if (prior) await say(prior);
      else setStatus("There is no earlier answer yet.");
      keepListening();
      return;
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, sessionId, at: new Date().toISOString() }));
    setDraftNote("Not saved on the server yet.");
    setStatus("Thinking.");
    try {
      const response = await fetch("/api/research/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          sessionId,
          mode: preference.listenMode === "DICTATION" ? "dictation" : preference.listenMode === "PUSH_TO_TALK" ? "push_to_talk" : "conversation",
          audioBase64: audioBase64 ?? null,
        }),
      });
      const data = (await response.json()) as TurnResponse;
      if (!response.ok && !data.spoken) throw new Error("network");
      if (data.sessionId) setSessionId(data.sessionId);
      if (data.taskId) setTaskId(data.taskId);
      setTaskRunning(data.taskStatus === "RUNNING" || data.taskStatus === "QUEUED");
      if (data.persisted) {
        localStorage.removeItem(DRAFT_KEY);
        setDraftNote(null);
        setTyped("");
        setStatus("Saved.");
      } else {
        setDraftNote(data.spoken || "Not saved on the server.");
        setStatus("Not saved.");
      }
      if (data.whatHappened) setWhatHappened(data.whatHappened);
      if (data.audioNote) setAudioNote(data.audioNote);
      if (typeof data.monthCents === "number") {
        setCostNote(`Estimated model cost this month: $${(data.monthCents / 100).toFixed(2)} of $${((data.costLimitCents ?? preference.monthlyCostLimitCents) / 100).toFixed(2)}. API usage is billed separately from ChatGPT, Claude, or Grok subscriptions.`);
      }
      if (data.provider) setProviderNote(`Answer provider: ${data.provider.id}${data.provider.model ? `, model ${data.provider.model}` : ""}.`);
      setSources(data.sources ?? []);
      setTranscript((current) => `${current}\n\nYou: ${text}`.trim());
      await say(data.spoken || "I did not receive an answer.");
      void refreshSessions();
      keepListening();
    } catch {
      setStatus("Not saved. Connection lost.");
      setWhatHappened("I could not reach Inbox Chief. Your words are still in a draft on this device. I have not saved them on the server.");
      await say("I could not reach Inbox Chief. Your words are still in a draft on this device. I have not saved them on the server.");
      keepListening();
    }
  }

  async function onTalk() {
    if (status.startsWith("Speaking")) stopSpeaking();
    if (!isSpeechRecognitionSupported()) {
      setStatus("This browser cannot hear you.");
      textRef.current?.focus();
      await say("This browser cannot hear you. There is no wake word on this page.");
      return;
    }
    if (preference.listenMode === "PUSH_TO_TALK") {
      handsFreeRef.current = false;
      if (pttRef.current) {
        try {
          const text = await pttRef.current.finish();
          const audio = await takeClip();
          pttRef.current = null;
          setPttOn(false);
          await submit(text, audio);
        } catch (error) {
          pttRef.current = null;
          setPttOn(false);
          handleListenError(error);
        }
        return;
      }
      setStatus("Listening. Say done when you want me to press Done speaking, or press that button.");
      setPttOn(true);
      await startClip();
      pttRef.current = startPushToTalk({
        onInterim: (value) => setTyped(value),
      });
      return;
    }
    handsFreeRef.current = true;
    if (listeningRef.current) return;
    setStatus("Listening.");
    await say("I'm listening.");
    void listenOnce();
  }

  function handleListenError(error: unknown) {
    const code = error instanceof Error ? error.message : "";
    if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
      handsFreeRef.current = false;
      setStatus("Microphone blocked.");
      setWhatHappened("The browser blocked the microphone. Allow the microphone for this site, then press Talk once. After that, just speak.");
      return;
    }
    if (code === "no-speech") {
      if (handsFreeRef.current) {
        void listenOnce();
        return;
      }
      setStatus("I did not hear anything.");
      return;
    }
    setStatus("Listening failed.");
    setWhatHappened("Listening failed. Press Talk once to start again, then just speak.");
  }

  async function savePreference(patch: Partial<Preference> & { projectId?: string; allowedProviders?: string[] }) {
    const response = await fetch("/api/research/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) return;
    const data = (await response.json()) as { preference?: Preference };
    if (data.preference) setPreference(data.preference);
  }

  const speechOff = !preference.speakAloud;

  return (
    <div className="agent-home">
      <header className="agent-intro">
        <p className="agent-kicker">Research</p>
        <h1>Talk, and I will keep listening.</h1>
        <p className="agent-lead">
          Press Talk once. After that, just speak. Stop ends my speech and does not cancel research.
        </p>
      </header>

      <section className="agent-stage" aria-label="Speak">
        <p id="agent-status" className="agent-status" role="status" aria-live="polite" aria-atomic="true">
          <span className="sr-only">Status: </span>
          {status}
        </p>
        {draftNote ? <p className="agent-warning" role="alert">{draftNote}</p> : null}
        <button ref={talkRef} type="button" className="btn-primary agent-talk" aria-pressed={pttOn} onClick={() => void onTalk()}>
          {pttOn ? "Done speaking" : "Talk"}
        </button>
        <div className="agent-actions" role="group" aria-label="Main actions">
          <button type="button" className="btn-secondary" onClick={() => setShowSessions((value) => !value)}>
            Continue previous work
          </button>
          <button type="button" className="btn-secondary" onClick={() => { setStatus("Listening for a research question."); void onTalk(); }}>
            Research
          </button>
          <button type="button" className="btn-secondary" onClick={() => void submit(sessionId ? "Email this to me" : "Read my new emails")}>
            Email
          </button>
          <button
            type="button"
            className="btn-secondary"
            aria-pressed={preference.listenMode === "DICTATION"}
            onClick={() => {
              const next = preference.listenMode === "DICTATION" ? "CONVERSATION" : "DICTATION";
              void savePreference({ listenMode: next });
              setStatus(next === "DICTATION" ? "Dictation is on. I will save your words and not answer until you ask." : "Conversation is on.");
            }}
          >
            My notes
          </button>
          <button type="button" className="btn-secondary" aria-expanded={showHelp} onClick={() => { setShowHelp(true); void say("Press Talk once. After that, just speak. Say stop to interrupt me. Say cancel to stop research. You can say repeat, slower, faster, explain more, give me the short version, go back, correct that, save this, or email this to me."); }}>
            Help
          </button>
        </div>
        <div className="agent-row">
          <button type="button" className="btn-secondary" onClick={() => { stopSpeaking(); setStatus(taskRunning ? "Speech stopped. Research continues." : "Speech stopped. I'm listening."); if (handsFreeRef.current) window.setTimeout(() => void listenOnce(), 300); }}>
            Stop speaking
          </button>
          <button type="button" className="btn-danger" disabled={!taskRunning && !taskId} onClick={() => void submit("Cancel")}>
            Cancel research
          </button>
          <button type="button" className="btn-secondary" onClick={() => setWhatHappened((current) => current || status)}>
            What happened?
          </button>
        </div>
      </section>

      {showSessions ? (
        <section className="agent-panel" aria-label="Previous sessions">
          <h2>Previous sessions</h2>
          {sessions.length === 0 ? <p>No saved sessions yet.</p> : null}
          <ul className="agent-session-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <button type="button" className="btn-secondary" onClick={() => { setSessionId(session.id); setShowSessions(false); void say(session.lastSpoken || `Opened ${session.title}. No answer is stored yet.`); }}>
                  <span>{session.title}</span>
                  <span className="agent-session-when">{new Date(session.lastActiveAt).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showHelp ? (
        <section className="agent-panel" aria-label="Help">
          <h2>Help</h2>
          <p>Stop. Repeat. Slower. Faster. Explain more. Give me the short version. Go back. Correct that. Save this. Email this to me. Continue yesterday&apos;s discussion. What are you doing. Cancel.</p>
          <p>Dictation saves your words and does not answer until you say analyze this. Outside email stays a draft until you say send it after the readback.</p>
        </section>
      ) : null}

      <section className="agent-record" aria-label="Transcript">
        <div className="agent-record__head">
          <h2>Transcript</h2>
          {providerNote ? <p>{providerNote}</p> : null}
        </div>
        <div className="agent-transcript" aria-live={speechOff ? "polite" : "off"}>
          {transcript || "Nothing yet. Your words appear here after you speak."}
        </div>
        {sources && sources.length > 0 ? (
          <ul className="agent-sources">
            {sources.map((source) => (
              <li key={source.url}>
                <a href={source.url}>{source.title}</a>
                <span>{accessName(source.accessLevel)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {whatHappened ? (
        <section className="agent-panel" aria-label="What happened">
          <h2>What happened</h2>
          <p>{whatHappened}</p>
        </section>
      ) : null}

      <details className="agent-more">
        <summary>Settings, typing, and export</summary>
        <form
          className="agent-type"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(typed);
          }}
        >
          <label className="agent-field" htmlFor="agent-text">Type a request</label>
          <textarea ref={textRef} id="agent-text" value={typed} onChange={(event) => setTyped(event.target.value)} rows={4} />
          <button type="submit" className="btn-primary">Submit typed request</button>
        </form>
        <div className="agent-settings">
          <p>{audioNote}</p>
          {costNote ? <p>{costNote}</p> : null}
          <label className="agent-check">
            <input
              type="radio"
              name="listen-mode"
              checked={preference.listenMode === "CONVERSATION"}
              onChange={() => {
                handsFreeRef.current = true;
                void savePreference({ listenMode: "CONVERSATION" });
              }}
            />
            Conversation
          </label>
          <label className="agent-check">
            <input
              type="radio"
              name="listen-mode"
              checked={preference.listenMode === "PUSH_TO_TALK"}
              onChange={() => {
                handsFreeRef.current = false;
                void savePreference({ listenMode: "PUSH_TO_TALK" });
              }}
            />
            Push to talk
          </label>
          <label className="agent-field">
            Pause before I assume you are finished, seconds
            <input
              type="number"
              min={1}
              max={8}
              value={Math.round(preference.endOfTurnMs / 1000)}
              onChange={(event) => void savePreference({ endOfTurnMs: Number(event.target.value) * 1000 })}
            />
          </label>
          <label className="agent-check">
            <input type="checkbox" checked={preference.speakAloud} onChange={(event) => void savePreference({ speakAloud: event.target.checked })} />
            Speak answers aloud
          </label>
          <label className="agent-check">
            <input type="checkbox" checked={preference.emailSelfSummaries} onChange={(event) => void savePreference({ emailSelfSummaries: event.target.checked })} />
            Email session summaries to my verified address
          </label>
          <label className="agent-check">
            <input type="checkbox" checked={preference.retainAudio} onChange={(event) => void savePreference({ retainAudio: event.target.checked })} />
            Keep original audio
          </label>
          <label className="agent-field">
            Monthly model cost limit, dollars
            <input
              type="number"
              min={0}
              value={Math.round(preference.monthlyCostLimitCents / 100)}
              onChange={(event) => void savePreference({ monthlyCostLimitCents: Number(event.target.value) * 100 })}
            />
          </label>
          <p className="agent-links">
            <a href="/api/research/export">Export JSON</a>
            <a href="/api/research/export?format=md">Export Markdown</a>
          </p>
          <label className="agent-field">
            Restore from an export file
            <input
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file.text().then(async (contents) => {
                  const response = await fetch("/api/research/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: contents });
                  const data = (await response.json()) as { spoken?: string };
                  await say(data.spoken || "Restore finished.");
                  void refreshSessions();
                });
              }}
            />
          </label>
        </div>
      </details>
    </div>
  );
}
