import { NextResponse } from "next/server";
import { z } from "zod";
import { onboardPatron } from "@/lib/admin/onboard-patron";
import { getCurrentUser } from "@/lib/auth";
import { isGoogleOauthPublished } from "@/lib/google-oauth-publication";
import { isOperatorEmail } from "@/lib/operator";
import { product } from "@/lib/product";

const schema = z.object({
  patronName: z.string().trim().min(2).max(120),
  gmail: z.string().trim().email().max(254),
  phoneE164: z.string().trim().min(7).max(32),
  gmailEnabledConfirmed: z.boolean().optional(),
  resetPassword: z.boolean().optional(),
});

const enableSchema = z.object({
  provisioningRequestId: z.string().trim().min(1),
  googleTestUserEnabled: z.literal(true),
});

async function requireOperator() {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return { error: "Sign in required.", status: 401 } as const;
  }
  if (!isOperatorEmail(user.email)) {
    return { error: "Operator access required.", status: 403 } as const;
  }
  return { user } as const;
}

/**
 * Operator-only: create/find patron, upsert CallInIdentity, return checklist.
 * Gated by OPERATOR_EMAILS.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isOperatorEmail(user.email)) {
    return NextResponse.json(
      { error: "Operator access required." },
      { status: 403 },
    );
  }

  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        error:
          "Database required for onboard. Set DATABASE_URL and MOCK_INTEGRATIONS=false.",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Enter patron name, Gmail address, and phone in international format (+ and country code).",
      },
      { status: 400 },
    );
  }

  try {
    const result = await onboardPatron(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    if (code === "invalid_phone") {
      return NextResponse.json(
        {
          error:
            "Enter phone in international format, starting with + and country code.",
        },
        { status: 400 },
      );
    }
    if (code === "invalid_name" || code === "invalid_gmail") {
      return NextResponse.json(
        { error: "Check patron name and Gmail address." },
        { status: 400 },
      );
    }
    if (code === "gmail_not_confirmed") {
      return NextResponse.json(
        {
          error:
            "Confirm “Gmail enabled for this patron” after adding them as a Google OAuth test user (or set GOOGLE_OAUTH_PUBLISHED=true).",
        },
        { status: 400 },
      );
    }
    console.error("[admin/onboard]", err);
    return NextResponse.json(
      { error: "Could not onboard patron. Try again." },
      { status: 500 },
    );
  }
}

/** Operator checklist context (published flag) for the onboard UI. */
export async function GET() {
  const auth = await requireOperator();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  let pendingProvisioning: Array<{
    id: string;
    gmail: string;
    phoneE164: string;
    shortCode: string;
    googleTestUserEnabled: boolean;
    createdAt: Date;
  }> = [];
  if (process.env.DATABASE_URL && process.env.MOCK_INTEGRATIONS !== "true") {
    const { getNodePrisma } = await import("@/lib/db-node");
    pendingProvisioning = await getNodePrisma().provisioningRequest.findMany({
      where: {
        needsGoogleTestUser: true,
        provisionedReady: false,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        gmail: true,
        phoneE164: true,
        shortCode: true,
        googleTestUserEnabled: true,
        createdAt: true,
      },
    });
  }
  return NextResponse.json({
    ok: true,
    googlePublished: isGoogleOauthPublished(),
    signInUrl: `${product.url.replace(/\/$/, "")}/signin`,
    callInNumber: process.env.NEXT_PUBLIC_VAPI_CALL_IN_NUMBER ?? "+14057169240",
    pendingProvisioning,
  });
}

/** Operator confirms they added one pending Gmail under Google OAuth test users. */
export async function PATCH(request: Request) {
  const auth = await requireOperator();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = enableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a pending Gmail to enable." },
      { status: 400 },
    );
  }
  const { getNodePrisma } = await import("@/lib/db-node");
  const updated = await getNodePrisma().provisioningRequest.updateMany({
    where: {
      id: parsed.data.provisioningRequestId,
      needsGoogleTestUser: true,
      provisionedReady: false,
    },
    data: { googleTestUserEnabled: true },
  });
  if (updated.count !== 1) {
    return NextResponse.json(
      { error: "Pending request not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ok: true,
    message: "Gmail enabled. The patron's link can now open Google consent.",
  });
}
