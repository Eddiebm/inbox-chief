import {
  llmChatCompletionsUrl,
  resolveLlmConfig,
  type LlmConfig,
} from "@/lib/ai/llm-config";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmCompletionInput = {
  messages: LlmMessage[];
  config?: LlmConfig;
  /** Injected for tests — do not call real network when provided */
  fetchImpl?: typeof fetch;
};

export type LlmCompletionResult = {
  ok: boolean;
  stub: boolean;
  provider: LlmConfig["provider"];
  model: string | null;
  content: string;
  error?: string;
};

/**
 * Local LLM completion stub.
 * When provider is ready, POSTs OpenAI-compatible chat completions.
 * When not configured, returns a deterministic stub (no network).
 */
export async function completeChat(
  input: LlmCompletionInput,
): Promise<LlmCompletionResult> {
  const config = input.config ?? resolveLlmConfig();

  if (!config.ready) {
    return {
      ok: true,
      stub: true,
      provider: "stub",
      model: config.model,
      content: stubContentFromMessages(input.messages),
    };
  }

  const url = llmChatCompletionsUrl(config);
  if (!url) {
    return {
      ok: false,
      stub: true,
      provider: config.provider,
      model: config.model,
      content: "",
      error: "LLM base URL missing",
    };
  }

  const fetchFn = input.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: input.messages,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      return {
        ok: false,
        stub: false,
        provider: config.provider,
        model: config.model,
        content: "",
        error: `LLM HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      return {
        ok: false,
        stub: false,
        provider: config.provider,
        model: config.model,
        content: "",
        error: "Empty LLM response",
      };
    }

    return {
      ok: true,
      stub: false,
      provider: config.provider,
      model: config.model,
      content,
    };
  } catch (err) {
    return {
      ok: false,
      stub: false,
      provider: config.provider,
      model: config.model,
      content: "",
      error: err instanceof Error ? err.message : "LLM request failed",
    };
  }
}

function stubContentFromMessages(messages: LlmMessage[]): string {
  const user = [...messages].reverse().find((m) => m.role === "user");
  return user?.content?.slice(0, 500) ?? "";
}
