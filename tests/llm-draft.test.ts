import { afterEach, describe, expect, it } from "vitest";
import { generateDraft } from "@/lib/ai/draft";
import { completeChat } from "@/lib/ai/llm-client";
import {
  llmChatCompletionsUrl,
  resolveLlmConfig,
} from "@/lib/ai/llm-config";

const scope = {
  organizationId: "org_1",
  workspaceId: "ws_1",
  mailboxId: "mb_1",
  userId: "u_1",
};

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

describe("llm config", () => {
  it("defaults to stub when unset", () => {
    const config = resolveLlmConfig({
      LLM_PROVIDER: undefined,
      LLM_BASE_URL: undefined,
      LLM_MODEL: undefined,
    });
    expect(config.provider).toBe("stub");
    expect(config.ready).toBe(false);
    expect(llmChatCompletionsUrl(config)).toBeNull();
  });

  it("is ready for ollama when base URL and model are set", () => {
    const config = resolveLlmConfig({
      LLM_PROVIDER: "ollama",
      LLM_BASE_URL: "http://127.0.0.1:11434/",
      LLM_MODEL: "llama3.2",
    });
    expect(config).toMatchObject({
      provider: "ollama",
      ready: true,
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
    });
    expect(llmChatCompletionsUrl(config)).toBe(
      "http://127.0.0.1:11434/v1/chat/completions",
    );
  });

  it("falls back to stub if provider set without URL/model", () => {
    const config = resolveLlmConfig({
      LLM_PROVIDER: "openai-compatible",
      LLM_BASE_URL: "",
      LLM_MODEL: "gpt-4o-mini",
    });
    expect(config.provider).toBe("stub");
    expect(config.ready).toBe(false);
  });
});

describe("llm client + draft wiring", () => {
  it("completeChat returns stub content when not ready", async () => {
    const result = await completeChat({
      config: {
        provider: "stub",
        baseUrl: null,
        model: null,
        ready: false,
      },
      messages: [{ role: "user", content: "Hello draft world" }],
    });
    expect(result.ok).toBe(true);
    expect(result.stub).toBe(true);
    expect(result.content).toContain("Hello draft world");
  });

  it("completeChat posts to OpenAI-compatible endpoint when ready", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return Response.json({
        choices: [{ message: { content: "Thanks for writing." } }],
      });
    };
    const result = await completeChat({
      config: {
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "llama3.2",
        ready: true,
      },
      messages: [{ role: "user", content: "Draft a reply" }],
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.stub).toBe(false);
    expect(result.content).toBe("Thanks for writing.");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(calls[0]?.body).toMatchObject({ model: "llama3.2" });
  });

  it("generateDraft uses voice only with consent + learning", async () => {
    process.env.LLM_PROVIDER = "stub";
    const withConsent = await generateDraft({
      scope,
      subject: "Meeting",
      bodySnippet: "Can we meet Tuesday?",
      voiceProfile: {
        tone: "warm and brief",
        signature: "— Owner",
        learningEnabled: true,
        consentGranted: true,
      },
    });
    expect(withConsent.promptContext.voiceUsed).toBe(true);
    expect(withConsent.bodyText).toMatch(/warm and brief/);
    expect(withConsent.bodyText).toMatch(/— Owner/);

    const without = await generateDraft({
      scope,
      subject: "Meeting",
      bodySnippet: "Can we meet Tuesday?",
      voiceProfile: {
        tone: "warm and brief",
        signature: "— Owner",
        learningEnabled: true,
        consentGranted: false,
      },
    });
    expect(without.promptContext.voiceUsed).toBe(false);
    expect(without.bodyText).not.toMatch(/— Owner/);
  });

  it("generateDraft records llm readiness and uses remote content when ready", async () => {
    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_BASE_URL = "http://localhost:8080";
    process.env.LLM_MODEL = "local-model";

    const fetchImpl: typeof fetch = async () =>
      Response.json({
        choices: [{ message: { content: "Happy to meet Tuesday afternoon." } }],
      });

    const result = await generateDraft({
      scope,
      subject: "Meeting",
      bodySnippet: "Tuesday?",
      fetchImpl,
    });

    expect(result.promptContext.llmReady).toBe(true);
    expect(result.promptContext.llmProvider).toBe("openai-compatible");
    expect(result.bodyText).toContain("Happy to meet Tuesday afternoon.");
    expect(result.bodyText).toMatch(/human review/i);
  });
});
