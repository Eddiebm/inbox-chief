import { NextResponse } from "next/server";
import { z } from "zod";
import { createMockSession, createSession, hashPassword } from "@/lib/auth";
import { product } from "@/lib/product";

const signupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(200),
});

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace"
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Please provide a valid name, email, and password (10+ characters).",
      },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const firstName = parsed.data.name.trim().split(/\s+/)[0] ?? parsed.data.name;
  const lastName = parsed.data.name.trim().split(/\s+/).slice(1).join(" ");

  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
    await createMockSession(email);
    return NextResponse.json({
      ok: true,
      mock: true,
      user: { name: parsed.data.name, email },
      next: "/onboarding",
      message: `${product.name} account reserved. Connect a database to persist accounts.`,
    });
  }

  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        {
          error: "An account with that email already exists. Sign in.",
          code: "account_exists",
          next: "/login",
        },
        { status: 409 },
      );
    }

    const ownerRole = await prisma.role.upsert({
      where: { key: "workspace_owner" },
      update: {},
      create: {
        key: "workspace_owner",
        name: "Workspace Owner",
        grantsMailboxAccessByDefault: true,
      },
    });

    const patronPlan = await prisma.subscriptionPlan.findUnique({
      where: { key: "patron" },
    });

    const orgSlug = `${slugify(firstName)}-${Date.now().toString(36)}`;

    const organization = await prisma.organization.create({
      data: {
        name: `${firstName}'s workspace`,
        slug: orgSlug,
        accountType: "INDIVIDUAL",
        workspaces: {
          create: { name: "Primary" },
        },
        ...(patronPlan
          ? {
              subscriptions: {
                create: {
                  planId: patronPlan.id,
                  status: "TRIALING",
                  trialEndsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
                },
              },
            }
          : {}),
      },
    });

    const user = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        preferredName: firstName,
        passwordHash: hashPassword(parsed.data.password),
        accessibilityPrefs: {
          create: {
            screenReaderOptimized: true,
            preferVoiceOnboarding: true,
          },
        },
        memberships: {
          create: {
            organizationId: organization.id,
            roleId: ownerRole.id,
          },
        },
      },
    });

    await createSession(user.id);

    return NextResponse.json({
      ok: true,
      user: { id: user.id, name: parsed.data.name, email },
      next: "/onboarding",
    });
  } catch (error) {
    console.error("signup_failed", error);
    return NextResponse.json(
      { error: "Could not create account. Please try again." },
      { status: 500 },
    );
  }
}
