/**
 * Read position for call-in email reading.
 *
 * Blind patrons walk the Primary inbox one message at a time, so "next" has to
 * advance even when the voice model forgets to pass an index. The cursor is
 * stored per CallInIdentity and scoped to the provider call id, so every new
 * call starts at the newest message again.
 */

export type CallInReadPosition =
  | "first"
  | "next"
  | "previous"
  | "repeat"
  /** Resume the current message's body/attachment where speech stopped. */
  | "continue"
  /** Abandon the current message's remainder and move on. */
  | "skip";

/** Fallback freshness window when the provider gives us no call id. */
export const READ_CURSOR_STALE_MS = 20 * 60 * 1000;

export type StoredReadCursor = {
  index: number;
  callId: string | null;
  scope: string | null;
  at: Date | null;
  /** Absolute offset into the current message's prepared body text. */
  bodyOffset: number;
  /** Message key the body offset belongs to. */
  bodyKey: string | null;
  /** Absolute offset into the current attachment's extracted text. */
  attachmentOffset: number;
  /** `messageKey\u0000attachmentIndex` the attachment offset belongs to. */
  attachmentKey: string | null;
};

export function parseReadPosition(
  args: Record<string, unknown> | undefined,
): CallInReadPosition | null {
  const raw = args?.position ?? args?.direction ?? args?.cursor;
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  switch (value) {
    case "first":
    case "start":
    case "restart":
    case "beginning":
      return "first";
    case "next":
    case "forward":
      return "next";
    case "skip":
    case "skip_this":
    case "skip this":
      return "skip";
    case "continue":
    case "more":
    case "rest":
    case "keep_reading":
    case "keep reading":
      return "continue";
    case "previous":
    case "back":
    case "prior":
      return "previous";
    case "repeat":
    case "again":
    case "current":
      return "repeat";
    default:
      return null;
  }
}

/** True when the stored cursor belongs to this call and can be trusted. */
export function isCursorUsable(
  stored: StoredReadCursor | null,
  callId: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!stored || !stored.at) return false;
  if (stored.callId && callId) return stored.callId === callId;
  if (stored.callId && !callId) return false;
  return now.getTime() - stored.at.getTime() <= READ_CURSOR_STALE_MS;
}

/**
 * Where to start reading.
 *
 * An explicit index always wins. Otherwise the stored cursor moves forward,
 * which means a plain `read_emails` call with no arguments continues rather
 * than repeating the message the caller just heard.
 */
export function computeReadStartIndex(input: {
  position: CallInReadPosition | null;
  explicitStartIndex: number | null;
  stored: StoredReadCursor | null;
  callId?: string | null;
  now?: Date;
}): number {
  if (
    typeof input.explicitStartIndex === "number" &&
    Number.isFinite(input.explicitStartIndex) &&
    input.explicitStartIndex >= 0
  ) {
    return Math.floor(input.explicitStartIndex);
  }

  const usable = isCursorUsable(input.stored, input.callId, input.now);
  const storedIndex = usable ? Math.max(0, input.stored?.index ?? 0) : 0;

  switch (input.position) {
    case "first":
      return 0;
    case "repeat":
    // Continuing stays on the message the caller is already hearing.
    case "continue":
      return Math.max(0, storedIndex - 1);
    case "previous":
      return Math.max(0, storedIndex - 2);
    case "next":
    // Skip abandons the current remainder, so it lands where next would.
    case "skip":
      return storedIndex > 0 ? storedIndex : 1;
    case null:
      return storedIndex;
    default: {
      const exhaustive: never = input.position;
      return exhaustive;
    }
  }
}

/**
 * Body offset to resume from, but only for the message it was recorded against.
 * Any other message starts at the beginning so a caller never hears a stray
 * middle-of-body fragment.
 */
export function resumeBodyOffset(
  stored: StoredReadCursor | null,
  messageKey: string | null | undefined,
): number {
  if (!stored || !messageKey) return 0;
  if (stored.bodyKey !== messageKey) return 0;
  return Math.max(0, stored.bodyOffset);
}

export function attachmentCursorKey(
  messageKey: string,
  attachmentIndex: number,
  all = false,
): string {
  return `${messageKey}\u0000${Math.max(0, Math.floor(attachmentIndex))}\u0000${all ? "all" : "one"}`;
}

/** Which attachment of this message still owes text, and from where. */
export function resumeAttachmentCursor(
  stored: StoredReadCursor | null,
  messageKey: string | null | undefined,
): { index: number; offset: number; all: boolean } | null {
  if (!stored?.attachmentKey || !messageKey) return null;
  const parts = stored.attachmentKey.split("\u0000");
  if (parts.length < 2 || parts[0] !== messageKey) return null;
  const index = Number(parts[1]);
  if (!Number.isFinite(index) || index < 0) return null;
  return {
    index: Math.floor(index),
    offset: Math.max(0, stored.attachmentOffset),
    all: parts[2] === "all",
  };
}

type CursorRow = {
  readCursorIndex: number;
  readCursorCallId: string | null;
  readCursorScope: string | null;
  readCursorAt: Date | null;
  readBodyOffset: number;
  readBodyKey: string | null;
  readAttachmentOffset: number;
  readAttachmentKey: string | null;
};

type PrismaLikeForCursor = {
  callInIdentity: {
    findUnique: (args: {
      where: { id: string };
      select: Record<keyof CursorRow, true>;
    }) => Promise<CursorRow | null>;
    update: (args: {
      where: { id: string };
      data: {
        readCursorIndex: number;
        readCursorCallId: string | null;
        readCursorScope: string | null;
        readCursorAt: Date;
        readBodyOffset: number;
        readBodyKey: string | null;
        readAttachmentOffset: number;
        readAttachmentKey: string | null;
      };
    }) => Promise<unknown>;
  };
};

async function cursorPrisma(): Promise<PrismaLikeForCursor | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    return getNodePrisma() as unknown as PrismaLikeForCursor;
  } catch {
    return null;
  }
}

export async function loadReadCursor(
  callInIdentityId: string | null | undefined,
): Promise<StoredReadCursor | null> {
  if (!callInIdentityId) return null;
  const prisma = await cursorPrisma();
  if (!prisma) return null;
  try {
    const row = await prisma.callInIdentity.findUnique({
      where: { id: callInIdentityId },
      select: {
        readCursorIndex: true,
        readCursorCallId: true,
        readCursorScope: true,
        readCursorAt: true,
        readBodyOffset: true,
        readBodyKey: true,
        readAttachmentOffset: true,
        readAttachmentKey: true,
      },
    });
    if (!row) return null;
    return {
      index: row.readCursorIndex,
      callId: row.readCursorCallId,
      scope: row.readCursorScope,
      at: row.readCursorAt,
      bodyOffset: row.readBodyOffset ?? 0,
      bodyKey: row.readBodyKey ?? null,
      attachmentOffset: row.readAttachmentOffset ?? 0,
      attachmentKey: row.readAttachmentKey ?? null,
    };
  } catch (err) {
    console.warn("[call-in] read cursor load failed", err);
    return null;
  }
}

/** Best-effort persist — a failed write must never interrupt speech. */
export async function saveReadCursor(input: {
  callInIdentityId: string | null | undefined;
  index: number;
  callId?: string | null;
  /** Inbox scope or a serialized subset descriptor. */
  scope?: string;
  /** Where the current message's body stopped; 0 clears the remainder. */
  bodyOffset?: number;
  bodyKey?: string | null;
  /** Where the current attachment's text stopped; 0 clears the remainder. */
  attachmentOffset?: number;
  attachmentKey?: string | null;
}): Promise<void> {
  if (!input.callInIdentityId) return;
  const prisma = await cursorPrisma();
  if (!prisma) return;
  try {
    await prisma.callInIdentity.update({
      where: { id: input.callInIdentityId },
      data: {
        readCursorIndex: Math.max(0, Math.floor(input.index)),
        readCursorCallId: input.callId ?? null,
        readCursorScope: input.scope ?? null,
        readCursorAt: new Date(),
        readBodyOffset: Math.max(0, Math.floor(input.bodyOffset ?? 0)),
        readBodyKey: input.bodyKey ?? null,
        readAttachmentOffset: Math.max(
          0,
          Math.floor(input.attachmentOffset ?? 0),
        ),
        readAttachmentKey: input.attachmentKey ?? null,
      },
    });
  } catch (err) {
    console.warn("[call-in] read cursor save failed", err);
  }
}
