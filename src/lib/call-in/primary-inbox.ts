/**
 * Call-in Primary-inbox filter for blind patrons.
 *
 * Default: only Gmail Primary (CATEGORY_PRIMARY / CATEGORY_PERSONAL, or INBOX
 * without promotions/social/updates/forums/spam). Opt-in phrases unlock other tabs.
 * Never auto-sends. Conservative heuristics when labels are missing.
 */

export type GmailInboxTab =
  | "primary"
  | "promotions"
  | "social"
  | "updates"
  | "forums"
  | "spam"
  /** Sent, drafts, chats, or archived mail — never read on a call-in. */
  | "not_inbox"
  | "unknown";

export type CallInInboxScope = "primary" | "promotions" | "everything";

export type MessageLikeForPrimaryFilter = {
  fromAddress: string;
  subject?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
  categoryName?: string | null;
  metadata?: unknown;
};

/** Gmail system labels for tabs. Primary tab is CATEGORY_PERSONAL; some clients also emit CATEGORY_PRIMARY. */
export const GMAIL_PRIMARY_LABELS = [
  "CATEGORY_PRIMARY",
  "CATEGORY_PERSONAL",
] as const;

export const GMAIL_NON_PRIMARY_CATEGORY_LABELS = [
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
] as const;

const NON_PRIMARY_CATEGORY_SET = new Set<string>(GMAIL_NON_PRIMARY_CATEGORY_LABELS);
const PRIMARY_LABEL_SET = new Set<string>(GMAIL_PRIMARY_LABELS);

/** Map Gmail labelIds → categoryName stored on Message */
export function categoryNameFromGmailLabels(
  labelIds: string[] | null | undefined,
): string | null {
  const ids = labelIds ?? [];
  if (ids.includes("SPAM")) return "SPAM";
  // Sent / draft / chat / archived: keep it out of the readable inbox scopes.
  if (ids.length > 0 && !ids.includes("INBOX")) return "NOT_INBOX";
  if (ids.includes("CATEGORY_PROMOTIONS")) return "PROMOTIONS";
  if (ids.includes("CATEGORY_SOCIAL")) return "SOCIAL";
  if (ids.includes("CATEGORY_UPDATES")) return "UPDATES";
  if (ids.includes("CATEGORY_FORUMS")) return "FORUMS";
  if (ids.some((id) => PRIMARY_LABEL_SET.has(id))) return "PRIMARY";
  // INBOX without another category tab → treat as Primary for older/simple mailboxes
  if (ids.includes("INBOX") && !ids.some((id) => NON_PRIMARY_CATEGORY_SET.has(id))) {
    return "PRIMARY";
  }
  return null;
}

export function labelIdsFromMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as { labelIds?: unknown }).labelIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

export function inboxTabFromCategoryName(
  categoryName: string | null | undefined,
): GmailInboxTab | null {
  const c = (categoryName ?? "").trim().toUpperCase();
  if (!c) return null;
  if (c === "PRIMARY" || c === "PERSONAL") return "primary";
  if (c === "PROMOTIONS" || c === "PROMO") return "promotions";
  if (c === "SOCIAL") return "social";
  if (c === "UPDATES") return "updates";
  if (c === "FORUMS") return "forums";
  if (c === "SPAM" || c === "JUNK") return "spam";
  if (c === "NOT_INBOX" || c === "SENT" || c === "DRAFT") return "not_inbox";
  return null;
}

export function inboxTabFromLabelIds(labelIds: string[]): GmailInboxTab {
  if (labelIds.includes("SPAM") || labelIds.includes("TRASH")) return "spam";
  // Sent / drafts / chats and archived mail are not inbox reading material.
  if (!labelIds.includes("INBOX")) return "not_inbox";
  if (labelIds.includes("CATEGORY_PROMOTIONS")) return "promotions";
  if (labelIds.includes("CATEGORY_SOCIAL")) return "social";
  if (labelIds.includes("CATEGORY_UPDATES")) return "updates";
  if (labelIds.includes("CATEGORY_FORUMS")) return "forums";
  if (labelIds.some((id) => PRIMARY_LABEL_SET.has(id))) return "primary";
  if (
    labelIds.includes("INBOX") &&
    !labelIds.some((id) => NON_PRIMARY_CATEGORY_SET.has(id))
  ) {
    return "primary";
  }
  return "unknown";
}

/**
 * Conservative junk heuristics when Gmail category labels are missing.
 * Prefer keeping real mail — only skip clear marketing/noreply bulk.
 */
export function looksLikeMarketingJunk(input: {
  fromAddress: string;
  subject?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
}): boolean {
  const from = input.fromAddress.toLowerCase();
  const emailMatch = from.match(/<([^>]+)>/);
  const addr = (emailMatch?.[1] ?? from).trim();
  const local = addr.split("@")[0] ?? "";
  const hay = [
    input.subject ?? "",
    input.snippet ?? "",
    (input.bodyText ?? "").slice(0, 800),
  ]
    .join("\n")
    .toLowerCase();

  const noreplyLocal =
    /^(no[-_]?reply|do[-_]?not[-_]?reply|noreply|donotreply|mailer[-_]?daemon|notifications?|newsletter|marketing|promo|offers?)$/i.test(
      local,
    ) ||
    local.includes("noreply") ||
    local.includes("no-reply") ||
    local.includes("donotreply");

  const hasListUnsub =
    /\blist-unsubscribe\b/.test(hay) ||
    (/\bunsubscribe\b/.test(hay) &&
      /\b(view in browser|email preferences|manage preferences|one-click)\b/.test(
        hay,
      ));

  const promoSubject =
    /\b(limited time|% off|flash sale|unsubscribe|weekly deal|your exclusive)\b/i.test(
      input.subject ?? "",
    );

  // Require two strong signals so personal noreply (e.g. calendar) is kept
  let signals = 0;
  if (noreplyLocal) signals += 1;
  if (hasListUnsub) signals += 1;
  if (promoSubject && noreplyLocal) signals += 1;
  return signals >= 2;
}

export function resolveInboxTab(
  message: MessageLikeForPrimaryFilter,
): GmailInboxTab {
  const fromCategory = inboxTabFromCategoryName(message.categoryName);
  if (fromCategory) return fromCategory;

  const labels = labelIdsFromMetadata(message.metadata);
  if (labels.length > 0) {
    const fromLabels = inboxTabFromLabelIds(labels);
    if (fromLabels !== "unknown") return fromLabels;
  }

  if (looksLikeMarketingJunk(message)) return "promotions";
  // Missing labels + not clear junk → keep (Primary assumption for call-in)
  return "primary";
}

export function isPrimaryInboxMessage(
  message: MessageLikeForPrimaryFilter,
): boolean {
  return resolveInboxTab(message) === "primary";
}

export function parseCallInInboxScope(rawQuestion: string): CallInInboxScope {
  const q = rawQuestion.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();
  if (
    /\b(read |include )?(everything|all (emails?|messages?|mail|tabs?)|every tab|whole inbox)\b/.test(
      q,
    ) ||
    /\b(all tabs|every folder)\b/.test(q)
  ) {
    return "everything";
  }
  if (
    /\b(read |include )?(junk|spam|promotions?|promo|social|updates?|forums?|other tabs?|non[- ]?primary)\b/.test(
      q,
    )
  ) {
    return "promotions";
  }
  return "primary";
}

export function filterMessagesByInboxScope<T extends MessageLikeForPrimaryFilter>(
  messages: T[],
  scope: CallInInboxScope,
): { kept: T[]; skipped: T[]; skippedNonPrimaryCount: number } {
  const kept: T[] = [];
  const skipped: T[] = [];
  /** Sent/draft/archived rows are not inbox mail, so they are never announced. */
  let skippedInboxCount = 0;

  for (const m of messages) {
    const tab = resolveInboxTab(m);
    const isInboxMail = tab !== "not_inbox";

    if (scope === "primary") {
      if (tab === "primary") {
        kept.push(m);
      } else {
        skipped.push(m);
        if (isInboxMail) skippedInboxCount += 1;
      }
      continue;
    }
    if (scope === "promotions") {
      // Other Gmail tabs only — never spam, primary, or non-inbox mail.
      if (tab === "spam" || tab === "primary" || tab === "not_inbox") {
        skipped.push(m);
        if (isInboxMail) skippedInboxCount += 1;
      } else {
        kept.push(m);
      }
      continue;
    }
    // everything: all tabs except hard spam/trash and non-inbox mail
    if (tab === "spam" || tab === "not_inbox") {
      skipped.push(m);
      if (isInboxMail) skippedInboxCount += 1;
    } else {
      kept.push(m);
    }
  }

  return { kept, skipped, skippedNonPrimaryCount: skippedInboxCount };
}

/** Plain-language intro for TTS when reading Primary by default. */
export function speakPrimaryInboxIntro(input: {
  keptCount: number;
  skippedCount: number;
  scope: CallInInboxScope;
}): string {
  if (input.scope === "everything") {
    return `Reading everything except spam. ${input.keptCount} message${input.keptCount === 1 ? "" : "s"}.`;
  }
  if (input.scope === "promotions") {
    return `Reading promotions and other non-primary tabs. ${input.keptCount} message${input.keptCount === 1 ? "" : "s"}.`;
  }
  const kept = `${input.keptCount} message${input.keptCount === 1 ? "" : "s"} to read, one at a time`;
  if (input.skippedCount > 0) {
    return `Reading your primary inbox. Skipping ${input.skippedCount} promotional and other-tab message${input.skippedCount === 1 ? "" : "s"}. ${kept}.`;
  }
  return `Reading your primary inbox. ${kept}.`;
}
