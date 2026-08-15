/**
 * Map raw VAPI / phone-assistant errors to short patron-safe speech.
 * Never surface “set assistant ID”, API keys, or dashboard jargon.
 */
export function humanizeVapiError(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) {
    return "Phone assistant is being set up. You can still use Ask by voice on this page.";
  }

  const lower = text.toLowerCase();

  if (
    lower.includes("assistant") &&
    (lower.includes("not linked") ||
      lower.includes("not assigned") ||
      lower.includes("set assistant") ||
      lower.includes("assistant id") ||
      lower.includes("get assistant") ||
      lower.includes("phone number"))
  ) {
    return "Phone assistant is being set up. You can still use Ask by voice on this page.";
  }

  if (
    lower.includes("api key") ||
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("vapi")
  ) {
    return "Phone assistant is being set up. You can still use Ask by voice on this page.";
  }

  if (lower.includes("not configured") || lower.includes("missing")) {
    return "Phone calling isn’t ready yet. You can still use Ask by voice on this page.";
  }

  // Strip operator-facing fragments; keep a single short sentence.
  if (/[A-Z_]{3,}=/.test(text) || /assistant id/i.test(text)) {
    return "Phone assistant is being set up. You can still use Ask by voice on this page.";
  }

  return "Phone assistant is being set up. You can still use Ask by voice on this page.";
}

export type CallInReadiness = {
  numberConfigured: boolean;
  assistantLinked: boolean;
  /** True when patrons should see the setup banner */
  showSetupBanner: boolean;
  patronMessage: string | null;
};

export function callInReadinessFromEnv(env: {
  callInNumber?: string | null;
  assistantId?: string | null;
}): CallInReadiness {
  const numberConfigured = Boolean(env.callInNumber?.trim());
  const assistantLinked = Boolean(env.assistantId?.trim());
  const showSetupBanner = numberConfigured && !assistantLinked;
  return {
    numberConfigured,
    assistantLinked,
    showSetupBanner,
    patronMessage: showSetupBanner
      ? "Phone assistant is being set up. You can still use Ask by voice on this page."
      : null,
  };
}
