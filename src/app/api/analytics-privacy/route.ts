import { NextResponse } from "next/server";
import { z } from "zod";
import {
  applyAnalyticsPrivacyAction,
  defaultAnalyticsPrivacyState,
  type AnalyticsPrivacyState,
} from "@/lib/analytics/privacy-consent";
import { product } from "@/lib/product";

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("enable"),
    consentAcknowledged: z.boolean(),
  }),
  z.object({ type: z.literal("disable") }),
  z.object({ type: z.literal("revoke_consent") }),
]);

const bodySchema = z.object({
  action: actionSchema,
  /** Client may echo current state for mock/local persistence */
  state: z
    .object({
      analyticsEnabled: z.boolean(),
      consentGranted: z.boolean(),
      consentGrantedAt: z.string().nullable(),
    })
    .optional(),
});

/**
 * Analytics privacy API — enable is consent-gated; default is always off.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    state: defaultAnalyticsPrivacyState(),
    message: `${product.name} never enables product analytics silently.`,
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid analytics privacy request." },
      { status: 400 },
    );
  }

  const current: AnalyticsPrivacyState =
    parsed.data.state ?? defaultAnalyticsPrivacyState();
  const result = applyAnalyticsPrivacyAction(current, parsed.data.action);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const messages: Record<string, string> = {
    enable:
      "Product analytics enabled. Usage signals stay account-scoped and can be turned off anytime.",
    disable: "Product analytics paused. Consent is kept until you revoke it.",
    revoke_consent:
      "Analytics consent revoked. Collection is off and will not resume until you opt in again.",
  };

  return NextResponse.json({
    ok: true,
    state: result.state,
    message: messages[parsed.data.action.type],
    persisted: process.env.MOCK_INTEGRATIONS !== "true",
  });
}
