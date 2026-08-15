import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { normalizePhoneE164 } from "@/lib/call-in/identity";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";
import { product } from "@/lib/product";

const schema = z.object({
  phoneE164: z.string().trim().min(7).max(32),
  label: z.string().trim().max(80).optional(),
});

/**
 * Registers a caller ID for anytime inbound calls.
 * Persists CallInIdentity so VAPI/Twilio can map customer.number → mailbox.
 */
export async function POST(request: Request) {
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
          "Enter your phone in international format, starting with + and country code.",
      },
      { status: 400 },
    );
  }

  const phoneE164 = normalizePhoneE164(parsed.data.phoneE164);
  if (!phoneE164 || !/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
    return NextResponse.json(
      {
        error:
          "Enter your phone in international format, starting with + and country code.",
      },
      { status: 400 },
    );
  }

  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
    return NextResponse.json({
      ok: true,
      phoneE164,
      message: `Saved locally for ${product.name} (demo mode). Calls from ${phoneE164} map in mock only.`,
      persisted: false,
    });
  }

  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json(
      { error: "Sign in to save your call-in phone number." },
      { status: 401 },
    );
  }

  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    return NextResponse.json(
      {
        error:
          "No workspace with mailbox access was found for your account. Complete signup first.",
      },
      { status: 403 },
    );
  }

  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();

    const mailbox = await prisma.mailbox.findFirst({
      where: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: user.id,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, emailAddress: true },
    });

    const identity = await prisma.callInIdentity.upsert({
      where: {
        organizationId_phoneE164: {
          organizationId: scope.organizationId,
          phoneE164,
        },
      },
      create: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        userId: user.id,
        mailboxId: mailbox?.id ?? null,
        phoneE164,
        label: parsed.data.label ?? null,
        enabled: true,
        verifiedAt: new Date(),
      },
      update: {
        workspaceId: scope.workspaceId,
        userId: user.id,
        mailboxId: mailbox?.id ?? null,
        label: parsed.data.label ?? null,
        enabled: true,
        verifiedAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      phoneE164: identity.phoneE164,
      mailboxEmail: mailbox?.emailAddress ?? null,
      message: `Saved for ${product.name}. Calls from ${identity.phoneE164} can ask about your mail anytime.`,
      persisted: true,
      identityId: identity.id,
    });
  } catch (err) {
    console.error("[call-in/identity] persist failed", err);
    return NextResponse.json(
      { error: "Could not save call-in phone. Try again." },
      { status: 500 },
    );
  }
}

/** Return the signed-in user's registered call-in phone(s). */
export async function GET() {
  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
    return NextResponse.json({
      ok: true,
      phones: [],
      persisted: false,
    });
  }

  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    return NextResponse.json({ ok: true, phones: [], persisted: true });
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  const phones = await prisma.callInIdentity.findMany({
    where: {
      organizationId: scope.organizationId,
      userId: user.id,
      enabled: true,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      phoneE164: true,
      label: true,
      mailboxId: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    phones: phones.map((p) => ({
      phoneE164: p.phoneE164,
      label: p.label,
      mailboxId: p.mailboxId,
      updatedAt: p.updatedAt.toISOString(),
    })),
    persisted: true,
  });
}
