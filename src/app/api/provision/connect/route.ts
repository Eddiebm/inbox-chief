import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { isGoogleOauthPublished } from "@/lib/google-oauth-publication";
import {
  findProvisioningByCode,
  verifyProvisioningMagicToken,
} from "@/lib/provisioning";
import {
  clientKeyFromRequest,
  FailureRateLimiter,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/**
 * Short codes redeem straight into a session, so guessing is throttled hard.
 * The signed magic link (`?token=`) is the preferred path and is not limited —
 * it is unguessable and already carries its own expiry.
 */
const shortCodeLimiter = new FailureRateLimiter({
  maxFailures: 5,
  windowMs: 10 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
});

/** Exposed so tests can start from a clean slate. */
export function resetProvisionRateLimiter() {
  shortCodeLimiter.reset();
}

function appOrigin(request: Request): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.CALL_IN_PUBLIC_BASE_URL?.trim() ||
    new URL(request.url).origin
  );
}

function provisionPage(
  request: Request,
  code: string,
  reason?: string,
): NextResponse {
  const url = new URL(`/provision/${code}`, appOrigin(request));
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

/**
 * Redeems a 24-hour signed voice-provisioning handoff (or its spoken short
 * code), creates a normal app session, then starts required Google consent.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const code = searchParams.get("code");

  const clientKey = clientKeyFromRequest(request);
  if (code && !token) {
    const gate = shortCodeLimiter.check(clientKey);
    if (!gate.allowed) {
      return NextResponse.redirect(
        new URL("/login?provision=too_many_attempts", appOrigin(request)),
        {
          headers: { "Retry-After": String(gate.retryAfterSeconds) },
        },
      );
    }
  }

  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();
    let provision;

    if (token) {
      const payload = await verifyProvisioningMagicToken(token);
      provision = await prisma.provisioningRequest.findFirst({
        where: { id: payload.requestId, userId: payload.userId },
      });
    } else if (code) {
      provision = await findProvisioningByCode(code);
    }

    if (!provision) {
      if (code && !token) shortCodeLimiter.recordFailure(clientKey);
      return NextResponse.redirect(
        new URL("/login?provision=invalid", appOrigin(request)),
      );
    }
    if (code && !token) shortCodeLimiter.recordSuccess(clientKey);
    if (
      !isGoogleOauthPublished() &&
      provision.needsGoogleTestUser &&
      !provision.googleTestUserEnabled
    ) {
      return provisionPage(request, provision.shortCode, "operator_pending");
    }

    await createSession(provision.userId);
    if (provision.provisionedReady) {
      return NextResponse.redirect(
        new URL("/dashboard/settings?gmail=connected", appOrigin(request)),
      );
    }
    return NextResponse.redirect(
      new URL(
        "/api/gmail/connect?returnTo=/dashboard/settings&redirect=1",
        appOrigin(request),
      ),
    );
  } catch (error) {
    if (code && !token) shortCodeLimiter.recordFailure(clientKey);
    console.warn("[provision/connect] rejected", error);
    return NextResponse.redirect(
      new URL("/login?provision=expired", appOrigin(request)),
    );
  }
}
