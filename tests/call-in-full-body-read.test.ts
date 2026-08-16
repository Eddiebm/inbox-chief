import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  speakReadableEmailsDetailed,
  type CallInMailboxSnapshot,
  type CallInReadableEmail,
} from "@/lib/call-in/assistant";
import {
  chunkBodyForSpeech,
  prepareBodyForSpeech,
  QUOTED_THREAD_LEAD,
} from "@/lib/call-in/body-speech";
import {
  ensureFullBodyForSpeech,
  isBodyIncompleteForSpeech,
} from "@/lib/call-in/full-body";
import {
  attachmentCursorKey,
  resumeAttachmentCursor,
  resumeBodyOffset,
  type StoredReadCursor,
} from "@/lib/call-in/read-cursor";
import { speechBudgetsForTier } from "@/lib/call-in/voice-tiers";
import {
  handleCallInTool,
  isContinueReadingPhrase,
  isSkipCurrentEmailPhrase,
  readIntentFromQuestion,
} from "@/lib/call-in/vapi-tools";

/** In-memory stand-in for the CallInIdentity read cursor row. */
let cursor: StoredReadCursor | null = null;

vi.mock("@/lib/call-in/read-cursor", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/call-in/read-cursor")>();
  return {
    ...actual,
    loadReadCursor: async () => cursor,
    saveReadCursor: async (input: {
      index: number;
      callId?: string | null;
      scope?: string;
      bodyOffset?: number;
      bodyKey?: string | null;
      attachmentOffset?: number;
      attachmentKey?: string | null;
    }) => {
      cursor = {
        index: input.index,
        callId: input.callId ?? null,
        scope: input.scope ?? null,
        at: new Date(),
        bodyOffset: input.bodyOffset ?? 0,
        bodyKey: input.bodyKey ?? null,
        attachmentOffset: input.attachmentOffset ?? 0,
        attachmentKey: input.attachmentKey ?? null,
      };
    },
  };
});

const fetchGmailMessageBodyText = vi.fn(async () => "");
vi.mock("@/lib/gmail/client", () => ({
  fetchGmailMessageBodyText: (...args: unknown[]) =>
    fetchGmailMessageBodyText(...(args as [])),
}));

/** A body with unique sentence markers so nothing can be dropped unnoticed. */
function longBody(sentences: number): string {
  return Array.from(
    { length: sentences },
    (_, i) =>
      `MARK${i + 1}: the lease renewal for suite ${i + 1} needs a signature before Friday afternoon.`,
  ).join(" ");
}

function email(overrides: Partial<CallInReadableEmail> = {}): CallInReadableEmail {
  return {
    messageId: "m1",
    gmailMessageId: "g1",
    fromAddress: "Jordan Lee <jordan@example.com>",
    subject: "Lease renewals",
    readableText: "Short and complete message.",
    contentSource: "body",
    inboxTab: "primary",
    receivedAt: "2026-08-15T15:00:00-05:00",
    ...overrides,
  };
}

function snapshotWith(emails: CallInReadableEmail[]): CallInMailboxSnapshot {
  return {
    organizationId: "org_1",
    workspaceId: "ws_1",
    mailboxId: "mb_1",
    ownerFirstName: "Eddie",
    mailboxEmail: "eddie@bannermanmenson.com",
    connectionStatus: "connected",
    identityStatus: "matched",
    needingAttention: emails.length,
    draftsAwaitingReview: 0,
    approvalsPending: 0,
    followUpsDue: 0,
    upcomingDeadlines: [],
    briefing: "ready",
    recentSubjects: emails.map((e) => e.subject),
    readableEmails: emails,
    readableEmailsNonPrimary: [],
    skippedNonPrimaryCount: 0,
    securityNote: "linked",
    voiceTier: "standard",
  };
}

function read(args: Record<string, unknown>, snapshot: CallInMailboxSnapshot) {
  return handleCallInTool({
    name: "read_emails",
    args,
    snapshot,
    callInIdentityId: "cid_1",
    callId: "call_1",
  });
}

beforeEach(() => {
  cursor = null;
  fetchGmailMessageBodyText.mockReset();
});

describe("a long body is read in full across turns", () => {
  it("splits on sentence boundaries and never drops content", () => {
    const prepared = prepareBodyForSpeech(longBody(40));
    const seen: string[] = [];
    let offset = 0;
    for (let turn = 0; turn < 40; turn++) {
      const chunk = chunkBodyForSpeech(prepared, offset, 500);
      if (!chunk.spoken) break;
      seen.push(chunk.spoken);
      // Chunks end on a boundary, never mid-word.
      expect(chunk.spoken).not.toMatch(/\bMARK\d+$/);
      if (!chunk.hasMore) break;
      offset = chunk.nextOffset;
    }
    expect(seen.length).toBeGreaterThan(1);
    const rejoined = seen.join(" ").replace(/\s+/g, " ");
    for (let i = 1; i <= 40; i++) {
      expect(rejoined).toContain(`MARK${i}:`);
    }
  });

  it("reads the first part, then resumes at the exact offset", async () => {
    const snapshot = snapshotWith([
      email({ readableText: longBody(30) }),
      email({ messageId: "m2", gmailMessageId: "g2", subject: "Second" }),
    ]);

    const first = await read({ position: "first" }, snapshot);
    expect(first.spoken).toContain("Email 1 of 2");
    expect(first.spoken).toContain("MARK1:");
    expect(first.spoken).toMatch(/There is more of this message/i);
    expect(first.spoken).toMatch(/about \d+ words remain/i);
    expect(first.spoken).toMatch(/Say continue to hear the rest/i);
    expect(first.spoken).toMatch(/say next to skip/i);
    // A partial message must not claim the list moved on.
    expect(first.spoken).not.toMatch(/Say next for email 2/i);
    expect(cursor?.bodyOffset).toBeGreaterThan(0);
    expect(cursor?.bodyKey).toBe("m1");

    const heard = [first.spoken];
    for (let turn = 0; turn < 20; turn++) {
      if (!cursor?.bodyOffset) break;
      const more = await read({ position: "continue" }, snapshot);
      expect(more.spoken).toContain("Continuing email 1 of 2");
      heard.push(more.spoken);
    }

    const all = heard.join(" ");
    for (let i = 1; i <= 30; i++) {
      expect(all).toContain(`MARK${i}:`);
    }
    // Nothing was repeated across turns.
    expect(all.match(/MARK7:/g)).toHaveLength(1);
    // The final turn hands the caller back to the list.
    expect(heard.at(-1)).toMatch(/Say next for email 2/i);
    expect(cursor?.bodyOffset).toBe(0);
    expect(cursor?.bodyKey).toBeNull();
  });

  it("a short body reads in one turn and reports no remainder", async () => {
    const snapshot = snapshotWith([email(), email({ messageId: "m2" })]);
    const only = await read({ position: "first" }, snapshot);
    expect(only.spoken).toContain("Short and complete message.");
    expect(only.spoken).not.toMatch(/words remain/i);
    expect(only.spoken).not.toMatch(/say continue/i);
    expect(only.spoken).toMatch(/Say next for email 2/i);
    expect(cursor?.bodyOffset).toBe(0);
  });

  it("names the quoted thread instead of dropping it", () => {
    const prepared = prepareBodyForSpeech(
      `${"Please confirm the renewal terms today. ".repeat(20)}On Tuesday Jordan Lee wrote: ${"the original terms were attached. ".repeat(20)}`,
    );
    expect(prepared.hasQuotedThread).toBe(true);

    let offset = 0;
    let boundary: ReturnType<typeof chunkBodyForSpeech> | null = null;
    const heard: string[] = [];
    for (let turn = 0; turn < 20; turn++) {
      const chunk = chunkBodyForSpeech(prepared, offset, 400);
      if (!chunk.spoken) break;
      heard.push(chunk.spoken);
      if (chunk.endsAtQuotedBoundary) {
        boundary = chunk;
        break;
      }
      if (!chunk.hasMore) break;
      offset = chunk.nextOffset;
    }

    // The new content ends on its own turn, announced as the earlier thread.
    expect(boundary).not.toBeNull();
    expect(heard.at(-1)).toContain(QUOTED_THREAD_LEAD);
    const rest = chunkBodyForSpeech(prepared, boundary!.nextOffset, 400);
    expect(rest.spoken).toContain("the original terms were attached");
  });

  it("standard voice no longer truncates a normal email", () => {
    const std = speechBudgetsForTier("standard");
    expect(std.maxEmailTextChars).toBeGreaterThanOrEqual(1500);
    expect(std.maxSpokenChars).toBeGreaterThan(std.maxEmailTextChars);
    const spoken = speakReadableEmailsDetailed([email()], {
      voiceTier: "standard",
    });
    expect(spoken.nextBodyOffset).toBe(0);
    expect(spoken.spoken).toContain("Short and complete message.");
  });
});

describe("the caller can always interrupt a long read", () => {
  it("recognizes natural skip and continue phrases", () => {
    for (const phrase of [
      "next",
      "next email",
      "move on to the next mail",
      "skip this",
      "skip this one",
      "i do not want to hear the full mail",
      "stop reading this one",
    ]) {
      expect(readIntentFromQuestion(phrase)?.position).toMatch(/^(next|skip)$/);
    }
    for (const phrase of [
      "continue",
      "more",
      "keep reading",
      "rest of it",
      "read the rest",
    ]) {
      expect(readIntentFromQuestion(phrase)?.position).toBe("continue");
    }
    expect(isSkipCurrentEmailPhrase("move on")).toBe(true);
    expect(isContinueReadingPhrase("next email")).toBe(false);
  });

  it("skip abandons the remainder and never resumes it later", async () => {
    const snapshot = snapshotWith([
      email({ readableText: longBody(30) }),
      email({
        messageId: "m2",
        gmailMessageId: "g2",
        subject: "Second message",
        readableText: "SECOND BODY is short.",
      }),
      email({
        messageId: "m3",
        gmailMessageId: "g3",
        subject: "Third message",
        readableText: "THIRD BODY is short.",
      }),
    ]);

    const first = await read({ position: "first" }, snapshot);
    expect(first.spoken).toMatch(/There is more of this message/i);
    expect(cursor?.bodyOffset).toBeGreaterThan(0);

    const skipped = await read({ position: "skip" }, snapshot);
    expect(skipped.spoken).toContain("Email 2 of 3");
    expect(skipped.spoken).toContain("SECOND BODY is short.");
    expect(skipped.spoken).not.toContain("MARK");
    // The abandoned remainder is gone from server state.
    expect(cursor?.bodyOffset).toBe(0);
    expect(cursor?.bodyKey).toBeNull();

    // "Continue" after a skip must move forward, not reopen the skipped email.
    const afterSkip = await read({ position: "continue" }, snapshot);
    expect(afterSkip.spoken).not.toContain("MARK");
    expect(afterSkip.spoken).toContain("Email 3 of 3");
  });

  it("spoken guidance mentions skipping at any time", async () => {
    const snapshot = snapshotWith([email({ readableText: longBody(30) })]);
    const first = await read({ position: "first" }, snapshot);
    expect(first.spoken).toMatch(/say next to skip to the next email/i);
  });
});

describe("attachment text also continues", () => {
  const attachmentText = Array.from(
    { length: 40 },
    (_, i) => `FILE${i + 1}: line ${i + 1} of the signed lease addendum.`,
  ).join(" ");

  it("offers the rest of a long file and resumes it", async () => {
    const snapshot = snapshotWith([
      email({
        readableText: "See the attached addendum.",
        attachments: [
          {
            filename: "addendum.txt",
            mimeType: "text/plain",
            size: attachmentText.length,
            speakableType: "text file",
            status: "ok",
            readableText: attachmentText.slice(0, 400),
            remainingText: attachmentText.slice(400),
            fullText: attachmentText,
          },
        ],
      }),
      email({ messageId: "m2", gmailMessageId: "g2" }),
    ]);

    const first = await read({ position: "first" }, snapshot);
    expect(first.spoken).toContain("This email has 1 attachment:");
    expect(first.spoken).not.toContain("FILE1:");
    expect(cursor?.attachmentKey).toBeNull();

    const requested = await read(
      { attachmentAction: "read", attachmentIndex: 1 },
      snapshot,
    );
    expect(requested.spoken).toContain("FILE1:");
    expect(requested.spoken).toMatch(/There is more of addendum\.txt/i);
    expect(cursor?.attachmentKey).toBe(attachmentCursorKey("m1", 0));
    expect(cursor?.attachmentOffset).toBeGreaterThan(0);

    const heard = [requested.spoken];
    for (let turn = 0; turn < 20; turn++) {
      if (!cursor?.attachmentKey) break;
      const more = await read({ position: "continue" }, snapshot);
      expect(more.spoken).toMatch(/addendum\.txt/);
      heard.push(more.spoken);
    }
    const all = heard.join(" ");
    for (let i = 1; i <= 40; i++) {
      expect(all).toContain(`FILE${i}:`);
    }
  });

  it("attachment offsets only apply to the message they belong to", () => {
    const stored: StoredReadCursor = {
      index: 1,
      callId: "call_1",
      scope: null,
      at: new Date(),
      bodyOffset: 900,
      bodyKey: "m1",
      attachmentOffset: 500,
      attachmentKey: attachmentCursorKey("m1", 1),
    };
    expect(resumeBodyOffset(stored, "m1")).toBe(900);
    expect(resumeBodyOffset(stored, "m2")).toBe(0);
    expect(resumeAttachmentCursor(stored, "m1")).toEqual({
      index: 1,
      offset: 500,
      all: false,
    });
    expect(resumeAttachmentCursor(stored, "m2")).toBeNull();
  });
});

describe("a missing or clipped body is fetched on demand", () => {
  it("detects bodies that cannot be the whole message", () => {
    expect(isBodyIncompleteForSpeech(email())).toBe(false);
    expect(
      isBodyIncompleteForSpeech(
        email({ readableText: "Long start of the message…" }),
      ),
    ).toBe(true);
    expect(
      isBodyIncompleteForSpeech(
        email({ readableText: "Just a preview", contentSource: "snippet" }),
      ),
    ).toBe(true);
  });

  it("replaces a snippet with the full Gmail body before speaking", async () => {
    fetchGmailMessageBodyText.mockResolvedValue(longBody(10));
    const target = email({
      readableText: "Preview only",
      contentSource: "snippet",
    });
    await ensureFullBodyForSpeech({
      email: target,
      organizationId: "org_1",
      workspaceId: "ws_1",
      mailboxId: "mb_1",
      userId: "user_1",
    });
    expect(fetchGmailMessageBodyText).toHaveBeenCalledTimes(1);
    expect(target.contentSource).toBe("body");
    expect(target.readableText).toContain("MARK10:");
  });

  it("keeps the stored text when Gmail cannot help", async () => {
    fetchGmailMessageBodyText.mockRejectedValue(new Error("network"));
    const target = email({
      readableText: "Preview only",
      contentSource: "snippet",
    });
    await ensureFullBodyForSpeech({
      email: target,
      organizationId: "org_1",
      workspaceId: "ws_1",
      mailboxId: "mb_1",
      userId: "user_1",
    });
    expect(target.readableText).toBe("Preview only");
  });
});
