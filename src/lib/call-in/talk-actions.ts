import { readIntentFromQuestion } from "@/lib/call-in/vapi-tools";
import { detectSpeechRateCommand } from "@/lib/call-in/speech-rate";
import { isBuyMinutesRequest } from "@/lib/billing/voice-minute-purchase";
import { talkCommand } from "@/lib/voice/talk-commands";

export type TalkCalendarRange = "today" | "tomorrow" | "next";

export type TalkPhoneTool = {
  name: string;
  args: Record<string, unknown>;
};

export type TalkAction =
  | { kind: "calendar"; range: TalkCalendarRange }
  | {
      kind: "compose";
      recipient: string;
      subject: string;
      body: string;
      replyToCurrent: boolean;
    }
  | { kind: "need_message"; replyToCurrent: boolean }
  | { kind: "confirm_send" }
  | { kind: "decline_send" };

function spoken(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
}

function cleanRecipient(value: string): string {
  return value.replace(/^(?:to|for)\s+/i, "").replace(/[,\s]+$/g, "").trim();
}

function splitMessage(rest: string): {
  recipient: string;
  subject: string;
  body: string;
} | null {
  const explicit = rest.match(/^(.*?)\s+subject\s+(.+?)\s+message\s+(.+)$/i);
  if (explicit?.[1] && explicit[2] && explicit[3]) {
    return {
      recipient: cleanRecipient(explicit[1]),
      subject: explicit[2].trim(),
      body: explicit[3].trim(),
    };
  }
  const saying = rest.match(/^(.*?)\s+(?:saying|that)\s+(.+)$/i);
  if (saying?.[1] && saying[2]) {
    const body = saying[2].trim();
    return {
      recipient: cleanRecipient(saying[1]),
      subject: body.slice(0, 80),
      body,
    };
  }
  const about = rest.match(/^(.*?)\s+about\s+(.+)$/i);
  if (about?.[1] && about[2]) {
    const topic = about[2].trim();
    return {
      recipient: cleanRecipient(about[1]),
      subject: topic.slice(0, 80),
      body: `About ${topic}.`,
    };
  }
  return null;
}

const OUTGOING =
  /^(?:please )?(?:email|e-mail|write to|message|send (?:a |an )?(?:message|email|note) to) (.+)$/i;
const REPLY =
  /^(?:please )?reply(?: to (?:this|that)(?: (?:one|email|message))?)?(?: saying| that)?(?: (.*))?$/i;

/** Map a Talk utterance onto the phone's calendar and send actions. */
export function parseTalkAction(text: string): TalkAction | null {
  const phrase = spoken(text);
  const original = text.trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
  if (!phrase) return null;

  if (/^(?:please )?email (?:this to )?me$/.test(phrase)) return null;

  if (/^(?:approve|send it|send this|yes,? send(?: it)?)$/.test(phrase)) {
    return { kind: "confirm_send" };
  }
  if (/^(?:no|no thanks|do not send|don't send|change it|cancel that)$/.test(phrase)) {
    return { kind: "decline_send" };
  }

  const reply = original.match(REPLY);
  if (reply && /^reply\b/i.test(phrase)) {
    const body = reply[1]?.trim() ?? "";
    if (!body) return { kind: "need_message", replyToCurrent: true };
    return {
      kind: "compose",
      recipient: "",
      subject: "",
      body,
      replyToCurrent: true,
    };
  }

  const outgoing = original.match(OUTGOING);
  if (outgoing?.[1] && /^(?:please )?(?:email|e-mail|write to|message|send)\b/.test(phrase)) {
    const split = splitMessage(outgoing[1]);
    if (!split || !split.recipient || !split.body) {
      return { kind: "need_message", replyToCurrent: false };
    }
    return { kind: "compose", ...split, replyToCurrent: false };
  }

  if (/\b(?:calendar|schedule|agenda)\b/.test(phrase)) {
    if (/\btomorrow\b/.test(phrase)) return { kind: "calendar", range: "tomorrow" };
    if (/\b(?:next|upcoming)\b/.test(phrase)) return { kind: "calendar", range: "next" };
    return { kind: "calendar", range: "today" };
  }

  return null;
}

/**
 * Map a spoken request onto a phone tool.
 * Returns null for calendar, compose, and explicit send — those stay on
 * parseTalkAction so a draft is never sent without "send it".
 * Also returns null for research-only wording so that path is not stolen.
 */
export function phoneToolForUtterance(text: string): TalkPhoneTool | null {
  const phrase = spoken(text);
  const original = text.trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
  if (!phrase || parseTalkAction(text)) return null;
  if (
    /^\s*research\b/i.test(original) ||
    /\bfind original papers\b/i.test(phrase) ||
    /\bexplain the evidence\b/i.test(phrase) ||
    /^(?:please )?email (?:this to )?me$/.test(phrase)
  ) {
    return null;
  }

  const control = talkCommand(original);
  if (control === "slower" || control === "faster" || control === "normal") {
    return {
      name: "set_speech_speed",
      args: {
        command: control === "normal" ? "normal" : control,
        question: original,
      },
    };
  }
  if (
    control === "next" ||
    control === "previous" ||
    control === "repeat" ||
    control === "continue"
  ) {
    const read = readIntentFromQuestion(original);
    if (read) return { name: "read_emails", args: read };
    const position =
      control === "previous"
        ? "previous"
        : control === "repeat"
          ? "repeat"
          : control === "continue"
            ? "continue"
            : "next";
    return { name: "read_emails", args: { position, question: original } };
  }

  const speed = detectSpeechRateCommand(original);
  if (speed) return { name: "set_speech_speed", args: { command: speed, question: original } };

  if (isBuyMinutesRequest(original)) {
    return { name: "buy_minutes", args: { question: original } };
  }

  const savedAs = original.match(/^(?:please )?(?:save|remember|call) (.+?) as (.+)$/i);
  if (savedAs?.[1] && savedAs[2]) {
    return {
      name: "save_contact_nickname",
      args: {
        contact: savedAs[1].replace(/^this sender\s+/i, "").trim(),
        nickname: savedAs[2].trim(),
      },
    };
  }

  if (/\b(?:sign up|create (?:an )?account)\b/.test(phrase)) {
    return { name: "provision_signup", args: { question: original } };
  }
  if (/\b(?:provision status|check (?:my )?setup|did my sign up work)\b/.test(phrase)) {
    return { name: "check_provision_status", args: {} };
  }

  const read = readIntentFromQuestion(original);
  if (read) return { name: "read_emails", args: read };

  if (/\b(?:connect(?:ed|ion)?|gmail|mailbox status)\b/.test(phrase)) {
    return { name: "get_connection_status", args: {} };
  }
  if (/\b(?:brief(?:ing)?|summary|overview|catch me up|what(?:'s| is) going on)\b/.test(phrase)) {
    return { name: "read_emails", args: { position: "first", question: original } };
  }
  if (/\b(?:needs? attention|urgent|unread)\b/.test(phrase)) {
    return { name: "read_emails", args: { position: "first", question: original } };
  }
  if (/\b(?:drafts?|waiting (?:for )?review)\b/.test(phrase)) {
    return { name: "get_drafts", args: {} };
  }
  if (/\bapprovals?\b/.test(phrase)) {
    return { name: "get_approvals", args: {} };
  }
  if (/\bfollow[- ]?ups?\b/.test(phrase)) {
    return { name: "get_follow_ups", args: {} };
  }
  if (
    /\b(?:how many minutes|minutes left|call minutes|deadline|help|what can you do|who are you|hello|goodbye)\b/.test(
      phrase,
    )
  ) {
    return { name: "ask_inbox", args: { question: original } };
  }

  return { name: "ask_inbox", args: { question: original } };
}

export function confirmationDraftId(spoken: string): string | null {
  const match = spoken.match(/Confirmation code ([A-Za-z0-9]+)\./);
  return match?.[1] ?? null;
}
