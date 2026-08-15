import { NextResponse } from "next/server";
import { product } from "@/lib/product";
import {
  handleVapiCallInWebhook,
  verifyVapiWebhookSecret,
} from "@/lib/call-in/vapi-webhook";

export const runtime = "nodejs";

/**
 * VAPI server-url webhook — primary phone call-in path for Inbox Chief.
 * Handles tool-calls + end-of-call. Never sends email.
 *
 * Production URL:
 *   https://inbox-chief-kappa.vercel.app/api/call-in/vapi/webhook
 */
export async function POST(request: Request) {
  const auth = verifyVapiWebhookSecret(request.headers);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = await handleVapiCallInWebhook(body);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[vapi-call-in] webhook error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook handler failed" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    product: product.name,
    message: `Configure VAPI assistant server URL to POST here for ${product.name} anytime call-in.`,
    inboundNumber:
      process.env.NEXT_PUBLIC_VAPI_CALL_IN_NUMBER ??
      process.env.VAPI_PHONE_NUMBER_ID ??
      null,
    assistantId: process.env.VAPI_ASSISTANT_ID ?? null,
    mock: process.env.MOCK_INTEGRATIONS === "true",
    neverSendsEmail: true,
  });
}
