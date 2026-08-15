import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth";
import { verifyPasswordResetToken } from "@/lib/auth/password-reset";

const schema = z.object({
  token: z.string().trim().min(16).max(500),
  password: z.string().min(10).max(200),
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
    return NextResponse.json(
      {
        error:
          "Use a valid reset link and a password of at least 10 characters.",
      },
      { status: 400 },
    );
  }

  const payload = verifyPasswordResetToken(parsed.data.token);
  if (!payload) {
    return NextResponse.json(
      {
        error:
          "This reset link is invalid or expired. Request a new one, or ask Inbox Chief to set a temporary password.",
      },
      { status: 400 },
    );
  }

  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
    return NextResponse.json({
      ok: true,
      next: "/login",
      message: "Password updated in demo mode. Sign in.",
    });
  }

  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true },
    });
    if (!user || user.email.toLowerCase() !== payload.email) {
      return NextResponse.json(
        { error: "This reset link is invalid or expired." },
        { status: 400 },
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(parsed.data.password) },
    });
    await prisma.session.deleteMany({ where: { userId: user.id } });

    return NextResponse.json({
      ok: true,
      next: "/login",
      message: "Password updated. Sign in with your new password.",
    });
  } catch (err) {
    console.error("[auth] reset-password failed", err);
    return NextResponse.json(
      { error: "Could not update password. Please try again." },
      { status: 500 },
    );
  }
}
