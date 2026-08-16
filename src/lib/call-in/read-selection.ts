import type {
  CallInMailboxSnapshot,
  CallInReadableEmail,
} from "@/lib/call-in/assistant";
import type { CallInInboxScope } from "@/lib/call-in/primary-inbox";

export const MAX_CALL_IN_SELECTION_COUNT = 20;

export type CallInReadSelectionScope = "new" | "all" | "oldest" | "newest";

export type StoredReadSelection = {
  version: 1;
  inboxScope: CallInInboxScope;
  selectionScope: CallInReadSelectionScope | "index";
  messageKeys: string[];
  continuationKeys?: string[];
  requestedCount?: number;
  requestedIndex?: number;
};

export function parseSelectionScope(
  args: Record<string, unknown> | undefined,
): CallInReadSelectionScope | null {
  const raw = args?.selection ?? args?.selectionScope ?? args?.selection_scope ?? args?.scope;
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  switch (value) {
    case "new":
      return "new";
    case "all":
      return "all";
    case "oldest":
    case "last":
      return "oldest";
    case "newest":
    case "first":
    case "recent":
      return "newest";
    default:
      return null;
  }
}

export function parseSelectionCount(
  args: Record<string, unknown> | undefined,
): number | null {
  const raw = args?.count ?? args?.limit;
  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.min(MAX_CALL_IN_SELECTION_COUNT, Math.floor(parsed));
}

export function parseSelectionIndex(
  args: Record<string, unknown> | undefined,
): number | null {
  const raw = args?.index ?? args?.emailNumber ?? args?.email_number;
  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
}

export function readableEmailKey(email: CallInReadableEmail): string {
  return (
    email.messageId ||
    email.gmailMessageId ||
    `${email.receivedAt ?? ""}\u0000${email.fromAddress}\u0000${email.subject}`
  );
}

export function encodeStoredReadSelection(selection: StoredReadSelection): string {
  return JSON.stringify(selection);
}

export function decodeStoredReadSelection(
  value: string | null | undefined,
): StoredReadSelection | null {
  if (!value?.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredReadSelection>;
    if (
      parsed.version !== 1 ||
      !isInboxScope(parsed.inboxScope) ||
      !isStoredSelectionScope(parsed.selectionScope) ||
      !Array.isArray(parsed.messageKeys) ||
      !parsed.messageKeys.every((key) => typeof key === "string")
    ) {
      return null;
    }
    return {
      version: 1,
      inboxScope: parsed.inboxScope,
      selectionScope: parsed.selectionScope,
      messageKeys: parsed.messageKeys,
      ...(Array.isArray(parsed.continuationKeys) &&
      parsed.continuationKeys.every((key) => typeof key === "string")
        ? { continuationKeys: parsed.continuationKeys }
        : {}),
      ...(typeof parsed.requestedCount === "number"
        ? { requestedCount: parsed.requestedCount }
        : {}),
      ...(typeof parsed.requestedIndex === "number"
        ? { requestedIndex: parsed.requestedIndex }
        : {}),
    };
  } catch {
    return null;
  }
}

export function emailsFromStoredSelection(
  available: CallInReadableEmail[],
  keys: string[],
): CallInReadableEmail[] {
  const byKey = new Map(available.map((email) => [readableEmailKey(email), email]));
  return keys.flatMap((key) => {
    const email = byKey.get(key);
    return email ? [email] : [];
  });
}

export function createReadSelection(input: {
  emails: CallInReadableEmail[];
  snapshot: Pick<CallInMailboxSnapshot, "lastSuccessfulCallAt">;
  inboxScope: CallInInboxScope;
  selectionScope: CallInReadSelectionScope;
  count: number | null;
  index: number | null;
  startAfterIndex?: number;
}): {
  emails: CallInReadableEmail[];
  stored: StoredReadSelection;
  confirmation: string;
  emptySpoken?: string;
} {
  const available = input.emails;
  const requestedCount = input.count;

  if (input.index !== null) {
    const zeroBased = input.index - 1;
    const selected = available[zeroBased] ? [available[zeroBased]!] : [];
    const stored: StoredReadSelection = {
      version: 1,
      inboxScope: input.inboxScope,
      selectionScope: "index",
      messageKeys: selected.map(readableEmailKey),
      continuationKeys: available.slice(zeroBased + 1).map(readableEmailKey),
      requestedIndex: input.index,
    };
    if (selected.length === 0) {
      return {
        emails: [],
        stored,
        confirmation: "",
        emptySpoken: `There are only ${available.length} messages in the readable window, so there is no number ${input.index}.`,
      };
    }
    return {
      emails: selected,
      stored,
      confirmation: `Reading just number ${input.index}.`,
    };
  }

  let candidates = available;
  if (typeof input.startAfterIndex === "number") {
    candidates = available.slice(Math.max(0, input.startAfterIndex + 1));
  } else if (input.selectionScope === "new") {
    const since = parseDate(input.snapshot.lastSuccessfulCallAt);
    candidates = since
      ? available.filter((email) => {
          const received = parseDate(email.receivedAt);
          return received !== null && received.getTime() > since.getTime();
        })
      : available;
  } else if (input.selectionScope === "oldest") {
    candidates = [...available].reverse();
  }

  const cap = requestedCount ?? MAX_CALL_IN_SELECTION_COUNT;
  const selected = candidates.slice(0, cap);
  const stored: StoredReadSelection = {
    version: 1,
    inboxScope: input.inboxScope,
    selectionScope: input.selectionScope,
    messageKeys: selected.map(readableEmailKey),
    ...(requestedCount !== null ? { requestedCount } : {}),
  };

  if (selected.length === 0 && input.selectionScope === "new") {
    return {
      emails: [],
      stored,
      confirmation: "",
      emptySpoken:
        input.inboxScope === "primary"
          ? "There are no new emails in Primary since your last call."
          : "There are no new emails in that inbox scope since your last call.",
    };
  }

  return {
    emails: selected,
    stored,
    confirmation: selectionConfirmation({
      scope: input.selectionScope,
      selectedCount: selected.length,
      requestedCount,
      availableCount: candidates.length,
    }),
  };
}

export function selectionConfirmation(input: {
  scope: CallInReadSelectionScope;
  selectedCount: number;
  requestedCount: number | null;
  availableCount: number;
}): string {
  const { scope, selectedCount, requestedCount, availableCount } = input;
  const noun = `${selectedCount} email${selectedCount === 1 ? "" : "s"}`;
  const clamped =
    requestedCount !== null && requestedCount > availableCount
      ? `You asked for ${requestedCount}, but only ${availableCount} ${
          scope === "new" ? "new " : ""
        }email${availableCount === 1 ? " is" : "s are"} available. `
      : "";

  switch (scope) {
    case "new":
      return `${clamped}Reading the ${noun} received since your last call.`;
    case "oldest":
      return `${clamped}Reading the ${noun} oldest in the readable window, oldest first.`;
    case "newest":
      return `${clamped}Reading the ${noun} most recent.`;
    case "all":
      return `${clamped}Reading ${noun}.`;
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isInboxScope(value: unknown): value is CallInInboxScope {
  return value === "primary" || value === "promotions" || value === "everything";
}

function isStoredSelectionScope(
  value: unknown,
): value is StoredReadSelection["selectionScope"] {
  return (
    value === "new" ||
    value === "all" ||
    value === "oldest" ||
    value === "newest" ||
    value === "index"
  );
}
