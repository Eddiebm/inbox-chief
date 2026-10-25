import type { ProviderId } from "@/lib/research/types";

export type SpokenCommand =
  | "stop"
  | "repeat"
  | "slower"
  | "faster"
  | "explain_more"
  | "short"
  | "back"
  | "correct"
  | "save"
  | "email_self"
  | "resume_yesterday"
  | "status"
  | "cancel"
  | "help"
  | "sources";

export type ParsedTurn =
  | { type: "command"; command: SpokenCommand }
  | { type: "correct_to"; replacement: string }
  | { type: "confirm_yes" }
  | { type: "confirm_no" }
  | { type: "delete_confirm" }
  | {
      type: "research";
      question: string;
      projectHint: string | null;
      emailSelf: boolean;
      generalKnowledge: boolean;
    }
  | { type: "dictate"; text: string; projectHint: string | null }
  | { type: "analyze" }
  | { type: "resume"; query: string }
  | {
      type: "retrieve";
      about: string;
      when: "yesterday" | "last_weekday" | null;
      weekday: number | null;
      speaker: "OWNER" | "any";
      kind: "dictation" | "follow_up" | "any";
    }
  | { type: "provider"; provider: ProviderId; question: string | null }
  | { type: "compare" }
  | { type: "email_other"; recipient: string | null }
  | { type: "inbox_read" }
  | { type: "inbox_draft"; instruction: string }
  | { type: "inbox_readback" }
  | { type: "inbox_edit"; instruction: string }
  | { type: "inbox_send" }
  | { type: "delete_session" }
  | { type: "conversation"; text: string };

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalized(text: string): string {
  return clean(text)
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.?!]+$/g, "")
    .trim();
}

const EXACT_COMMANDS: Array<[string, SpokenCommand]> = [
  ["what are you doing", "status"],
  ["give me the short version", "short"],
  ["short version", "short"],
  ["explain more", "explain_more"],
  ["read the sources", "sources"],
  ["what are the sources", "sources"],
  ["email this to me", "email_self"],
  ["email me", "email_self"],
  ["continue yesterday's discussion", "resume_yesterday"],
  ["continue yesterdays discussion", "resume_yesterday"],
  ["correct that", "correct"],
  ["save this", "save"],
  ["go back", "back"],
  ["slower", "slower"],
  ["faster", "faster"],
  ["repeat", "repeat"],
  ["repeat that", "repeat"],
  ["stop", "stop"],
  ["cancel", "cancel"],
  ["help", "help"],
];

export function extractProjectHint(text: string): string | null {
  const match = text.match(
    /\b(?:save (?:this|it) )?(?:under|in project|into)\s+(?:the\s+)?(.+?)(?=\s*(?:,|and email|and send|\.|$))/i,
  );
  if (!match?.[1]) return null;
  const hint = match[1].replace(/\bproject\b/i, "").trim();
  return hint || null;
}

export function wantsEmailSelf(text: string): boolean {
  return /\bemail (this to )?me\b/i.test(text);
}

function stripResearchDecorations(text: string): string {
  return text
    .replace(/\bfind original papers\b/gi, "")
    .replace(/\bexplain the evidence\b/gi, "")
    .replace(/\bsave (?:this|it) under\s+.+?(?=,|and email|$)/gi, "")
    .replace(/\bunder\s+.+?(?=,|and email|$)/gi, "")
    .replace(/\band email (this to )?me\b/gi, "")
    .replace(/\bemail (this to )?me\b/gi, "")
    .replace(/^research\b[:\s-]*/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
    .trim();
}

function providerFromWord(word: string): ProviderId | null {
  const value = word.toLowerCase();
  if (value === "claude" || value === "anthropic") return "anthropic";
  if (value === "openai" || value === "chatgpt") return "openai";
  if (value === "grok" || value === "xai") return "xai";
  return null;
}

export function parseTurn(raw: string, mode: "conversation" | "dictation" | "push_to_talk" = "conversation"): ParsedTurn {
  const text = clean(raw);
  const key = normalized(text);
  if (!key) return { type: "conversation", text: "" };

  for (const [phrase, command] of EXACT_COMMANDS) {
    if (key === phrase) return { type: "command", command };
  }

  if (/^yes, delete it$/.test(key) || key === "yes delete it") {
    return { type: "delete_confirm" };
  }
  if (key === "yes" || key === "yes that's right" || key === "that's right" || key === "confirm") {
    return { type: "confirm_yes" };
  }
  if (key === "no" || key === "no that's wrong" || key === "that's wrong") {
    return { type: "confirm_no" };
  }

  const correctTo = text.match(/^correct that(?:\s+to)?\s+(.+)$/i);
  if (correctTo?.[1]) return { type: "correct_to", replacement: correctTo[1].trim() };

  if (/^delete this session$/.test(key)) return { type: "delete_session" };
  if (/^compare( the)?( two)? answers?$/.test(key)) return { type: "compare" };
  if (key === "analyze this" || key === "analyse this") return { type: "analyze" };
  if (key === "read my new emails" || key === "read my new email") return { type: "inbox_read" };
  if (key === "read it back") return { type: "inbox_readback" };
  if (key === "send it") return { type: "inbox_send" };
  if (key === "use general knowledge") {
    return { type: "research", question: "", projectHint: null, emailSelf: false, generalKnowledge: true };
  }

  const edit = text.match(/^change the second paragraph(?:\s+to)?\s+(.+)$/i);
  if (edit?.[1]) return { type: "inbox_edit", instruction: edit[1].trim() };

  const draft = text.match(/^draft a reply(?:\s+(.+))?$/i);
  if (draft) return { type: "inbox_draft", instruction: (draft[1] ?? "").trim() };

  const provider = key.match(/^(?:ask|use)\s+(claude|anthropic|openai|chatgpt|grok|xai)\b(?:\s+(.*))?$/);
  if (provider?.[1]) {
    const id = providerFromWord(provider[1]);
    if (id) {
      const rest = (provider[2] ?? "").trim();
      const question = !rest || /^for another opinion$/.test(rest) ? null : rest;
      return { type: "provider", provider: id, question };
    }
  }

  if (key === "continue yesterday's discussion" || key === "continue yesterdays discussion") {
    return { type: "command", command: "resume_yesterday" };
  }

  const resume = text.match(/^continue (?:our|the) (.+)$/i);
  if (resume?.[1]) {
    const query = resume[1].replace(/\b(discussion|research)\b/gi, "").trim();
    return { type: "resume", query: query || resume[1].trim() };
  }

  if (key === "read my unanswered research questions") {
    return { type: "retrieve", about: "", when: null, weekday: null, speaker: "any", kind: "follow_up" };
  }
  if (/^which ideas did i dictate yesterday$/.test(key)) {
    return { type: "retrieve", about: "", when: "yesterday", weekday: null, speaker: "OWNER", kind: "dictation" };
  }
  if (/^which ideas did i dictate$/.test(key)) {
    return { type: "retrieve", about: "", when: null, weekday: null, speaker: "OWNER", kind: "dictation" };
  }

  const said = text.match(/^find what i said about\s+(.+)$/i);
  if (said?.[1]) {
    return finishRetrieve(said[1], "OWNER", "any");
  }

  const otherEmail = text.match(/^email (?:this to|to)?\s*(them|him|her|someone)$/i);
  if (otherEmail) return { type: "email_other", recipient: null };
  const addressed = text.match(/^email (?:this to|to)\s+(.+)$/i);
  if (addressed?.[1] && !/^me$/i.test(addressed[1].trim())) {
    return { type: "email_other", recipient: addressed[1].trim() };
  }

  if (mode === "dictation" || /^(dictate|take a note|idea:)\b/i.test(text)) {
    const body = text.replace(/^(dictate|take a note|idea:)\s*/i, "").trim();
    return { type: "dictate", text: body || text, projectHint: extractProjectHint(text) };
  }

  if (/^\s*research\b/i.test(text) || /\bfind original papers\b/i.test(text) || /\bexplain the evidence\b/i.test(text)) {
    return {
      type: "research",
      question: stripResearchDecorations(text),
      projectHint: extractProjectHint(text),
      emailSelf: wantsEmailSelf(text),
      generalKnowledge: false,
    };
  }

  return { type: "conversation", text };
}

function finishRetrieve(aboutRaw: string, speaker: "OWNER" | "any", kind: "dictation" | "follow_up" | "any"): ParsedTurn {
  let about = aboutRaw.trim();
  let when: "yesterday" | "last_weekday" | null = null;
  let weekday: number | null = null;
  const yesterday = about.match(/\s+yesterday$/i);
  if (yesterday) {
    when = "yesterday";
    about = about.slice(0, yesterday.index).trim();
  } else {
    const last = about.match(/\s+last\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i);
    if (last?.[1] && last.index != null) {
      when = "last_weekday";
      weekday = WEEKDAYS[last[1].toLowerCase()] ?? null;
      about = about.slice(0, last.index).trim();
    }
  }
  return { type: "retrieve", about, when, weekday, speaker, kind };
}

/** Turns Courtney can do by speaking, without touching the inbox reader. */
export function isHandsFreeResearchTurn(turn: ParsedTurn): boolean {
  switch (turn.type) {
    case "research":
    case "dictate":
    case "analyze":
    case "resume":
    case "retrieve":
    case "provider":
    case "compare":
    case "correct_to":
    case "confirm_yes":
    case "confirm_no":
    case "delete_confirm":
    case "delete_session":
    case "email_other":
      return true;
    case "command":
      switch (turn.command) {
        case "explain_more":
        case "short":
        case "sources":
        case "email_self":
        case "save":
        case "correct":
        case "cancel":
        case "status":
        case "resume_yesterday":
          return true;
        case "stop":
        case "repeat":
        case "slower":
        case "faster":
        case "back":
        case "help":
          return false;
        default: {
          const never: never = turn.command;
          return never;
        }
      }
    case "inbox_read":
    case "inbox_draft":
    case "inbox_readback":
    case "inbox_edit":
    case "inbox_send":
    case "conversation":
      return false;
    default: {
      const never: never = turn;
      return never;
    }
  }
}

export function startsNewResearchSession(turn: ParsedTurn): boolean {
  if (turn.type === "research" || turn.type === "dictate" || turn.type === "resume" || turn.type === "retrieve") return true;
  if (turn.type === "provider" && turn.question) return true;
  return false;
}

export function isLocalPlaybackCommand(turn: ParsedTurn): boolean {
  return (
    turn.type === "command" &&
    (turn.command === "stop" ||
      turn.command === "repeat" ||
      turn.command === "slower" ||
      turn.command === "faster" ||
      turn.command === "back")
  );
}
