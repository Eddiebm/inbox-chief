import { NextResponse } from "next/server";
import { z } from "zod";
import {
  defaultAnalyticsPrivacyState,
  type AnalyticsPrivacyState,
} from "@/lib/analytics/privacy-consent";
import { gateAnalyticsEvent } from "@/lib/analytics/track";

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  properties: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
  organizationId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  /** Client echoes privacy state; server never assumes opt-in */
  state: z
    .object({
      analyticsEnabled: z.boolean(),
      consentGranted: z.boolean(),
      consentGrantedAt: z.string().nullable(),
    })
    .optional(),
});

/**
 * Opt-in analytics ingest stub.
 * Rejects (tracked: false) unless both analyticsEnabled and consentGranted.
 * Tenant ids required together when either is present.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid analytics event." }, { status: 400 });
  }

  const { organizationId, workspaceId } = parsed.data;
  if ((organizationId && !workspaceId) || (!organizationId && workspaceId)) {
    return NextResponse.json(
      { error: "organizationId and workspaceId must be provided together." },
      { status: 400 },
    );
  }

  const privacy: AnalyticsPrivacyState =
    parsed.data.state ?? defaultAnalyticsPrivacyState();

  const result = gateAnalyticsEvent(privacy, {
    name: parsed.data.name,
    properties: parsed.data.properties,
    scope:
      organizationId && workspaceId
        ? { organizationId, workspaceId }
        : undefined,
  });

  if (!result.tracked) {
    return NextResponse.json(
      {
        ok: true,
        tracked: false,
        reason: result.reason,
        message: "Event discarded — analytics is opt-in only.",
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    tracked: true,
    name: result.name,
    message: "Event accepted (stub sink). No third-party SDK loaded by default.",
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "POST events only when the user has opted in via Settings → Product analytics.",
    defaultEnabled: false,
  });
}
