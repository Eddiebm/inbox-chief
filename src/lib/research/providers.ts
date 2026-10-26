import type { ProviderId } from "@/lib/research/types";

export type ProviderConfig = {
  id: ProviderId;
  apiKey: string;
  model: string;
};

export type CompletionRequest = {
  provider: ProviderId;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
};

export type CompletionResult =
  | {
      ok: true;
      provider: ProviderId;
      model: string;
      content: string;
      inputTokens: number;
      outputTokens: number;
    }
  | {
      ok: false;
      provider: ProviderId;
      model: string | null;
      code: "provider_rate_limit" | "provider_auth" | "provider_down" | "provider_missing";
      spoken: string;
    };

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  xai: "xAI Grok",
};

export function providerLabel(id: ProviderId | "none"): string {
  if (id === "none") return "no language model";
  return PROVIDER_LABEL[id];
}

export function configuredProviders(
  env: Record<string, string | undefined> = process.env,
): ProviderConfig[] {
  const configs: ProviderConfig[] = [];
  const openai = env.OPENAI_API_KEY?.trim();
  if (openai) {
    configs.push({ id: "openai", apiKey: openai, model: env.OPENAI_MODEL?.trim() || "gpt-5.6-sol" });
  }
  const anthropic = env.ANTHROPIC_API_KEY?.trim();
  if (anthropic) {
    configs.push({
      id: "anthropic",
      apiKey: anthropic,
      model: env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5",
    });
  }
  const xai = env.XAI_API_KEY?.trim();
  if (xai) {
    configs.push({ id: "xai", apiKey: xai, model: env.XAI_MODEL?.trim() || "grok-4.3" });
  }
  return configs;
}

export function selectProvider(input: {
  requested: ProviderId | "none" | null;
  preference: ProviderId | "none";
  configured: ProviderConfig[];
}): { config: ProviderConfig | null; refusal: string | null } {
  const configuredIds = input.configured.map((item) => item.id);
  if (input.requested && input.requested !== "none") {
    const match = input.configured.find((item) => item.id === input.requested) ?? null;
    if (!match) {
      const alternatives = configuredIds.map((id) => providerLabel(id)).join(", ");
      return {
        config: null,
        refusal: alternatives
          ? `${providerLabel(input.requested)} is not configured on this server. I did not use another provider. Configured alternatives: ${alternatives}.`
          : `${providerLabel(input.requested)} is not configured, and no other model provider is configured.`,
      };
    }
    return { config: match, refusal: null };
  }
  const preferred = input.configured.find((item) => item.id === input.preference) ?? input.configured[0] ?? null;
  return { config: preferred, refusal: null };
}

function failureFromStatus(provider: ProviderId, model: string, status: number): CompletionResult {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      provider,
      model,
      code: "provider_auth",
      spoken: `${providerLabel(provider)} rejected the API credential. I did not switch providers.`,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      provider,
      model,
      code: "provider_rate_limit",
      spoken: `${providerLabel(provider)} is rate limiting requests. I did not switch providers.`,
    };
  }
  return {
    ok: false,
    provider,
    model,
    code: "provider_down",
    spoken: `${providerLabel(provider)} did not answer (HTTP ${status}). I did not switch providers.`,
  };
}

export async function completeWithProvider(
  request: CompletionRequest,
  config: ProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<CompletionResult> {
  if (config.id !== request.provider) {
    return {
      ok: false,
      provider: request.provider,
      model: null,
      code: "provider_missing",
      spoken: `The ${providerLabel(request.provider)} adapter was not the one configured for this call. I did not substitute another provider.`,
    };
  }
  try {
    if (config.id === "anthropic") {
      return await completeAnthropic(request, config, fetchImpl);
    }
    return await completeOpenAiCompatible(request, config, fetchImpl);
  } catch {
    return {
      ok: false,
      provider: config.id,
      model: config.model,
      code: "provider_down",
      spoken: `${providerLabel(config.id)} could not be reached. I did not switch providers.`,
    };
  }
}

async function completeOpenAiCompatible(
  request: CompletionRequest,
  config: ProviderConfig,
  fetchImpl: typeof fetch,
): Promise<CompletionResult> {
  const base = config.id === "xai" ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const response = await fetchImpl(base, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_completion_tokens: request.maxTokens,
      messages: [{ role: "system", content: request.system }, ...request.messages],
    }),
  });
  if (!response.ok) return failureFromStatus(config.id, config.model, response.status);
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) {
    return {
      ok: false,
      provider: config.id,
      model: config.model,
      code: "provider_down",
      spoken: `${providerLabel(config.id)} returned an empty answer. I did not switch providers.`,
    };
  }
  return {
    ok: true,
    provider: config.id,
    model: config.model,
    content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

async function completeAnthropic(
  request: CompletionRequest,
  config: ProviderConfig,
  fetchImpl: typeof fetch,
): Promise<CompletionResult> {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": process.env.ANTHROPIC_VERSION?.trim() || "2026-10-21",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages,
    }),
  });
  if (!response.ok) return failureFromStatus(config.id, config.model, response.status);
  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const content = (data.content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!content) {
    return {
      ok: false,
      provider: config.id,
      model: config.model,
      code: "provider_down",
      spoken: "Anthropic Claude returned an empty answer. I did not switch providers.",
    };
  }
  return {
    ok: true,
    provider: "anthropic",
    model: config.model,
    content,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}
