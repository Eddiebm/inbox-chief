import { NextResponse } from "next/server";
import { isTwilioConfigured } from "@/lib/call-in/twilio-signature";
import { isVapiWebhookAuthConfigured } from "@/lib/call-in/vapi-webhook";
import { callInReadinessFromEnv } from "@/lib/call-in/vapi-errors";
import { isGmailOAuthConfigured } from "@/lib/gmail/config";
import { isGoogleOauthPublished } from "@/lib/google-oauth-publication";
import { findInsecureProductionSecrets } from "@/lib/security/env-guard";
import { isProductionRuntime } from "@/lib/security/secrets";

export const runtime = "nodejs";

/**
 * Lightweight operator health — no secrets, presence flags only.
 * Public enough for uptime checks; does not expose key values.
 */
export async function GET() {
  const gmailOauth = isGmailOAuthConfigured();
  const vapi = callInReadinessFromEnv({
    callInNumber: process.env.NEXT_PUBLIC_VAPI_CALL_IN_NUMBER,
    assistantId: process.env.VAPI_ASSISTANT_ID,
  });

  let database: "ok" | "missing" | "error" = "missing";
  if (process.env.DATABASE_URL?.trim()) {
    if (process.env.MOCK_INTEGRATIONS === "true") {
      database = "missing";
    } else {
      try {
        const { getNodePrisma } = await import("@/lib/db-node");
        const prisma = getNodePrisma();
        await prisma.$queryRaw`SELECT 1`;
        database = "ok";
      } catch {
        database = "error";
      }
    }
  }

  const stripeSecret = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  const stripeWebhook = Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim());
  const stripePrices = Boolean(
    process.env.STRIPE_PRICE_PATRON?.trim() &&
      process.env.STRIPE_PRICE_PRO?.trim() &&
      process.env.STRIPE_PRICE_MINUTES_30?.trim() &&
      process.env.STRIPE_PRICE_MINUTES_60?.trim() &&
      process.env.STRIPE_PRICE_MINUTES_120?.trim(),
  );

  const insecureSecrets = findInsecureProductionSecrets();

  const checks = {
    database,
    gmailOauthConfigured: gmailOauth,
    googleOauthPublished: isGoogleOauthPublished(),
    vapiNumberConfigured: vapi.numberConfigured,
    vapiAssistantLinked: vapi.assistantLinked,
    vapiWebhookAuthConfigured: isVapiWebhookAuthConfigured(),
    twilioSignatureValidationConfigured: isTwilioConfigured(),
    sessionSecretsConfigured: insecureSecrets.length === 0,
    stripe: {
      secretKey: stripeSecret,
      webhookSecret: stripeWebhook,
      prices: stripePrices,
      liveReady: stripeSecret && stripeWebhook && stripePrices,
    },
    mockIntegrations: process.env.MOCK_INTEGRATIONS === "true",
  };

  const alerts: string[] = [];
  if (!checks.gmailOauthConfigured) {
    alerts.push("Gmail OAuth is not configured.");
  }
  if (!checks.vapiAssistantLinked) {
    alerts.push("VAPI assistant is not linked (VAPI_ASSISTANT_ID missing).");
  }
  if (!checks.vapiWebhookAuthConfigured) {
    alerts.push(
      "VAPI webhook authentication is not configured — set VAPI_WEBHOOK_SECRET here and in the VAPI dashboard. The webhook refuses all calls in production until it is set.",
    );
  }
  if (!checks.sessionSecretsConfigured) {
    alerts.push(
      `Session/token secrets are unsafe: ${insecureSecrets
        .map((s) => `${s.name} (${s.reason})`)
        .join(", ")}.`,
    );
  }
  if (checks.database !== "ok") {
    alerts.push(
      checks.database === "error"
        ? "Database check failed."
        : "Database not ready (DATABASE_URL / MOCK_INTEGRATIONS).",
    );
  }

  const ok =
    checks.database === "ok" &&
    checks.gmailOauthConfigured &&
    checks.vapiAssistantLinked &&
    checks.vapiWebhookAuthConfigured &&
    (checks.sessionSecretsConfigured || !isProductionRuntime());

  return NextResponse.json(
    {
      ok,
      service: "inbox-chief",
      checks,
      alerts,
    },
    { status: ok ? 200 : 503 },
  );
}
