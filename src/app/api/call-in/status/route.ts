import { NextResponse } from "next/server";
import {
  callInReadinessFromEnv,
  humanizeVapiError,
} from "@/lib/call-in/vapi-errors";

/**
 * Patron-facing call-in readiness (no raw VAPI errors).
 */
export async function GET() {
  const callInNumber =
    process.env.NEXT_PUBLIC_VAPI_CALL_IN_NUMBER?.trim() ||
    process.env.NEXT_PUBLIC_TWILIO_CALL_IN_NUMBER?.trim() ||
    null;
  const assistantId = process.env.VAPI_ASSISTANT_ID?.trim() || null;
  const readiness = callInReadinessFromEnv({
    callInNumber,
    assistantId,
  });

  return NextResponse.json({
    ok: true,
    numberConfigured: readiness.numberConfigured,
    assistantLinked: readiness.assistantLinked,
    showSetupBanner: readiness.showSetupBanner,
    patronMessage: readiness.patronMessage,
    /** Always mapped — never raw operator text */
    mappedError: humanizeVapiError(
      readiness.showSetupBanner
        ? "assistant not linked to phone number"
        : null,
    ),
  });
}
