import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { isGoogleOauthPublished } from "@/lib/google-oauth-publication";
import {
  findProvisioningByCode,
  verifyProvisioningMagicToken,
} from "@/lib/provisioning";

export const runtime = "nodejs";

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
      return NextResponse.redirect(
        new URL("/login?provision=invalid", appOrigin(request)),
      );
    }
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
    console.warn("[provision/connect] rejected", error);
    return NextResponse.redirect(
      new URL("/login?provision=expired", appOrigin(request)),
    );
  }
}
