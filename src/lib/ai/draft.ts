import { completeChat } from "@/lib/ai/llm-client";
import { resolveLlmConfig } from "@/lib/ai/llm-config";
import type { TenantScope } from "@/lib/tenant";

export type DraftGenerationInput = {
  scope: TenantScope;
  subject: string;
  bodySnippet: string;
  /** Only included when the mailbox owner has granted VOICE_LEARNING consent */
  voiceProfile?: {
    greeting?: string | null;
    signature?: string | null;
    tone?: string | null;
    learningEnabled: boolean;
    consentGranted: boolean;
  } | null;
  /** Optional fetch override for tests */
  fetchImpl?: typeof fetch;
};

export type DraftGenerationResult = {
  ok: boolean;
  stub: true;
  subject: string;
  bodyText: string;
  promptContext: {
    organizationId: string;
    workspaceId: string;
    mailboxId?: string;
    voiceUsed: boolean;
    llmProvider: string;
    llmReady: boolean;
  };
};

/**
 * Stub AI draft generation.
 *
 * - Tenant ids are always included in prompt context (no silent cross-tenant leakage).
 * - Never uses silent global training data for personalization.
 * - Voice profile is applied only when consentGranted is true.
 * - Uses local LLM when LLM_PROVIDER + LLM_BASE_URL + LLM_MODEL are set; otherwise stub.
 * - Does not send mail.
 */
export async function generateDraft(
  input: DraftGenerationInput,
): Promise<DraftGenerationResult> {
  const { scope, subject, bodySnippet, voiceProfile } = input;
  const llmConfig = resolveLlmConfig();

  const voiceUsed = Boolean(
    voiceProfile?.consentGranted && voiceProfile.learningEnabled,
  );

  const toneHint =
    voiceUsed && voiceProfile?.tone
      ? `Match the owner's preferred tone: ${voiceProfile.tone}.`
      : "Use a clear, professional tone.";

  const signature =
    voiceUsed && voiceProfile?.signature
      ? `\n\n${voiceProfile.signature}`
      : "";

  const systemPrompt = [
    "You draft email replies for human review only. Never send mail.",
    "Do not train on or retain this content for global models.",
    `Tenant scope: ${scope.organizationId}/${scope.workspaceId}` +
      `${scope.mailboxId ? `/${scope.mailboxId}` : ""}.`,
    toneHint,
  ].join(" ");

  const userPrompt = [
    `Subject: ${subject}`,
    `Incoming snippet: ${bodySnippet.slice(0, 280) || "(no snippet)"}`,
    "Write a concise reply body only.",
  ].join("\n");

  const llm = await completeChat({
    config: llmConfig,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    fetchImpl: input.fetchImpl,
  });

  let bodyText: string;
  if (llm.ok && !llm.stub && llm.content) {
    bodyText = [
      llm.content,
      "",
      "— Generated for human review; not sent automatically.",
      signature,
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    // Deterministic local stub when LLM is not ready or request failed
    bodyText = [
      `[Draft stub — tenant ${scope.organizationId}/${scope.workspaceId}` +
        `${scope.mailboxId ? `/${scope.mailboxId}` : ""}` +
        (llmConfig.ready ? `; llm=${llmConfig.provider}` : "") +
        `]`,
      "",
      `Re: ${subject}`,
      "",
      `Thanks for your message. (${toneHint})`,
      "",
      `Regarding: ${bodySnippet.slice(0, 280) || "(no snippet)"}`,
      "",
      "— Generated for human review; not sent automatically.",
      signature,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return {
    ok: true,
    stub: true,
    subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
    bodyText,
    promptContext: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId,
      voiceUsed,
      llmProvider: llmConfig.provider,
      llmReady: llmConfig.ready,
    },
  };
}
