import { NextResponse } from "next/server";
import { callInReadinessFromEnv } from "@/lib/call-in/vapi-errors";
import { isGmailOAuthConfigured } from "@/lib/gmail/config";
import { isGoogleOauthPublished } from "@/lib/google-oauth-publication";

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
      process.env.STRIPE_PRICE_PRO?.trim(),
  );

  const checks = {
    database,
    gmailOauthConfigured: gmailOauth,
    googleOauthPublished: isGoogleOauthPublished(),
    vapiNumberConfigured: vapi.numberConfigured,
    vapiAssistantLinked: vapi.assistantLinked,
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
    checks.vapiAssistantLinked;

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
