export type ProvisioningSmsResult =
  | { sent: true; provider: "twilio" }
  | { sent: false; reason: "not_configured" | "failed" };

/** Send an SMS via Twilio. Used for Gmail setup and minute-pack checkout links. */
export async function sendSms(input: {
  to: string;
  body: string;
}): Promise<ProvisioningSmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = (
    process.env.TWILIO_SMS_FROM_NUMBER ??
    process.env.TWILIO_PHONE_NUMBER
  )?.trim();
  if (!accountSid || !authToken || !from) {
    return { sent: false, reason: "not_configured" };
  }

  const body = new URLSearchParams({
    To: input.to,
    From: from,
    Body: input.body,
  });
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    if (!response.ok) {
      console.warn("[sms] Twilio SMS failed", response.status);
      return { sent: false, reason: "failed" };
    }
    return { sent: true, provider: "twilio" };
  } catch (error) {
    console.warn("[sms] Twilio SMS failed", error);
    return { sent: false, reason: "failed" };
  }
}

/**
 * Optional SMS handoff. If Twilio is not configured, the caller receives the
 * short code and public provision URL aloud instead.
 */
export async function sendProvisioningSms(input: {
  to: string;
  magicLink: string;
}): Promise<ProvisioningSmsResult> {
  return sendSms({
    to: input.to,
    body: `Inbox Chief: connect Gmail to finish setup. This private link expires in 24 hours: ${input.magicLink}`,
  });
}
