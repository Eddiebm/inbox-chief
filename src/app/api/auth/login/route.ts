import { NextResponse } from "next/server";
import { z } from "zod";
import { createMockSession, createSession, verifyPassword } from "@/lib/auth";
import { product } from "@/lib/product";

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  if (process.env.MOCK_INTEGRATIONS === "true") {
    await createMockSession(parsed.data.email.toLowerCase());
    return NextResponse.json({
      ok: true,
      mock: true,
      next: "/dashboard",
      message: `${product.name} mock sign-in accepted. Connect a database to enforce real credentials.`,
    });
  }

  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    if (!user?.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    await createSession(user.id);
    return NextResponse.json({ ok: true, next: "/dashboard" });
  } catch (error) {
    console.error("login_failed", error);
    return NextResponse.json({ error: "Could not sign in." }, { status: 500 });
  }
}
