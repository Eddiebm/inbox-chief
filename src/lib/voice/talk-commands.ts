export type TalkCommand =
  | "stop"
  | "repeat"
  | "slower"
  | "faster"
  | "normal"
  | "next"
  | "previous"
  | "continue";

export type TalkSendDecision = "confirm_send" | "decline_send";

export type TalkHearingAlternative = {
  transcript: string;
  confidence: number;
};

/** Below this, a final may be a mishear. 0 means the engine omitted a score. */
const LOW_CONFIDENCE = 0.5;

function spoken(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ");
}

const LEADING_FILLER =
  /^(?:um|uh|er|ah|hmm|hm|please|hey|okay|ok|yeah|yep|just|so|well|can you|could you|would you|will you)\s+/;
const TRAILING_FILLER = /\s+(?:please|thanks|thank you|now)$/;

/** Drop polite wrappers around a short control. The core phrase still has to match. */
function stripFillers(phrase: string): string {
  let current = phrase;
  for (let i = 0; i < 4; i += 1) {
    const next = current.replace(LEADING_FILLER, "").replace(TRAILING_FILLER, "");
    if (next === current) return current;
    current = next;
  }
  return current;
}

function normalizeSend(text: string): string {
  return stripFillers(
    text
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/g, "")
      .replace(/[\u2019']/g, "")
      .replace(/[,]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/**
 * Questions, calendar, and research stay out of the playback matcher.
 * "the next email" is a control. "what is next on my calendar" is not.
 */
function isNotAPlaybackControl(phrase: string): boolean {
  if (/\b(?:papers?|research|evidence|calendar|schedule|agenda)\b/.test(phrase)) return true;
  if (/^(?:what|why|when|where|who|how|which)\b/.test(phrase)) return true;
  if (/\bemail (?:this to )?me\b/.test(phrase)) return true;
  if (/\bfind papers\b/.test(phrase)) return true;
  return false;
}

const STOP =
  /^(?:stop|stop talking|stop speaking|stop it|be quiet|quiet|shush|hush)$/;
const REPEAT =
  /^(?:repeat(?: that)?|say that again|say it again|again|read it again|read that again|read that one again)$/;
const SLOWER =
  /^(?:slower|slow down|slow it down|too fast|not so fast|speak slower|talk slower|read slower|go slower)$/;
const FASTER =
  /^(?:faster|speed up|speed it up|too slow|speak faster|talk faster|read faster|go faster)$/;
const NORMAL = /^(?:normal speed|regular speed|normal pace|regular pace)$/;
const NEXT =
  /^(?:(?:go to|go)\s+)?(?:the\s+|a\s+)?(?:next(?:\s+(?:email|message|one|mail))?|skip(?:\s+this(?:\s+(?:email|message|one))?)?|move on(?:\s+to\s+the\s+next(?:\s+(?:email|message|mail|one))?)?|another(?:\s+(?:email|message|one))?|go on|stop reading(?:\s+(?:this|it)(?:\s+(?:email|message|one))?)?)$/;
const PREVIOUS =
  /^(?:(?:go to|go)\s+)?(?:the\s+|a\s+)?previous(?:\s+(?:email|message|one|mail))?$|^(?:go back|back up)$/;
const CONTINUE =
  /^(?:continue|more|keep going|keep reading|read the rest|rest of it)$/;

/**
 * Short playback controls, including slightly inexact speech ("go next",
 * "the next email", "stop talking"). Longer mail requests ("read the next
 * email", "what is next on my calendar") stay null so the phone tools see
 * the original words.
 */
export function talkCommand(text: string): TalkCommand | null {
  const phrase = stripFillers(spoken(text));
  if (!phrase || isNotAPlaybackControl(phrase)) return null;
  if (STOP.test(phrase)) return "stop";
  if (REPEAT.test(phrase)) return "repeat";
  if (SLOWER.test(phrase)) return "slower";
  if (FASTER.test(phrase)) return "faster";
  if (NORMAL.test(phrase)) return "normal";
  if (NEXT.test(phrase)) return "next";
  if (PREVIOUS.test(phrase)) return "previous";
  if (CONTINUE.test(phrase)) return "continue";
  return null;
}

const CONFIRM =
  /^(?:(?:please|okay|ok|go ahead and|go ahead)\s+)?(?:approve|send it|send this|send that|y(?:es|eah|ep)\s+send(?:\s+(?:it|this|that))?)$/;
const DECLINE =
  /^(?:please\s+)?(?:no thanks|do not send(?:\s+(?:it|this|that))?|dont send(?:\s+(?:it|this|that))?|change it|cancel that|no)$/;

/**
 * Explicit send or cancel. A bare "yes", "next", or a composed message is not
 * a confirmation. "send it" and "don't send" are.
 */
export function talkSendDecision(text: string): TalkSendDecision | null {
  const phrase = normalizeSend(text);
  if (!phrase) return null;
  if (/^(?:yes|yeah|yep|yup|sure|ok|okay|go ahead|please)$/.test(phrase)) return null;
  if (CONFIRM.test(phrase)) return "confirm_send";
  if (DECLINE.test(phrase)) return "decline_send";
  return null;
}

function hearingIsProtected(transcript: string): boolean {
  const phrase = spoken(transcript);
  if (!phrase) return false;
  if (isNotAPlaybackControl(phrase)) return true;
  return phrase.split(" ").length > 5;
}

/**
 * Keep a final the recognizer is unsure about when it is already one control.
 * A weaker alternative may replace a low-confidence mishear only when that
 * alternative is a single playback command. Send is never promoted from a
 * lower-ranked guess.
 */
export function preferTalkHearing(
  alternatives: readonly TalkHearingAlternative[],
): string | null {
  const items = alternatives
    .map((item) => ({
      transcript: item.transcript.trim(),
      confidence: Number.isFinite(item.confidence) ? item.confidence : 0,
    }))
    .filter((item) => item.transcript.length > 0);
  if (items.length === 0) return null;
  const top = items[0];
  if (!top) return null;
  if (talkCommand(top.transcript) || talkSendDecision(top.transcript)) {
    return top.transcript;
  }
  if (top.confidence <= 0 || top.confidence >= LOW_CONFIDENCE) return top.transcript;
  if (hearingIsProtected(top.transcript)) return top.transcript;
  const commandAlts = items.filter((item) => talkCommand(item.transcript));
  const kinds = new Set(commandAlts.map((item) => talkCommand(item.transcript)));
  if (kinds.size !== 1) return top.transcript;
  const chosen = commandAlts.reduce((best, item) =>
    item.confidence > best.confidence ? item : best,
  );
  if (chosen.confidence + 0.05 >= top.confidence) return chosen.transcript;
  return top.transcript;
}

/**
 * A short control heard while mail is being read.
 * Returns null when the microphone only caught the words currently being spoken.
 */
export function talkInterrupt(
  piece: string,
  spokenText: string,
  charIndex: number | null,
): TalkCommand | null {
  const command = talkCommand(piece);
  if (!command) return null;
  if (command !== "next" && command !== "continue") return command;
  if (charIndex == null || charIndex < 0) return command;
  const phrase = spoken(piece);
  const window = spokenText
    .slice(Math.max(0, charIndex - 20), charIndex + phrase.length + 24)
    .toLowerCase();
  if (window.includes(phrase)) return null;
  return command;
}
