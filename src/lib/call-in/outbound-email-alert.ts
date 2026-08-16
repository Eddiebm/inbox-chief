import { loadCallMinuteUsageForOrg } from "@/lib/billing/call-usage-server";
import { loadEmailCallPlan } from "@/lib/call-in/email-call-plan";
import { isPrimaryInboxMessage } from "@/lib/call-in/primary-inbox";
import type { PrismaClient } from "@/generated/prisma/client";

export const OUTBOUND_EMAIL_CALL_COOLDOWN_MS = 15 * 60 * 1000;
const VAPI_CALLS_URL = "https://api.vapi.ai/call";
const VAPI_PHONE_NUMBERS_URL = "https://api.vapi.ai/phone-number";
const DEFAULT_VAPI_ASSISTANT_ID = "7adc3d95-5abb-4a82-adbe-2dec5628fa19";
const DEFAULT_OUTBOUND_NUMBER = "+14057169240";

export type NewMailForOutboundAlert = {
  fromAddress: string;
  subject?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
  categoryName?: string | null;
  metadata?: unknown;
  receivedAt?: Date;
};

export type OutboundAlertSkipReason =
  | "no_new_primary"
  | "toggle_off"
  | "no_phone"
  | "mailbox_disconnected"
  | "cooldown"
  | "minute_cap"
  | "plan_required"
  | "vapi_not_configured";

export function countNewPrimaryForOutboundAlert(
  messages: NewMailForOutboundAlert[],
): number {
  return messages.filter(isPrimaryInboxMessage).length;
}

function spokenSender(fromAddress: string): string {
  const named = fromAddress.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/)?.[1]?.trim();
  if (named) return named.slice(0, 80);
  const address = fromAddress.match(/<([^>]+)>/)?.[1] ?? fromAddress;
  const local = address.split("@")[0]?.trim() || "the sender";
  return local.replace(/[._-]+/g, " ").replace(/\s+/g, " ").slice(0, 80);
}

export function buildOutboundEmailOpening(
  messages: NewMailForOutboundAlert[],
): string {
  const primary = messages
    .filter(isPrimaryInboxMessage)
    .sort(
      (a, b) =>
        (b.receivedAt?.getTime() ?? 0) - (a.receivedAt?.getTime() ?? 0),
    );
  const newest = primary[0];
  const count = primary.length;
  const plural = count === 1 ? "email" : "emails";
  const sender = newest ? spokenSender(newest.fromAddress) : "the sender";
  const subject = newest?.subject?.trim().replace(/\s+/g, " ").slice(0, 120);
  const about = subject ? ` about ${subject}` : "";
  return `You have ${count} new ${plural} in Primary. The newest is from ${sender}${about}. Say read the new ones.`;
}

export function outboundAlertEligibility(input: {
  newPrimaryCount: number;
  enabled: boolean;
  hasPhone: boolean;
  mailboxConnected: boolean;
  lastCalledAt: Date | null;
  atMinuteCap: boolean;
  now?: Date;
  cooldownMs?: number;
}): { eligible: true } | { eligible: false; reason: OutboundAlertSkipReason } {
  if (input.newPrimaryCount <= 0) return { eligible: false, reason: "no_new_primary" };
  if (!input.enabled) return { eligible: false, reason: "toggle_off" };
  if (!input.hasPhone) return { eligible: false, reason: "no_phone" };
  if (!input.mailboxConnected) {
    return { eligible: false, reason: "mailbox_disconnected" };
  }
  if (input.atMinuteCap) return { eligible: false, reason: "minute_cap" };

  const now = input.now ?? new Date();
  const cooldownMs = input.cooldownMs ?? OUTBOUND_EMAIL_CALL_COOLDOWN_MS;
  if (
    input.lastCalledAt &&
    now.getTime() - input.lastCalledAt.getTime() < cooldownMs
  ) {
    return { eligible: false, reason: "cooldown" };
  }
  return { eligible: true };
}

type PrismaForOutboundAlert = Pick<
  PrismaClient,
  "callInIdentity" | "subscription"
>;

async function resolveVapiPhoneNumberId(apiKey: string): Promise<string | null> {
  const configured = process.env.VAPI_PHONE_NUMBER_ID?.trim();
  if (configured) return configured;

  const response = await fetch(VAPI_PHONE_NUMBERS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as Array<{ id?: string; number?: string }>;
  const outboundNumber =
    process.env.NEXT_PUBLIC_VAPI_CALL_IN_NUMBER?.trim() || DEFAULT_OUTBOUND_NUMBER;
  return body.find((phone) => phone.number === outboundNumber)?.id ?? null;
}

async function createVapiOutboundCall(input: {
  phoneE164: string;
  newPrimaryCount: number;
  firstMessage: string;
}): Promise<{ ok: true; callId: string | null } | { ok: false }> {
  const apiKey = process.env.VAPI_API_KEY?.trim();
  if (!apiKey) return { ok: false };
  const phoneNumberId = await resolveVapiPhoneNumberId(apiKey);
  if (!phoneNumberId) return { ok: false };

  const assistantId =
    process.env.VAPI_ASSISTANT_ID?.trim() || DEFAULT_VAPI_ASSISTANT_ID;
  const response = await fetch(VAPI_CALLS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistantId,
      phoneNumberId,
      customer: { number: input.phoneE164 },
      assistantOverrides: { firstMessage: input.firstMessage },
      metadata: {
        source: "new_primary_email_alert",
        newPrimaryCount: input.newPrimaryCount,
        neverSendEmail: true,
      },
    }),
  });
  if (!response.ok) {
    console.error("[outbound-email-alert] VAPI call create failed", {
      status: response.status,
      body: (await response.text()).slice(0, 500),
    });
    return { ok: false };
  }
  const body = (await response.json()) as { id?: string };
  return { ok: true, callId: body.id ?? null };
}

/**
 * Evaluate one tenant-scoped identity after Gmail sync and create at most one
 * outbound call per cooldown. The timestamp reservation prevents burst races.
 */
export async function triggerOutboundEmailAlert(input: {
  prisma: PrismaForOutboundAlert;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
  mailboxConnected: boolean;
  newMessages: NewMailForOutboundAlert[];
  now?: Date;
}): Promise<
  | { called: true; newPrimaryCount: number; callId: string | null }
  | { called: false; reason: OutboundAlertSkipReason; newPrimaryCount: number }
> {
  const newPrimaryCount = countNewPrimaryForOutboundAlert(input.newMessages);
  if (newPrimaryCount === 0) {
    return { called: false, reason: "no_new_primary", newPrimaryCount };
  }

  const identity = await input.prisma.callInIdentity.findFirst({
    where: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      userId: input.userId,
      enabled: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const plan = await loadEmailCallPlan(input.prisma, input.organizationId);
  if (!plan.allowsEmailCalls) {
    return { called: false, reason: "plan_required", newPrimaryCount };
  }
  const usage = identity?.callOnNewPrimary
    ? await loadCallMinuteUsageForOrg(input.organizationId)
    : null;
  const decision = outboundAlertEligibility({
    newPrimaryCount,
    enabled: identity?.callOnNewPrimary ?? false,
    hasPhone: Boolean(identity?.phoneE164),
    mailboxConnected: input.mailboxConnected,
    lastCalledAt: identity?.lastOutboundEmailCallAt ?? null,
    // Hard cap: never place a new billable outbound alert at/over the cap.
    atMinuteCap: usage?.hardCapReached ?? false,
    now: input.now,
  });
  if (!decision.eligible) {
    return { called: false, reason: decision.reason, newPrimaryCount };
  }
  if (!process.env.VAPI_API_KEY?.trim()) {
    return { called: false, reason: "vapi_not_configured", newPrimaryCount };
  }

  const now = input.now ?? new Date();
  const cooldownCutoff = new Date(now.getTime() - OUTBOUND_EMAIL_CALL_COOLDOWN_MS);
  const reserved = await input.prisma.callInIdentity.updateMany({
    where: {
      id: identity!.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      userId: input.userId,
      callOnNewPrimary: true,
      OR: [
        { lastOutboundEmailCallAt: null },
        { lastOutboundEmailCallAt: { lte: cooldownCutoff } },
      ],
    },
    data: { lastOutboundEmailCallAt: now },
  });
  if (reserved.count !== 1) {
    return { called: false, reason: "cooldown", newPrimaryCount };
  }

  const created = await createVapiOutboundCall({
    phoneE164: identity!.phoneE164,
    newPrimaryCount,
    firstMessage: buildOutboundEmailOpening(input.newMessages),
  });
  if (!created.ok) {
    await input.prisma.callInIdentity.updateMany({
      where: {
        id: identity!.id,
        organizationId: input.organizationId,
        lastOutboundEmailCallAt: now,
      },
      data: { lastOutboundEmailCallAt: identity!.lastOutboundEmailCallAt },
    });
    return { called: false, reason: "vapi_not_configured", newPrimaryCount };
  }
  return { called: true, newPrimaryCount, callId: created.callId };
}
