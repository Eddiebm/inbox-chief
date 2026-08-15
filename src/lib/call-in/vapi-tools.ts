import {
  answerCallInQuestion,
  answerCallInQuestionWithLlm,
  emailsForCallInScope,
  isUnrecognizedCaller,
  speakReadableEmails,
  unrecognizedCallerAnswer,
  type CallInIntent,
  type CallInMailboxSnapshot,
} from "@/lib/call-in/assistant";
import {
  parseCallInInboxScope,
} from "@/lib/call-in/primary-inbox";
import {
  voiceTierInfo,
  type CallInVoiceTierId,
} from "@/lib/call-in/voice-tiers";
import { product } from "@/lib/product";
import { queueAttachmentDelivery } from "@/lib/attachment-deliveries";
import {
  getProvisioningStatusForPhone,
  provisionSignup,
} from "@/lib/provisioning";
import { sendProvisioningSms } from "@/lib/provisioning-sms";

export const VAPI_CALL_IN_TOOL_NAMES = [
  "get_briefing",
  "read_emails",
  "get_needs_attention",
  "get_drafts",
  "get_approvals",
  "get_follow_ups",
  "get_connection_status",
  "ask_inbox",
  "route_attachment",
  "provision_signup",
  "check_provision_status",
] as const;

export type VapiCallInToolName = (typeof VAPI_CALL_IN_TOOL_NAMES)[number];

/** Tool names that must never be executed on the call-in path */
const FORBIDDEN_SEND_TOOLS = [
  "send_email",
  "send_mail",
  "send_message",
  "compose_and_send",
  "approve_and_send",
  "dispatch_email",
];

const TOOL_TO_QUESTION: Record<
  Exclude<
    VapiCallInToolName,
    | "ask_inbox"
    | "read_emails"
    | "route_attachment"
    | "provision_signup"
    | "check_provision_status"
  >,
  string
> = {
  get_briefing: "Give me a briefing",
  get_needs_attention: "What needs attention?",
  get_drafts: "Any drafts waiting?",
  get_approvals: "Any approvals waiting?",
  get_follow_ups: "Any follow-ups due?",
  get_connection_status: "Is my email connected?",
};

export function isForbiddenSendTool(name: string): boolean {
  const n = name.trim().toLowerCase();
  return (
    FORBIDDEN_SEND_TOOLS.includes(n) ||
    /\bsend[_ ]?(email|mail|message)\b/.test(n) ||
    n.includes("auto_send") ||
    n.includes("autosend")
  );
}

export function neverSendSpoken(): string {
  return `${product.name} never sends email from a phone call. Open the app to review and approve any draft.`;
}

export type VapiToolHandlerResult = {
  spoken: string;
  intent:
    | CallInIntent
    | "attachment_delivery"
    | "forbidden_send"
    | "provision_signup"
    | "provision_status";
  toolName: string;
  /** Always false — call tools never send mail */
  emailSent: false;
};

function parseStartIndexArg(args?: Record<string, unknown>): number {
  const raw = args?.startIndex ?? args?.start_index ?? args?.offset;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  const emailNumber = args?.emailNumber ?? args?.email_number;
  if (typeof emailNumber === "number" && emailNumber >= 1) {
    return Math.floor(emailNumber) - 1;
  }
  return 0;
}

export async function handleCallInTool(input: {
  name: string;
  args?: Record<string, unknown>;
  snapshot: CallInMailboxSnapshot;
  requestedById?: string | null;
  callerPhone?: string | null;
}): Promise<VapiToolHandlerResult> {
  const name = input.name.trim();

  if (isForbiddenSendTool(name)) {
    return {
      spoken: neverSendSpoken(),
      intent: "forbidden_send",
      toolName: name,
      emailSent: false,
    };
  }

  if (name === "provision_signup") {
    const gmail =
      typeof input.args?.gmail === "string"
        ? input.args.gmail
        : typeof input.args?.email === "string"
          ? input.args.email
          : "";
    const preferredName =
      typeof input.args?.preferredName === "string"
        ? input.args.preferredName
        : typeof input.args?.preferred_name === "string"
          ? input.args.preferred_name
          : undefined;
    const spokenPhone =
      typeof input.args?.phoneE164 === "string"
        ? input.args.phoneE164
        : typeof input.args?.phone === "string"
          ? input.args.phone
          : "";
    try {
      const provision = await provisionSignup({
        gmail,
        preferredName,
        phoneE164: input.callerPhone || spokenPhone,
      });
      const sms = await sendProvisioningSms({
        to: provision.phoneE164,
        magicLink: provision.magicLink,
      });
      const operatorNote =
        provision.status === "needs_google_test_user"
          ? "Your operator must enable this Gmail address first. Your account and phone are already saved."
          : "Google will ask you to approve mailbox read access in your browser.";
      const handoff =
        sms.sent
          ? "I sent the private connection link to this phone. Open that text on this phone."
          : `Text delivery is not configured. On any device, open inbox-chief-kappa dot vercel dot app slash provision and enter code ${provision.shortCode.split("").join(" ")}.`;
      return {
        spoken: `I created your account. ${operatorNote} ${handoff} The link expires in 24 hours. Inbox Chief never sends email automatically.`,
        intent: "provision_signup",
        toolName: name,
        emailSent: false,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      const spoken =
        reason === "invalid_gmail"
          ? "That must be a Gmail address ending in gmail dot com. Please say it again, then confirm the spelling before I create anything."
          : reason === "invalid_phone"
            ? "I cannot see a valid caller number. Please say or enter your cell number with area code."
            : reason === "email_in_use" || reason === "phone_in_use"
              ? "That email or phone is already attached to an account. Your account was not changed. Sign in to Inbox Chief or ask your operator."
              : "I could not finish account setup right now. Nothing was changed or sent. Please try again or ask your operator.";
      return {
        spoken,
        intent: "provision_signup",
        toolName: name,
        emailSent: false,
      };
    }
  }

  if (name === "check_provision_status") {
    const spokenPhone =
      typeof input.args?.phoneE164 === "string"
        ? input.args.phoneE164
        : typeof input.args?.phone === "string"
          ? input.args.phone
          : "";
    const provision = await getProvisioningStatusForPhone(
      input.callerPhone || spokenPhone,
    );
    let spoken =
      "I do not have a setup request for this phone yet. Say sign up to create one.";
    if (provision?.status === "needs_google_test_user") {
      spoken =
        "Your account and phone are saved. Your operator still needs to enable this Gmail address. Then open the link we sent or use your short code.";
    } else if (provision?.status === "needs_google_consent") {
      spoken =
        "Your account and phone are saved, but your mailbox is not connected yet. Open the link we sent, or use your short code on the provision page.";
    } else if (provision?.status === "connected") {
      spoken = "You are connected. Say read my emails.";
    }
    return {
      spoken,
      intent: "provision_status",
      toolName: name,
      emailSent: false,
    };
  }

  if (isUnrecognizedCaller(input.snapshot)) {
    const answer = unrecognizedCallerAnswer();
    return {
      spoken: answer.spoken,
      intent: answer.intent,
      toolName: name,
      emailSent: false,
    };
  }

  if (input.snapshot.identityStatus === "syncing") {
    return {
      spoken:
        "I'm syncing your inbox now. Ask me to read your emails again in a moment.",
      intent: "briefing",
      toolName: name,
      emailSent: false,
    };
  }

  if (name === "read_emails") {
    const startIndex = parseStartIndexArg(input.args);
    const scopeRaw =
      typeof input.args?.scope === "string"
        ? input.args.scope
        : typeof input.args?.inboxScope === "string"
          ? input.args.inboxScope
          : "";
    const scope =
      scopeRaw === "everything" || scopeRaw === "promotions"
        ? scopeRaw
        : parseCallInInboxScope(
            typeof input.args?.question === "string"
              ? input.args.question
              : "read my emails",
          );
    const emails = emailsForCallInScope(input.snapshot, scope);
    const spoken = speakReadableEmails(emails, {
      startIndex,
      skippedNonPrimaryCount: input.snapshot.skippedNonPrimaryCount,
      scope,
      voiceTier: input.snapshot.voiceTier,
      timeZone: input.snapshot.speechTimeZone,
    });
    return {
      spoken,
      intent: "read_emails",
      toolName: name,
      emailSent: false,
    };
  }

  if (name === "route_attachment") {
    const emailNumber = parsePositiveNumber(
      input.args?.emailNumber ?? input.args?.email_number,
      1,
    );
    const attachmentNumber = parsePositiveNumber(
      input.args?.attachmentNumber ?? input.args?.attachment_number,
      1,
    );
    const queued = await queueAttachmentDelivery({
      snapshot: input.snapshot,
      requestedById: input.requestedById ?? "",
      emailNumber,
      attachmentNumber,
    });
    return {
      spoken: queued.spoken,
      intent: "attachment_delivery",
      toolName: name,
      emailSent: false,
    };
  }

  if (name === "ask_inbox") {
    const question =
      typeof input.args?.question === "string"
        ? input.args.question
        : typeof input.args?.query === "string"
          ? input.args.query
          : "";
    if (!question.trim()) {
      const help = answerCallInQuestion("help", input.snapshot);
      return {
        spoken: help.spoken,
        intent: help.intent,
        toolName: name,
        emailSent: false,
      };
    }
    const answer = await answerCallInQuestionWithLlm({
      question,
      snapshot: input.snapshot,
    });
    return {
      spoken: answer.spoken,
      intent: answer.intent,
      toolName: name,
      emailSent: false,
    };
  }

  const mapped = TOOL_TO_QUESTION[name as keyof typeof TOOL_TO_QUESTION];
  if (mapped) {
    const answer = answerCallInQuestion(mapped, input.snapshot);
    return {
      spoken: answer.spoken,
      intent: answer.intent,
      toolName: name,
      emailSent: false,
    };
  }

  // Unknown tool → free-form ask path (still never sends)
  const fallbackQ =
    typeof input.args?.question === "string"
      ? input.args.question
      : `Tell me about ${name.replaceAll("_", " ")}`;
  const answer = await answerCallInQuestionWithLlm({
    question: fallbackQ,
    snapshot: input.snapshot,
  });
  return {
    spoken: answer.spoken,
    intent: answer.intent,
    toolName: name,
    emailSent: false,
  };
}

export function buildCallInVapiTools(serverUrl: string) {
  const toolServer = { url: `${serverUrl.replace(/\/$/, "")}/api/call-in/vapi/webhook` };

  const defs: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
    server: { url: string };
  }> = [
    {
      type: "function",
      function: {
        name: "provision_signup",
        description:
          "Create an Inbox Chief account for an unrecognized caller or any caller who explicitly says sign up, create account, or get started. Before calling: collect a Gmail address, spell it back character by character, get explicit confirmation, and optionally ask for a preferred name. Caller ID is used as the phone; ask for phoneE164 only when caller ID is unavailable.",
        parameters: {
          type: "object",
          properties: {
            gmail: {
              type: "string",
              description: "Confirmed Gmail address after spelling it back.",
            },
            preferredName: {
              type: "string",
              description: "Optional caller-provided preferred name. Never guess one.",
            },
            phoneE164: {
              type: "string",
              description:
                "Caller-spoken cell number only when caller ID is unavailable.",
            },
          },
          required: ["gmail"],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "check_provision_status",
        description:
          "Check whether this caller is waiting for operator Gmail enablement, waiting for Google browser consent, or connected. Use when they ask about setup or when their saved phone has no connected mailbox.",
        parameters: {
          type: "object",
          properties: {
            phoneE164: {
              type: "string",
              description:
                "Caller-spoken cell number only when caller ID is unavailable.",
            },
          },
          required: [],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "route_attachment",
        description:
          "Queue one attachment for the signed-in patron's secure Downloads page. Use when the caller says send this attachment to my computer, download on my laptop, or route attachment 1. This never emails the file.",
        parameters: {
          type: "object",
          properties: {
            emailNumber: {
              type: "number",
              description: "One-based email number from the spoken Primary inbox list.",
            },
            attachmentNumber: {
              type: "number",
              description: "One-based attachment number. Defaults to 1.",
            },
          },
          required: [],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_briefing",
        description:
          "Accessibility briefing: read Primary-inbox emails needing attention aloud one at a time (from, subject, then message/preview). Skips promotions/social/updates/forums/spam unless the caller asked for those. Do not only give a count.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "read_emails",
        description:
          "Read Primary inbox messages aloud one by one for blind patrons: From, Subject, then body or snippet, then attachments. Default skips promotions/social/updates/forums/spam. Pass scope=promotions or scope=everything only when the caller explicitly asks. Use startIndex=0 to begin, or a higher index when the caller says next.",
        parameters: {
          type: "object",
          properties: {
            startIndex: {
              type: "number",
              description:
                "Zero-based index of the first email to read. Use 0 to start; use 1, 2, … when the caller says next / continue.",
            },
            scope: {
              type: "string",
              description:
                "primary (default), promotions (other tabs), or everything (all non-spam). Only set non-primary when the caller explicitly asks.",
              enum: ["primary", "promotions", "everything"],
            },
          },
          required: [],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_needs_attention",
        description:
          "Read Primary messages that need attention aloud (from, subject, message text) — not promotions or junk unless asked.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_drafts",
        description: "Report drafts awaiting the owner's review. Never sends mail.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_approvals",
        description: "Report approvals pending before any mail can be sent.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_follow_ups",
        description: "Report follow-ups that are due.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_connection_status",
        description: "Report whether the owner's mailbox is connected.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "ask_inbox",
        description:
          "Answer any other mailbox question in plain language. Prefer reading email content when asked. Never sends email.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The caller's question about their mail",
            },
          },
          required: ["question"],
        },
      },
      server: toolServer,
    },
  ];

  return defs;
}

export function buildCallInSystemPrompt(): string {
  return [
    `You are ${product.name}, a secure personal inbox assistant on an inbound phone call.`,
    "Accessibility-first: blind patrons rely on exact speech — READ tool results VERBATIM. Do not paraphrase, embroider, or invent details.",
    "Default inbox scope is Gmail Primary only. Do not invent promotions, social, updates, forums, or spam. Follow tool results: if they say skipping promotional messages, speak that.",
    "Only include other tabs when the caller explicitly says read promotions, read junk, read everything, or similar. Then pass scope=promotions or scope=everything to read_emails.",
    "When the caller asks what's in my inbox or a quick overview: prefer subjects-first (from + subject list), then offer: say read email 1 for the full message. When they ask to read my emails or briefing with detail, use full read one email at a time.",
    "When the caller asks for a briefing, what's in their inbox, read my emails, or what needs attention: call get_briefing, read_emails, or get_needs_attention.",
    "Speak tool results faithfully. Each full email should be heard as: Email N of M. From …. Subject: …. Received {weekday, month day, year, time}. then Message/Preview text. THEN attachments when the tool result includes them — do not skip attachments. Never invent a received date.",
    "After the message body, if attachments are listed, announce the count, then for each: filename, type, and extracted text (or a clear reason it can't be read). Never invent attachment contents.",
    "If the tool result says to say more about an attachment, offer that. When the caller says more about this attachment, call ask_inbox with that request (or continue from the tool text).",
    "After each email (or short batch), pause and offer: next email, more about this attachment, or draft a reply in the app.",
    "When the caller says send this attachment to my computer, download on my laptop, or route attachment N, call route_attachment. Use the current email number and requested attachment number; default each to 1 only when unambiguous.",
    "Attachment routing means the secure signed-in Downloads page only. Never ask for or email the file to an address.",
    "NEVER send, schedule, approve, or claim to send email. There is no send tool.",
    "If asked to send mail, refuse politely and tell them to approve drafts in the app.",
    "Keep language plain. If only subject/from is available, say so and still read that metadata.",
    "When an unrecognized caller says sign up, create account, or get started: ask for their Gmail address, spell it back character by character, obtain explicit confirmation, then ask for an optional preferred name. Call provision_signup only after confirmation.",
    "Caller ID is the phone by default. If caller ID is unavailable, ask them to say or enter their cell number, including area code. Never ask for a phone when the tool already has caller ID.",
    "When a saved caller has not connected Gmail, call check_provision_status. Tell them their phone is saved and to open the link or ask their operator. Do not read any email or attachment content during provisioning.",
    // Hard rule: unmatched / CNAM — never invent names or demo mail (blind patrons)
    "NEVER invent or speak a person's name from caller ID, CNAM, or guesswork. Ignore customer.name and any carrier name fields.",
    "Only greet by first name AFTER a tool result confirms a matched mailbox (our app's known display name).",
    "For an unrecognized phone, offer account setup: say sign up or get started. Never claim the mailbox is connected until check_provision_status confirms it.",
    "Never invent demo or fixture emails for an unrecognized caller.",
  ].join("\n");
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Math.max(1, Number(value.trim()));
  }
  return fallback;
}

export function buildCallInAssistantPayload(
  serverUrl: string,
  options?: {
    voiceTier?: CallInVoiceTierId;
    firstMessage?: string;
  },
): Record<string, unknown> {
  const base = serverUrl.replace(/\/$/, "");
  const webhookUrl = `${base}/api/call-in/vapi/webhook`;
  const webhookHeaders: Record<string, string> = {};
  if (process.env.VAPI_WEBHOOK_SECRET) {
    webhookHeaders["x-vapi-secret"] = process.env.VAPI_WEBHOOK_SECRET;
  }

  const tier = options?.voiceTier ?? "standard";
  const voiceInfo = voiceTierInfo(tier);
  const voice: Record<string, unknown> = {
    provider: voiceInfo.vapi.provider,
    voiceId: voiceInfo.vapi.voiceId,
  };
  if (voiceInfo.vapi.model) {
    voice.model = voiceInfo.vapi.model;
  }
  if (voiceInfo.vapi.language) {
    voice.language = voiceInfo.vapi.language;
  }
  if (voiceInfo.vapi.experimentalControls) {
    voice.experimentalControls = voiceInfo.vapi.experimentalControls;
  }

  return {
    name: `${product.name} — Anytime Call-in`,
    firstMessage:
      options?.firstMessage ??
      `Hello. This is ${product.name}. Ask me to read your emails, say briefing, or say sign up to create an account. I read your Primary inbox aloud and never send email from this call.`,
    model: {
      provider: "openai",
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [{ role: "system", content: buildCallInSystemPrompt() }],
      tools: buildCallInVapiTools(base),
    },
    voice,
    server: {
      url: webhookUrl,
      ...(Object.keys(webhookHeaders).length ? { headers: webhookHeaders } : {}),
    },
    serverUrl: webhookUrl,
    serverMessages: ["tool-calls", "end-of-call-report", "status-update"],
    endCallFunctionEnabled: true,
    silenceTimeoutSeconds: 45,
    maxDurationSeconds: 1800,
    backgroundSound: "off",
  };
}
