export type TalkCommand =
  | "stop"
  | "repeat"
  | "slower"
  | "faster"
  | "normal"
  | "next"
  | "previous"
  | "continue";

function spoken(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
}

/**
 * Exact short controls. Longer requests ("read the next email", "what is next
 * on my calendar") stay null so they are sent to the phone tools as written.
 */
export function talkCommand(text: string): TalkCommand | null {
  const phrase = spoken(text);
  if (!phrase) return null;
  if (/^(?:please )?(?:stop|quiet|shush)$/.test(phrase)) return "stop";
  if (/^(?:please )?(?:repeat|repeat that|say that again|again|read it again|read that again)$/.test(phrase)) {
    return "repeat";
  }
  if (/^(?:please )?(?:slower|slow down|too fast)$/.test(phrase)) return "slower";
  if (/^(?:please )?(?:faster|speed up|too slow)$/.test(phrase)) return "faster";
  if (/^(?:please )?(?:normal speed|regular speed)$/.test(phrase)) return "normal";
  if (
    /^(?:please )?(?:next(?: (?:email|message|one|mail))?|skip(?: this(?: (?:email|message))?)?|move on|another(?: (?:email|one))?|go on)$/.test(
      phrase,
    )
  ) {
    return "next";
  }
  if (/^(?:please )?(?:previous(?: (?:email|message|one))?|go back|back up)$/.test(phrase)) {
    return "previous";
  }
  if (/^(?:please )?(?:continue|more|keep going|keep reading|read the rest|rest of it)$/.test(phrase)) {
    return "continue";
  }
  return null;
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
