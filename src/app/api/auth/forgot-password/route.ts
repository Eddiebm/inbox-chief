import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createPasswordResetToken,
  FORGOT_PASSWORD_GENERIC,
} from "@/lib/auth/password-reset";
import { product } from "@/lib/product";

const schema = z.object({
  email: z.string().trim().email().max(254),
});

async function sendResetEmail(to: string, resetUrl: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from =
    process.env.RESEND_FROM?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    "Inbox Chief <noreply@inboxchief.app>";
  if (!apiKey) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Reset your ${product.name} password`,
        text: `Reset your ${product.name} password using this link (expires in 1 hour):\n\n${resetUrl}\n\nIf you did not ask for this, you can ignore this email. Nothing sends without your approval.`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

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
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const generic = {
    ok: true as const,
    message: FORGOT_PASSWORD_GENERIC,
  };

  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
    return NextResponse.json(generic);
  }

  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    if (user) {
      const token = createPasswordResetToken(user.id, user.email);
      const base =
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        "https://inboxchief.email";
      const resetUrl = `${base.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
      await sendResetEmail(user.email, resetUrl);
    }
  } catch (err) {
    console.warn("[auth] forgot-password lookup failed", err);
  }

  return NextResponse.json(generic);
}
