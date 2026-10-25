/**
 * Create or update the Inbox Chief VAPI anytime call-in assistant,
 * then assign it as the inbound assistant on +14057169240 (or VAPI_PHONE_NUMBER_ID).
 *
 * Requires VAPI_API_KEY.
 *
 * Usage:
 *   VAPI_API_KEY=... npx tsx scripts/vapi-setup-call-in.ts
 *   # or: npm run vapi:setup-call-in
 *
 * Optional:
 *   VAPI_ASSISTANT_ID=...              # update existing assistant
 *   VAPI_PHONE_NUMBER_ID=...           # skip phone lookup
 *   NEXT_PUBLIC_VAPI_CALL_IN_NUMBER=... # E.164 to find/assign (default +14057169240)
 *   CALL_IN_PUBLIC_BASE_URL=https://inboxchief.email
 */
import "dotenv/config";
import { buildCallInAssistantPayload, vapiWebhookOrigin } from "../src/lib/call-in/vapi-tools";

const VAPI_BASE = "https://api.vapi.ai";
const DEFAULT_PROD_BASE = "https://www.inboxchief.email";
const DEFAULT_CALL_IN_NUMBER = "+14057169240";

type VapiPhoneNumber = {
  id: string;
  number?: string;
  name?: string;
  assistantId?: string | null;
  serverUrl?: string | null;
  server?: { url?: string; headers?: Record<string, string> } | null;
};

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function normalizeE164(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

async function vapiJson<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    method,
    headers: authHeaders(apiKey),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`VAPI ${method} ${path} failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/**
 * PATCH must send x-vapi-secret whenever production already has one.
 * An empty local env would otherwise replace `server` without headers and
 * 401 every live tool-call.
 */
async function resolveWebhookSecret(
  apiKey: string,
  existingAssistantId: string | undefined,
): Promise<string | null> {
  const fromEnv = process.env.VAPI_WEBHOOK_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (!existingAssistantId) return null;
  try {
    const existing = await vapiJson<{
      server?: { headers?: Record<string, string> };
    }>(apiKey, "GET", `/assistant/${existingAssistantId}`);
    const headers = existing.server?.headers ?? {};
    const secret =
      headers["x-vapi-secret"]?.trim() || headers["X-Vapi-Secret"]?.trim();
    return secret || null;
  } catch (err) {
    console.warn("Could not read existing VAPI webhook secret from assistant", err);
    return null;
  }
}

async function findPhoneNumberId(
  apiKey: string,
  wantedE164: string,
): Promise<VapiPhoneNumber | null> {
  const list = await vapiJson<VapiPhoneNumber[]>(apiKey, "GET", "/phone-number");
  const wanted = normalizeE164(wantedE164);
  const match = list.find((p) => p.number && normalizeE164(p.number) === wanted);
  return match ?? null;
}

async function assignPhoneAssistant(
  apiKey: string,
  phoneNumberId: string,
  assistantId: string,
  serverUrl: string,
  webhookSecret: string | null,
): Promise<VapiPhoneNumber> {
  const webhookUrl = `${serverUrl.replace(/\/$/, "")}/api/call-in/vapi/webhook`;
  const server: { url: string; headers?: Record<string, string> } = {
    url: webhookUrl,
  };
  if (webhookSecret) {
    server.headers = { "x-vapi-secret": webhookSecret };
  }
  return vapiJson<VapiPhoneNumber>(apiKey, "PATCH", `/phone-number/${phoneNumberId}`, {
    assistantId,
    server,
  });
}

async function verifyPhoneAssistant(
  apiKey: string,
  phoneNumberId: string,
): Promise<VapiPhoneNumber> {
  return vapiJson<VapiPhoneNumber>(apiKey, "GET", `/phone-number/${phoneNumberId}`);
}

async function main() {
  const apiKey = process.env.VAPI_API_KEY?.trim();
  if (!apiKey) {
    console.log(`
VAPI_API_KEY is not set — cannot create/assign the assistant via API.

Steps for Eddie (API — preferred):
  1. Copy Private key from https://dashboard.vapi.ai → Organization → API Keys
  2. Run:
       VAPI_API_KEY=... npm run vapi:setup-call-in
  3. Paste printed VAPI_ASSISTANT_ID into Vercel Production env (optional but useful)

Steps for Eddie (Dashboard — if you prefer UI):
  1. Open https://dashboard.vapi.ai and sign in
  2. Left nav → Assistants → Create Assistant
       Name: Inbox Chief — Anytime Call-in
       Server URL: https://www.inboxchief.email/api/call-in/vapi/webhook
       Save / publish
  3. Left nav → Phone Numbers → click +1 (405) 716-9240
  4. Inbound Assistant / Assistant → select "Inbox Chief — Anytime Call-in"
  5. Save
  6. Re-test: call +1 (405) 716-9240 from your registered phone
`);
    process.exit(0);
  }

  const serverUrl = vapiWebhookOrigin(
    process.env.CALL_IN_PUBLIC_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      DEFAULT_PROD_BASE,
  );

  const callInNumber = normalizeE164(
    process.env.NEXT_PUBLIC_VAPI_CALL_IN_NUMBER?.trim() || DEFAULT_CALL_IN_NUMBER,
  );

  const existingId = process.env.VAPI_ASSISTANT_ID?.trim();
  const webhookSecret = await resolveWebhookSecret(apiKey, existingId);
  if (webhookSecret && !process.env.VAPI_WEBHOOK_SECRET?.trim()) {
    process.env.VAPI_WEBHOOK_SECRET = webhookSecret;
  }

  const payload = buildCallInAssistantPayload(serverUrl, {
    // Dashboard default = Standard (Cartesia). Live calls override via assistant-request
    // to Premium (ElevenLabs) for Pro patrons who keep the Premium preference.
    voiceTier: "standard",
  });

  console.log(`Using server URL: ${serverUrl}/api/call-in/vapi/webhook`);
  console.log(`Target inbound number: ${callInNumber}`);

  let action: "created" | "updated";
  let assistantId: string;

  if (existingId) {
    await vapiJson(apiKey, "PATCH", `/assistant/${existingId}`, payload);
    action = "updated";
    assistantId = existingId;
  } else {
    const data = await vapiJson<{ id: string }>(apiKey, "POST", "/assistant", payload);
    action = "created";
    assistantId = data.id;
  }

  console.log(`\n✓ Assistant ${action}: ${assistantId}`);
  console.log(`\nAdd to Vercel / .env:\nVAPI_ASSISTANT_ID=${assistantId}`);

  let phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID?.trim() || "";
  let phone: VapiPhoneNumber | null = null;

  if (phoneNumberId) {
    phone = { id: phoneNumberId };
  } else {
    console.log(`\nLooking up phone number ${callInNumber}…`);
    phone = await findPhoneNumberId(apiKey, callInNumber);
    if (!phone) {
      console.warn(
        `Could not find ${callInNumber} in this VAPI org. Assign manually in the dashboard.`,
      );
      process.exit(1);
    }
    phoneNumberId = phone.id;
    console.log(`Found phone number id: ${phoneNumberId}`);
  }

  const assigned = await assignPhoneAssistant(
    apiKey,
    phoneNumberId,
    assistantId,
    serverUrl,
    webhookSecret,
  );
  console.log(`✓ Assigned phone ${phoneNumberId} → assistant ${assistantId}`);

  const verified = await verifyPhoneAssistant(apiKey, phoneNumberId);
  if (verified.assistantId !== assistantId) {
    throw new Error(
      `Verify failed: phone ${phoneNumberId} assistantId=${verified.assistantId ?? "null"} (expected ${assistantId})`,
    );
  }

  console.log(`
✓ Verified GET /phone-number/${phoneNumberId}
  number:      ${verified.number ?? callInNumber}
  assistantId: ${verified.assistantId}
  server:      ${verified.server?.url ?? "missing"}

Eddie re-test:
  1. From the phone registered in Inbox Chief Settings → Anytime call-in
  2. Dial +1 (405) 716-9240
  3. Ask: "Read my emails" / "Give me a briefing" / "What needs attention?"
  4. Confirm each email is read aloud (From, Subject, then message/preview), then offered next
`);

  // Keep assigned in scope for typecheck silence if unused in edge paths
  void assigned;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
