/**
 * Local / OpenAI-compatible LLM provider config.
 * Prefer Ollama or any OpenAI-compatible endpoint via LLM_BASE_URL.
 */

export type LlmProvider = "stub" | "ollama" | "openai-compatible";

export type LlmConfig = {
  provider: LlmProvider;
  baseUrl: string | null;
  model: string | null;
  /** True when a non-stub provider has base URL + model configured */
  ready: boolean;
};

function normalizeProvider(raw: string | undefined): LlmProvider {
  const value = (raw ?? "stub").trim().toLowerCase();
  if (value === "ollama") return "ollama";
  if (value === "openai-compatible" || value === "openai") {
    return "openai-compatible";
  }
  return "stub";
}

export function resolveLlmConfig(
  env: Record<string, string | undefined> = process.env,
): LlmConfig {
  const requested = normalizeProvider(env.LLM_PROVIDER);
  const baseUrl = env.LLM_BASE_URL?.trim() || null;
  const model = env.LLM_MODEL?.trim() || null;

  if (requested === "stub" || !baseUrl || !model) {
    return {
      provider: "stub",
      baseUrl,
      model,
      ready: false,
    };
  }

  return {
    provider: requested,
    baseUrl: baseUrl.replace(/\/$/, ""),
    model,
    ready: true,
  };
}

/** Chat completions path — Ollama and OpenAI-compatible both expose /v1/chat/completions */
export function llmChatCompletionsUrl(config: LlmConfig): string | null {
  if (!config.ready || !config.baseUrl) return null;
  return `${config.baseUrl}/v1/chat/completions`;
}
