import { afterEach, describe, expect, it } from "vitest";
import {
  answerCallInQuestion,
  answerCallInQuestionWithLlm,
  demoMailboxSnapshot,
  formatReadableEmailForSpeech,
  openingPrompt,
  speakReadableEmails,
  toReadableEmail,
  unrecognizedCallerAnswer,
  unrecognizedCallerSnapshot,
  UNRECOGNIZED_CALLER_SPOKEN,
} from "@/lib/call-in/assistant";

const snap = demoMailboxSnapshot("Alex");

const ENV_KEYS = ["LLM_PROVIDER", "LLM_BASE_URL", "LLM_MODEL"] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("anytime call-in assistant", () => {
  it("unrecognized caller never hears demo emails", () => {
    const snapU = unrecognizedCallerSnapshot();
    expect(snapU.readableEmails).toHaveLength(0);
    expect(snapU.identityStatus).toBe("unrecognized");
    expect(openingPrompt(snapU)).toMatch(/don't recognize this phone number/i);
    expect(openingPrompt(snapU)).toMatch(/Anytime call-in phone/i);
    expect(openingPrompt(snapU)).toMatch(/exact number you are calling from/i);
    expect(openingPrompt(snapU)).not.toMatch(/Schedule confirmation/i);
    // Never invent a person name (CNAM / LLM guess) — phone only
    expect(openingPrompt(snapU)).not.toMatch(
      /\b(Anita|name linked|recognize the name)\b/i,
    );

    const briefing = answerCallInQuestion("Give me a briefing", snapU);
    expect(briefing.spoken).toBe(UNRECOGNIZED_CALLER_SPOKEN);
    expect(briefing.spoken).toMatch(/don't recognize this phone number/i);
    expect(briefing.spoken).not.toMatch(/Jordan|Schedule confirmation|Anita/i);
    expect(briefing.spoken).toContain(UNRECOGNIZED_CALLER_SPOKEN);

    const read = answerCallInQuestion("Read my emails", snapU);
    expect(read.spoken).toBe(UNRECOGNIZED_CALLER_SPOKEN);
    expect(read.spoken).not.toMatch(/Jordan Lee|example\.com|Anita/i);
  });

  it("unmatched spoken script is phone-only with clear save instructions (no invented names)", () => {
    const spoken = unrecognizedCallerAnswer().spoken;
    expect(spoken).toMatch(/don't recognize this phone number/i);
    expect(spoken).toMatch(/Settings/i);
    expect(spoken).toMatch(/Anytime call-in phone/i);
    expect(spoken).toMatch(/exact number you are calling from/i);
    expect(spoken).toMatch(/call again/i);
    // Must not sound like CNAM / person-name recognition
    expect(spoken).not.toMatch(
      /\b(Anita|recognize the name|name linked|caller name)\b/i,
    );
    expect(spoken.toLowerCase()).not.toMatch(/\bdemo\b/);
    expect(unrecognizedCallerSnapshot().readableEmails).toHaveLength(0);
  });

  it("demo snapshot still works when identityStatus is demo", () => {
    expect(snap.identityStatus).toBe("demo");
    expect(answerCallInQuestion("Read my emails", snap).spoken).toMatch(
      /Jordan Lee/i,
    );
  });

  it("opens with a speakable greeting", () => {
    expect(openingPrompt(snap)).toMatch(/Alex/);
    expect(openingPrompt(snap)).toMatch(/read your emails|anytime/i);
  });

  it("answers briefing with subjects-first then offer full read", () => {
    const a = answerCallInQuestion("Give me a briefing", snap);
    expect(a.intent).toBe("briefing");
    expect(a.spoken).toMatch(/Subjects first|Subject:/i);
    expect(a.spoken).toMatch(/From Jordan Lee/i);
    expect(a.spoken).toMatch(/Schedule confirmation/i);
    expect(a.spoken).toMatch(/read email 1|read my emails/i);
    expect(a.spoken).toMatch(/Mailbox/);
  });

  it("read my emails intent includes readable text per message", () => {
    const a = answerCallInQuestion("Read my emails", snap);
    expect(a.intent).toBe("read_emails");
    expect(a.spoken).toMatch(/Email 1 of 3/i);
    expect(a.spoken).toMatch(/From Jordan Lee/i);
    expect(a.spoken).toMatch(/Received/i);
    expect(a.spoken).toMatch(/August 12, 2026/i);
    expect(a.spoken).toMatch(/Message:|Preview:/i);
  });

  it("what's in my inbox lists subjects first", () => {
    const a = answerCallInQuestion("What's in my inbox?", snap);
    expect(a.intent).toBe("briefing");
    expect(a.spoken).toMatch(/Subject:/i);
    expect(a.spoken).toMatch(/read email 1|full message/i);
    expect(a.spoken.toLowerCase()).not.toMatch(
      /^you have \d+ messages? needing attention\.?$/,
    );
  });

  it("says when only metadata exists", () => {
    const line = formatReadableEmailForSpeech(snap.readableEmails[2]!, 3, 3);
    expect(line).toMatch(/Family travel update/i);
    expect(line).toMatch(/only have the subject and sender/i);
  });

  it("speakReadableEmails paginates with next", () => {
    const first = speakReadableEmails(snap.readableEmails, { startIndex: 0 });
    expect(first).toMatch(/Email 1 of 3/i);
    expect(first).toMatch(/Say next for email 2/i);

    const second = speakReadableEmails(snap.readableEmails, { startIndex: 1 });
    expect(second).toMatch(/Email 2 of 3/i);
    expect(second).toMatch(/Preview:.*budget/i);
  });

  it("toReadableEmail prefers body over snippet", () => {
    expect(
      toReadableEmail({
        fromAddress: "a@b.com",
        subject: "Hi",
        snippet: "snip",
        bodyText: "full body",
      }),
    ).toMatchObject({ contentSource: "body", readableText: "full body" });

    expect(
      toReadableEmail({
        fromAddress: "a@b.com",
        subject: "Hi",
        snippet: "snip only",
        bodyText: null,
      }),
    ).toMatchObject({ contentSource: "snippet", readableText: "snip only" });
  });

  it("answers attention, drafts, and connection questions", () => {
    expect(answerCallInQuestion("What needs attention?", snap).intent).toBe(
      "attention",
    );
    expect(answerCallInQuestion("What needs attention?", snap).spoken).toMatch(
      /From Jordan Lee/i,
    );
    expect(answerCallInQuestion("Any drafts waiting?", snap).intent).toBe(
      "drafts",
    );
    expect(answerCallInQuestion("Is my Gmail connected?", snap).intent).toBe(
      "connection",
    );
  });

  it("never claims to send mail on goodbye", () => {
    const a = answerCallInQuestion("goodbye", snap);
    expect(a.intent).toBe("goodbye");
    expect(a.spoken.toLowerCase()).toMatch(/nothing was sent|never/);
  });

  it("falls back helpfully for unknown questions", () => {
    const a = answerCallInQuestion("What did Marcus say about the yellow bike?", snap);
    expect(a.intent).toBe("unknown");
    expect(a.spoken.toLowerCase()).toMatch(/read your emails|briefing|drafts/);
  });

  it("keeps known intents rule-based even when LLM is ready", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return Response.json({
        choices: [{ message: { content: "Should not be used." } }],
      });
    };

    const a = await answerCallInQuestionWithLlm({
      question: "Give me a briefing",
      snapshot: snap,
      llmConfig: {
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "llama3.2",
        ready: true,
      },
      fetchImpl,
    });

    expect(a.intent).toBe("briefing");
    expect(a.llmAssisted).toBeUndefined();
    expect(called).toBe(false);
    expect(a.spoken).toMatch(/Mailbox/);
    expect(a.spoken).toMatch(/Email 1 of 3/i);
  });

  it("uses local LLM for unknown intents when provider is ready", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return Response.json({
        choices: [
          {
            message: {
              content:
                "I only have status counts and subjects, not full message text. Ask for a briefing or what needs attention.",
            },
          },
        ],
      });
    };

    const a = await answerCallInQuestionWithLlm({
      question: "What did Marcus say about the yellow bike?",
      snapshot: snap,
      llmConfig: {
        provider: "openai-compatible",
        baseUrl: "http://localhost:8080",
        model: "local-model",
        ready: true,
      },
      fetchImpl,
    });

    expect(a.intent).toBe("unknown");
    expect(a.llmAssisted).toBe(true);
    expect(a.llmProvider).toBe("openai-compatible");
    expect(a.spoken).toMatch(/status counts|briefing|attention/i);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://localhost:8080/v1/chat/completions");

    const body = calls[0]?.body as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toMatch(/Never send/i);
    expect(system).toMatch(/demo_org\/demo_ws\/demo_mb/);
    expect(system).not.toMatch(/Courtney|COARE/i);
    expect(system).toMatch(/readableEmails/);
    expect(system).toMatch(/READ them aloud/i);
  });

  it("does not call LLM for unknown when provider is stub / not ready", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return Response.json({ choices: [{ message: { content: "nope" } }] });
    };

    process.env.LLM_PROVIDER = "stub";
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;

    const a = await answerCallInQuestionWithLlm({
      question: "Explain quantum mail sorting",
      snapshot: snap,
      fetchImpl,
    });

    expect(a.intent).toBe("unknown");
    expect(a.llmAssisted).toBeUndefined();
    expect(called).toBe(false);
    expect(a.spoken.toLowerCase()).toMatch(/read your emails|briefing|drafts/);
  });

  it("falls back to rule unknown reply when LLM request fails", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("down", { status: 503 });

    const a = await answerCallInQuestionWithLlm({
      question: "Where is the yellow bike email?",
      snapshot: snap,
      llmConfig: {
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "llama3.2",
        ready: true,
      },
      fetchImpl,
    });

    expect(a.intent).toBe("unknown");
    expect(a.llmAssisted).toBe(false);
    expect(a.spoken.toLowerCase()).toMatch(/read your emails|briefing|drafts/);
  });
});
