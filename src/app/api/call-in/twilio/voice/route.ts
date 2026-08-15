import { NextResponse } from "next/server";
import {
  answerCallInQuestionWithLlm,
  openingPrompt,
} from "@/lib/call-in/assistant";
import { product } from "@/lib/product";

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function twiml(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

/**
 * Twilio inbound voice webhook — fallback when VAPI is not used.
 * Prefer VAPI: POST /api/call-in/vapi/webhook (NEXT_PUBLIC_VAPI_CALL_IN_NUMBER).
 * Identifies caller by From number when CallInIdentity is configured;
 * unmatched callers hear an unrecognized-phone message (never demo emails in prod).
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const from = String(form.get("From") ?? "");
  const callSid = String(form.get("CallSid") ?? "");
  const speech = String(form.get("SpeechResult") ?? "").trim();
  const base =
    process.env.CALL_IN_PUBLIC_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  const gatherAction = `${base}/api/call-in/twilio/voice`;

  const { resolveSnapshotForCaller } = await import("@/lib/call-in/identity");
  const resolved = await resolveSnapshotForCaller(from);
  const snapshot = resolved.snapshot;

  if (!speech) {
    const open = openingPrompt(snapshot);
    const body = `
      <Say voice="Polly.Joanna">${xmlEscape(open)}</Say>
      <Gather input="speech" timeout="6" speechTimeout="auto" action="${xmlEscape(gatherAction)}" method="POST">
        <Say voice="Polly.Joanna">I am listening.</Say>
      </Gather>
      <Say voice="Polly.Joanna">I did not hear anything. Call ${xmlEscape(product.name)} again anytime.</Say>
    `;
    return new NextResponse(twiml(body), {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "X-Call-Sid": callSid,
        "X-From": from,
      },
    });
  }

  const answer = await answerCallInQuestionWithLlm({
    question: speech,
    snapshot,
  });
  if (answer.intent === "goodbye") {
    return new NextResponse(
      twiml(`<Say voice="Polly.Joanna">${xmlEscape(answer.spoken)}</Say><Hangup/>`),
      { headers: { "Content-Type": "text/xml; charset=utf-8" } },
    );
  }

  const body = `
    <Say voice="Polly.Joanna">${xmlEscape(answer.spoken)}</Say>
    <Gather input="speech" timeout="6" speechTimeout="auto" action="${xmlEscape(gatherAction)}" method="POST">
      <Say voice="Polly.Joanna">What else would you like to know?</Say>
    </Gather>
    <Say voice="Polly.Joanna">Goodbye. Call anytime.</Say>
  `;

  return new NextResponse(twiml(body), {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: `Configure Twilio voice webhook to POST here for ${product.name} anytime call-in.`,
    mock: process.env.MOCK_INTEGRATIONS === "true",
    inboundNumber: process.env.TWILIO_CALL_IN_NUMBER ?? null,
  });
}
