/**
 * Chunk an email body across spoken turns instead of truncating it.
 *
 * Blind patrons hear the whole message: each turn reads as much as fits one
 * comfortable TTS turn, breaks on a sentence or paragraph boundary, and always
 * says how much is left plus how to hear it. Offsets are absolute into the
 * prepared text so the server can resume without the model remembering one.
 */

/** Spoken lead-in used when the quoted reply chain starts. */
export const QUOTED_THREAD_LEAD = "Now the earlier thread.";

export type PreparedBody = {
  /** Whitespace-normalized speech text: new content, then quoted thread. */
  text: string;
  /** Offset where the quoted thread begins; equals text.length when none. */
  mainLength: number;
  hasQuotedThread: boolean;
};

export type BodyChunk = {
  spoken: string;
  /** Absolute offset to resume from; 0 when the body is finished. */
  nextOffset: number;
  hasMore: boolean;
  remainingChars: number;
  /** True when this chunk stopped right before the quoted reply chain. */
  endsAtQuotedBoundary: boolean;
};

/** Shortest chunk we will end on a boundary rather than filling the budget. */
const BOUNDARY_SEARCH_FLOOR = 0.5;
/** Below this, a body is too short to contain a real quoted thread. */
const MIN_MAIN_CHARS_BEFORE_QUOTE = 120;

const SIGNATURE_NOISE = [
  /\bSent from my (?:iPhone|iPad|Android|Samsung|BlackBerry|mobile device|Galaxy)\b[.!]?/gi,
  /\bGet Outlook for (?:iOS|Android)\b[.!]?/gi,
  /\bSent via (?:mobile|BlackBerry)\b[.!]?/gi,
];

/**
 * Where the quoted reply chain starts, or null.
 * Bodies are stored whitespace-collapsed, so these markers appear inline.
 */
export function findQuotedThreadStart(text: string): number | null {
  const patterns = [
    /-{2,}\s*Original Message\s*-{2,}/i,
    /-{3,}\s*Forwarded message\s*-{3,}/i,
    /\bOn\s.{6,140}?\bwrote:/i,
    /\bFrom:\s.{3,160}?\bSent:\s/i,
    /(?:^|\s)>\s?\S/,
  ];
  let best: number | null = null;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const index = match.index;
    if (index < MIN_MAIN_CHARS_BEFORE_QUOTE) continue;
    if (best === null || index < best) best = index;
  }
  return best;
}

/**
 * Normalize a stored body for speech and separate the quoted reply chain.
 * Nothing is dropped: the quoted thread is kept as later content.
 */
export function prepareBodyForSpeech(raw: string): PreparedBody {
  let cleaned = (raw ?? "").replace(/\s+/g, " ").trim();
  for (const pattern of SIGNATURE_NOISE) {
    cleaned = cleaned.replace(pattern, " ");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return { text: "", mainLength: 0, hasQuotedThread: false };
  }

  const quoteStart = findQuotedThreadStart(cleaned);
  if (quoteStart === null) {
    return { text: cleaned, mainLength: cleaned.length, hasQuotedThread: false };
  }

  const main = cleaned.slice(0, quoteStart).trim();
  const quoted = cleaned.slice(quoteStart).trim();
  if (!main || !quoted) {
    return { text: cleaned, mainLength: cleaned.length, hasQuotedThread: false };
  }

  const lead = `${main} ${QUOTED_THREAD_LEAD}`;
  return {
    text: `${lead} ${quoted}`,
    mainLength: lead.length,
    hasQuotedThread: true,
  };
}

/** Read as much of the prepared body as fits, ending on a natural boundary. */
export function chunkBodyForSpeech(
  prepared: PreparedBody,
  startOffset: number,
  maxChars: number,
): BodyChunk {
  const text = prepared.text;
  const start = Math.max(
    0,
    Math.min(Math.floor(startOffset) || 0, text.length),
  );
  const max = Math.max(120, Math.floor(maxChars));
  const rest = text.slice(start);

  if (!rest.trim()) {
    return {
      spoken: "",
      nextOffset: 0,
      hasMore: false,
      remainingChars: 0,
      endsAtQuotedBoundary: false,
    };
  }

  if (rest.length <= max) {
    return {
      spoken: rest.trim(),
      nextOffset: 0,
      hasMore: false,
      remainingChars: 0,
      endsAtQuotedBoundary: false,
    };
  }

  // Stop exactly where the new content ends so we can name the quoted thread.
  if (
    prepared.hasQuotedThread &&
    prepared.mainLength > start &&
    prepared.mainLength - start <= max
  ) {
    return {
      spoken: text.slice(start, prepared.mainLength).trim(),
      nextOffset: prepared.mainLength,
      hasMore: true,
      remainingChars: text.length - prepared.mainLength,
      endsAtQuotedBoundary: true,
    };
  }

  const window = text.slice(start, start + max);
  const cut = boundaryWithin(window, Math.floor(max * BOUNDARY_SEARCH_FLOOR));
  const end = start + cut;
  return {
    spoken: text.slice(start, end).trim(),
    nextOffset: end,
    hasMore: true,
    remainingChars: text.length - end,
    endsAtQuotedBoundary: false,
  };
}

/** Rough word count so remainders are spoken in human terms. */
export function estimateSpokenWords(chars: number): number {
  return Math.max(1, Math.round(chars / 5.5));
}

/** Always-honest tail: what is left and exactly how to hear it. */
export function speakBodyRemainder(chunk: BodyChunk): string {
  if (!chunk.hasMore) return "";
  if (chunk.endsAtQuotedBoundary) {
    return "That is the end of the new part of this message. The rest is the earlier thread — say continue to hear it, or say next to skip to the next email.";
  }
  return `There is more of this message — about ${estimateSpokenWords(chunk.remainingChars)} words remain. Say continue to hear the rest, or say next to skip to the next email.`;
}

function boundaryWithin(window: string, minLength: number): number {
  const sentence = lastBoundaryEnd(window, /[.!?…](?=\s|$)/g, minLength);
  if (sentence !== null) return sentence;
  const clause = lastBoundaryEnd(window, /[;:,](?=\s)/g, minLength);
  if (clause !== null) return clause;
  const space = window.lastIndexOf(" ");
  if (space >= minLength) return space;
  return window.length;
}

function lastBoundaryEnd(
  window: string,
  pattern: RegExp,
  minLength: number,
): number | null {
  let best: number | null = null;
  let match: RegExpExecArray | null;
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  while ((match = re.exec(window)) !== null) {
    const end = match.index + match[0].length;
    if (end >= minLength) best = end;
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  return best;
}
