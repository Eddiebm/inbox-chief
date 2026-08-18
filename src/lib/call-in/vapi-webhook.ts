import { openingPrompt, isUnrecognizedCaller } from "@/lib/call-in/assistant";
import { recordVapiEndOfCallCost } from "@/lib/call-in/call-cost";
import { resolveSnapshotForCaller } from "@/lib/call-in/identity";
import {
  buildCallInAssistantPayload,
  handleCallInTool,
  isForbiddenSendTool,
  neverSendSpoken,
} from "@/lib/call-in/vapi-tools";
import { resolveCallInVoiceForUser } from "@/lib/call-in/voice-preference";
import {
  DEFAULT_CALL_IN_SPEECH_RATE,
  type CallInSpeechRate,
} from "@/lib/call-in/speech-rate";
import { loadCallMinuteUsageForOrg } from "@/lib/billing/call-usage-server";
import {
  shouldMeterCallInUsage,
  USAGE_UNAVAILABLE_SPOKEN,
} from "@/lib/billing/call-usage";
import {
  googleConsentGuidanceSpoken,
  isGoogleOauthPublished,
} from "@/lib/google-oauth-publication";
import { product } from "@/lib/product";
import {
  consumeConnectedTip,
  getProvisioningStatusForPhone,
} from "@/lib/provisioning";
import {
  isPlaceholderSecret,
  isProductionRuntime,
  secretsMatch,
} from "@/lib/security/secrets";

export type VapiToolCall = {
  id: string;
  name?: string;
  function?: { name?: string; arguments?: Record<string, unknown> | string };
  arguments?: Record<string, unknown> | string;
  parameters?: Record<string, unknown> | string;
};

export type VapiWebhookMessage = {
  type?: string;
  call?: {
    id?: string;
    /** Only `number` is used for identity. Ignore `name` / CNAM for speech. */
    customer?: { number?: string; name?: string };
    phoneNumber?: { number?: string };
    cost?: number;
    durationSeconds?: number;
    endedReason?: string;
  };
  toolCallList?: VapiToolCall[];
  toolWithToolCallList?: Array<{
    toolCall?: VapiToolCall;
    function?: { name?: string; arguments?: Record<string, unknown> | string };
  }>;
  artifact?: { transcript?: string };
  summary?: string;
  endedReason?: string;
  cost?: number;
  durationSeconds?: number;
  durationMs?: number;
  costBreakdown?: Record<string, unknown>;
  startedAt?: string;
  endedAt?: string;
  status?: string;
};

function asArgs(
  value: Record<string, unknown> | string | undefined,
): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value;
}

export function parseToolCall(tc: VapiToolCall): {
  id: string;
  name: string;
  args: Record<string, unknown>;
} {
  const name = tc.name ?? tc.function?.name ?? "unknown";
  const args = asArgs(tc.arguments ?? tc.parameters ?? tc.function?.arguments);
  return { id: tc.id, name, args };
}

export function extractCallerNumber(message: VapiWebhookMessage): string | null {
  const call = message.call;
  const root = message as {
    customer?: { number?: string };
    phoneNumber?: { number?: string };
    from?: string;
  };
  const candidates = [
    call?.customer?.number,
    call?.phoneNumber?.number,
    root.customer?.number,
    root.phoneNumber?.number,
    root.from,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

export type VapiWebhookHandleResult =
  | { results: Array<{ toolCallId: string; result: string }> }
  | {
      /** Dynamic assistant override for assistant-request (unmatched opening, etc.) */
      assistant?: Record<string, unknown>;
      ok?: true;
      eventType?: string;
      callId?: string | null;
      note?: string;
      costRecorded?: boolean;
      costUsd?: number | null;
    };

/**
 * Opening speech. Only the hard cap replaces the greeting — never prepend soft
 * minute warnings; billable tools fail closed only at a true hard cap.
 */
async function openingWithUsageWarning(
  snapshot: Awaited<
    ReturnType<typeof resolveSnapshotForCaller>
  >["snapshot"],
): Promise<string> {
  const base = openingPrompt(snapshot);
  if (
    isUnrecognizedCaller(snapshot) ||
    !shouldMeterCallInUsage(snapshot)
  ) {
    return base;
  }
  try {
    const usage = await loadCallMinuteUsageForOrg(snapshot.organizationId);
    if (usage.hardCapReached) return usage.spokenCapReached;
    return base;
  } catch (err) {
    console.error("[call-in] minute usage load failed during opening", err);
    return base;
  }
}

/**
 * Handle VAPI server-url / webhook payloads for Inbox Chief call-in.
 * Tool results are speakable status strings. Never sends email.
 */
export async function handleVapiCallInWebhook(
  body: unknown,
): Promise<VapiWebhookHandleResult> {
  const root = (body && typeof body === "object" ? body : {}) as {
    message?: VapiWebhookMessage;
  };
  const message = root.message ?? (body as VapiWebhookMessage);
  const type = message?.type ?? "unknown";
  const callId = message?.call?.id ?? null;
  const callerPhone = extractCallerNumber(message);

  if (type === "tool-calls") {
    const resolved = await resolveSnapshotForCaller(callerPhone);
    if (resolved.matched && resolved.userId) {
      try {
        const voice = await resolveCallInVoiceForUser({
          userId: resolved.userId,
          organizationId: resolved.snapshot.organizationId,
        });
        resolved.snapshot.voiceTier = voice.effective;
      } catch {
        resolved.snapshot.voiceTier = "standard";
      }
    }

    let hardCap: { reached: boolean; spoken: string } | null = null;
    if (resolved.matched && shouldMeterCallInUsage(resolved.snapshot)) {
      try {
        const usage = await loadCallMinuteUsageForOrg(resolved.snapshot.organizationId);
        if (usage.hardCapReached) {
          // Hard stop: deny billable tools; speak the exhausted message.
          hardCap = { reached: true, spoken: usage.spokenCapReached };
        }
      } catch (err) {
        // Fail closed. If the balance cannot be read we do not know whether
        // this call is paid for, and serving it anyway turns a database blip
        // into unmetered VAPI spend. Setup/status tools stay available.
        console.error(
          "[call-in] minute usage load failed; denying billable tools",
          err,
        );
        hardCap = { reached: true, spoken: USAGE_UNAVAILABLE_SPOKEN };
      }
    }

    const toolCallList =
      message.toolCallList ??
      (message.toolWithToolCallList ?? [])
        .map((row) => row.toolCall)
        .filter((tc): tc is VapiToolCall => Boolean(tc?.id));

    const results: Array<{ toolCallId: string; result: string }> = [];

    for (const tc of toolCallList) {
      const parsed = parseToolCall(tc);
      if (isForbiddenSendTool(parsed.name)) {
        results.push({
          toolCallId: parsed.id,
          result: neverSendSpoken(),
        });
        continue;
      }
      try {
        const handled = await handleCallInTool({
          name: parsed.name,
          args: parsed.args,
          snapshot: resolved.snapshot,
          requestedById: resolved.userId,
          callerPhone,
          callInIdentityId: resolved.callInIdentityId,
          callId,
          hardCap,
        });
        // Only the explicit second-stage confirmation tool may report a send.
        if (handled.emailSent && parsed.name !== "confirm_email_send") {
          results.push({
            toolCallId: parsed.id,
            result: neverSendSpoken(),
          });
          continue;
        }
        results.push({
          toolCallId: parsed.id,
          result: handled.spoken.replace(/\n/g, " "),
        });
      } catch {
        results.push({
          toolCallId: parsed.id,
          result:
            "I hit a temporary error. Ask for a briefing or connection status.",
        });
      }
    }

    return { results };
  }

  if (type === "assistant-request") {
    // Identity uses customer.number only — never customer.name / CNAM for speech.
    const resolved = await resolveSnapshotForCaller(callerPhone);
    let spoken = await openingWithUsageWarning(resolved.snapshot);
    if (resolved.snapshot.connectionStatus === "error") {
      spoken = resolved.snapshot.securityNote;
    }
    const provisioning = await getProvisioningStatusForPhone(callerPhone);
    if (provisioning?.status === "needs_google_test_user") {
      spoken =
        "Your account and phone are saved. Inbox Chief support still needs to enable this Gmail address once. You do not need to change any Google settings. Then open the link we sent or use your short code.";
    } else if (provisioning?.status === "needs_google_consent") {
      const testingGuidance = googleConsentGuidanceSpoken(
        isGoogleOauthPublished(),
      );
      spoken = `Your mailbox isn't connected yet. Open the link we sent or use your short code. Your phone is already saved.${testingGuidance ? ` ${testingGuidance}` : ""}`;
    } else if (
      provisioning?.status === "connected" &&
      resolved.userId &&
      (await consumeConnectedTip(resolved.userId))
    ) {
      spoken = `You're connected. Say read my emails. ${spoken}`;
    }
    const baseUrl =
      process.env.CALL_IN_PUBLIC_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      "https://inboxchief.email";

    let voiceTier: "standard" | "premium" = "standard";
    let speechRate: CallInSpeechRate = DEFAULT_CALL_IN_SPEECH_RATE;
    if (resolved.matched && resolved.userId) {
      try {
        const voice = await resolveCallInVoiceForUser({
          userId: resolved.userId,
          organizationId: resolved.snapshot.organizationId,
        });
        voiceTier = voice.effective;
        speechRate = voice.speechRate;
        if (voice.spokenTip) {
          spoken = `${spoken} ${voice.spokenTip}`;
        }
      } catch (err) {
        console.warn("[call-in] voice resolve failed; using standard", err);
      }
    }

    const payload = buildCallInAssistantPayload(baseUrl, {
      voiceTier,
      speechRate,
      firstMessage: spoken,
    });
    if (isUnrecognizedCaller(resolved.snapshot)) {
      payload.name = `${product.name} — Unrecognized caller`;
    }
    return {
      assistant: payload,
      ok: true,
      eventType: type,
      callId,
      note: spoken,
    };
  }

  if (type === "conversation-update") {
    const resolved = await resolveSnapshotForCaller(callerPhone);
    return {
      ok: true,
      eventType: type,
      callId,
      note: await openingWithUsageWarning(resolved.snapshot),
    };
  }

  if (type === "end-of-call-report") {
    const costResult = await recordVapiEndOfCallCost(body);
    return {
      ok: true,
      eventType: type,
      callId,
      note: "Call ended. Any email send required an explicit read-back confirmation.",
      costRecorded: costResult.recorded,
      costUsd: costResult.costUsd ?? null,
    };
  }

  if (type === "status-update") {
    return {
      ok: true,
      eventType: type,
      callId,
    };
  }

  return { ok: true, eventType: type, callId };
}

/** True when VAPI_WEBHOOK_SECRET is set to a usable value. Surfaced on /api/health. */
export function isVapiWebhookAuthConfigured(): boolean {
  return !isPlaceholderSecret(process.env.VAPI_WEBHOOK_SECRET);
}

/**
 * Authenticate a VAPI server-url request.
 *
 * An unset secret must never mean "allow everyone" in production: this webhook
 * reads a patron's mailbox aloud and spends VAPI minutes, so an open endpoint
 * is both a data leak and an unbounded bill. Locally (or in mock mode) the
 * relaxed behaviour stays so `next dev` works without extra setup.
 */
export function verifyVapiWebhookSecret(
  headers: Headers,
): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.VAPI_WEBHOOK_SECRET?.trim();

  if (isPlaceholderSecret(expected)) {
    if (isProductionRuntime()) {
      console.error(
        "[vapi-call-in] rejected webhook: VAPI_WEBHOOK_SECRET is not configured",
      );
      return {
        ok: false,
        status: 401,
        error: "Webhook authentication is not configured.",
      };
    }
    return { ok: true };
  }

  const provided =
    headers.get("x-vapi-secret")?.trim() ||
    headers.get("x-webhook-secret")?.trim() ||
    "";
  if (secretsMatch(provided, expected)) return { ok: true };
  return { ok: false, status: 401, error: "Invalid webhook secret" };
}
