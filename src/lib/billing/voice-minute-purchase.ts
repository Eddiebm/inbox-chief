import { getNodePrisma } from "@/lib/db-node";
import {
  getMinutePack,
  MINUTE_PACKS,
  stripeMinutePackPriceId,
  type MinutePack,
} from "@/lib/plans";
import { sendSms } from "@/lib/provisioning-sms";
import { speakPhoneLastFour } from "@/lib/call-in/phone-display";
import { shouldMeterCallInUsage } from "@/lib/billing/call-usage";
import { createStripeCheckoutSession } from "@/lib/billing/stripe-checkout-session";
import { product } from "@/lib/product";

export type VoiceMinutePackId = MinutePack["id"];

export type VoiceMinutePurchaseResult = {
  spoken: string;
  packId: VoiceMinutePackId | null;
  smsSent: boolean;
};

function publicOrigin(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.CALL_IN_PUBLIC_BASE_URL?.trim() ||
    "https://www.inboxchief.email";
  try {
    const url = new URL(raw);
    if (url.hostname === "inboxchief.email") {
      url.hostname = "www.inboxchief.email";
    }
    return url.origin;
  } catch {
    return "https://www.inboxchief.email";
  }
}

function lastFourSpoken(phoneE164: string): string {
  const phrase = speakPhoneLastFour(phoneE164);
  if (phrase) return phrase.replace(/^I recognize the phone ending in /, "phone ending in ");
  return "your saved phone";
}

function packFromMinutes(minutes: number): VoiceMinutePackId | null {
  switch (minutes) {
    case 30:
      return "pack_30";
    case 60:
      return "pack_60";
    case 120:
      return "pack_120";
    default:
      return null;
  }
}

/** Map spoken or tool args to a pack. Null means list the menu. */
export function parseMinutePackChoice(raw: unknown): VoiceMinutePackId | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return packFromMinutes(Math.round(raw));
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return packFromMinutes(Number(raw.trim()));
  }
  if (typeof raw !== "string") return null;
  const q = raw.toLowerCase().replace(/[$,]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return null;
  if (
    /\bpack_120\b/.test(q) ||
    /\b120\b/.test(q) ||
    /\bone hundred twenty\b/.test(q) ||
    /\bhundred and twenty\b/.test(q)
  ) {
    return "pack_120";
  }
  if (/\bpack_60\b/.test(q) || /\b60\b/.test(q) || /\bsixty\b/.test(q)) {
    return "pack_60";
  }
  if (/\bpack_30\b/.test(q) || /\b30\b/.test(q) || /\bthirty\b/.test(q)) {
    return "pack_30";
  }
  return null;
}

export function parseMinutePackFromArgs(
  args?: Record<string, unknown> | null,
): VoiceMinutePackId | null {
  if (!args) return null;
  return (
    parseMinutePackChoice(args.minutes) ??
    parseMinutePackChoice(args.pack) ??
    parseMinutePackChoice(args.minutePackKey) ??
    parseMinutePackChoice(args.question)
  );
}

/**
 * True when the caller wants to purchase time — not when they only ask
 * how many minutes remain.
 */
export function isBuyMinutesRequest(question: string): boolean {
  const q = question.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return false;
  if (
    /\b(how many|how much|left|remaining|have i got)\b/.test(q) &&
    !/\b(buy|purchase|top up|add)\b/.test(q)
  ) {
    return false;
  }
  return (
    /\b(buy|purchase|get|add)\b.{0,40}\b(minute|minutes|pack|time)\b/.test(q) ||
    /\b(top up|top-up)\b/.test(q) ||
    /\bmore minutes\b/.test(q) ||
    /\bbuy more time\b/.test(q)
  );
}

export function speakMinutePackMenu(): string {
  const parts = MINUTE_PACKS.map(
    (pack) => `${pack.minutes} minutes is ${pack.priceUsd} dollars`,
  );
  return (
    `You can buy more call minutes without giving a card number on this call. ` +
    `${parts.join(". ")}. ` +
    `Say buy 30 minutes, buy 60 minutes, or buy 120 minutes. ` +
    `I will text a private checkout link to your saved phone. ` +
    `Nothing is charged until you finish that link.`
  );
}

export async function startVoiceMinutePackPurchase(input: {
  organizationId: string;
  userId: string | null | undefined;
  callerPhone: string | null;
  packId: VoiceMinutePackId | null;
}): Promise<VoiceMinutePurchaseResult> {
  if (
    !input.userId ||
    input.userId === "mock_user" ||
    !shouldMeterCallInUsage({ organizationId: input.organizationId })
  ) {
    return {
      spoken:
        "I can only send a checkout link to a saved Inbox Chief phone. Finish sign up, then call back and say buy 30 minutes.",
      packId: null,
      smsSent: false,
    };
  }

  if (!input.packId) {
    return {
      spoken: speakMinutePackMenu(),
      packId: null,
      smsSent: false,
    };
  }

  const pack = getMinutePack(input.packId);
  if (!pack) {
    return {
      spoken: speakMinutePackMenu(),
      packId: null,
      smsSent: false,
    };
  }

  const phone = input.callerPhone?.trim() || "";
  if (!phone.startsWith("+") || phone.length < 8) {
    return {
      spoken:
        "I need the phone you are calling from to be saved on your account before I can text a checkout link. Save it in Settings, then call back.",
      packId: pack.id,
      smsSent: false,
    };
  }

  const priceId = stripeMinutePackPriceId(pack.id);
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret || !priceId) {
    return {
      spoken:
        `Checkout is not available on this call yet. Open ${product.name} in your browser, go to Billing, and buy the ${pack.minutes} minute pack. I never take card numbers on the phone.`,
      packId: pack.id,
      smsSent: false,
    };
  }

  const origin = publicOrigin();
  const prisma = getNodePrisma();
  const [user, sub] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    }),
    prisma.subscription.findFirst({
      where: { organizationId: input.organizationId },
      orderBy: { updatedAt: "desc" },
      select: { stripeCustomerId: true },
    }),
  ]);

  let session: { id: string; url: string | null };
  try {
    session = await createStripeCheckoutSession({
      mode: "payment",
      priceId,
      successUrl: `${origin}/dashboard/billing?checkout=success`,
      cancelUrl: `${origin}/dashboard/billing?checkout=cancel`,
      customerId: sub?.stripeCustomerId ?? undefined,
      customerEmail: user?.email ?? undefined,
      metadata: {
        organizationId: input.organizationId,
        planKey: "",
        purchaseKind: "minute_pack",
        minutePackKey: pack.id,
        userId: input.userId,
        source: "voice_call",
      },
    });
  } catch (err) {
    console.error("[billing] voice minute checkout failed", err);
    return {
      spoken:
        `I could not start checkout right now. Open ${product.name}, go to Billing, and buy the ${pack.minutes} minute pack. I never take card numbers on the phone.`,
      packId: pack.id,
      smsSent: false,
    };
  }

  if (!session.url) {
    return {
      spoken:
        `I could not start checkout right now. Open ${product.name}, go to Billing, and buy the ${pack.minutes} minute pack. I never take card numbers on the phone.`,
      packId: pack.id,
      smsSent: false,
    };
  }

  const sms = await sendSms({
    to: phone,
    body:
      `${product.name}: ${pack.minutes} minutes for $${pack.priceUsd}. ` +
      `Nothing is charged until you finish this private checkout link: ${session.url}`,
  });

  if (sms.sent) {
    return {
      spoken:
        `I texted a checkout link to the ${lastFourSpoken(phone)} for ${pack.minutes} minutes at ${pack.priceUsd} dollars. ` +
        `Open that text and finish checkout. Nothing was charged on this call. I never take card numbers on the phone.`,
      packId: pack.id,
      smsSent: true,
    };
  }

  const smsHint =
    sms.reason === "not_configured"
      ? `I cannot text a link from this line yet.`
      : `I could not send the text just now.`;
  return {
    spoken:
      `${smsHint} Open ${product.name} in your browser, go to Billing, and buy the ${pack.minutes} minute pack for ${pack.priceUsd} dollars. ` +
      `I never take card numbers on the phone.`,
    packId: pack.id,
    smsSent: false,
  };
}
