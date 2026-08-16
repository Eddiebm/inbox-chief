import { describe, expect, it } from "vitest";
import {
  mailboxNeedsReconnectSnapshot,
  speakReadableEmails,
  type CallInMailboxSnapshot,
  type CallInReadableEmail,
} from "@/lib/call-in/assistant";
import {
  loadCallInReadableWindow,
  speakReadableInboxDepth,
  needsReconnectReason,
} from "@/lib/call-in/identity";
import {
  filterMessagesByInboxScope,
  isPrimaryInboxMessage,
  resolveInboxTab,
} from "@/lib/call-in/primary-inbox";
import {
  computeReadStartIndex,
  isCursorUsable,
  parseReadPosition,
} from "@/lib/call-in/read-cursor";
import {
  createReadSelection,
  decodeStoredReadSelection,
  emailsFromStoredSelection,
  encodeStoredReadSelection,
} from "@/lib/call-in/read-selection";
import {
  buildCallInSystemPrompt,
  buildCallInVapiTools,
  handleCallInTool,
  parseStartIndexArg,
  readIntentFromQuestion,
} from "@/lib/call-in/vapi-tools";
import {
  buildGmailSyncPasses,
  GMAIL_SYNC_DEFAULT_DEPTH,
  GMAIL_SYNC_MAX_DEPTH,
} from "@/lib/gmail/client";

function primaryEmail(n: number): CallInReadableEmail {
  return {
    messageId: `m${n}`,
    gmailMessageId: `g${n}`,
    fromAddress: `Sender ${n} <sender${n}@example.com>`,
    subject: `Subject number ${n}`,
    readableText: `Body of message ${n}.`,
    contentSource: "body",
    inboxTab: "primary",
    receivedAt: `2026-08-1${n % 10}T15:00:00-05:00`,
  };
}

function snapshotWithEmails(count: number): CallInMailboxSnapshot {
  const readableEmails = Array.from({ length: count }, (_, i) =>
    primaryEmail(i + 1),
  );
  return {
    organizationId: "org_1",
    workspaceId: "ws_1",
    mailboxId: "mb_1",
    ownerFirstName: "Eddie",
    mailboxEmail: "eddie@bannermanmenson.com",
    connectionStatus: "connected",
    identityStatus: "matched",
    needingAttention: count,
    draftsAwaitingReview: 0,
    approvalsPending: 0,
    followUpsDue: 0,
    upcomingDeadlines: [],
    briefing: speakReadableInboxDepth(count, count),
    recentSubjects: readableEmails.map((e) => e.subject),
    readableEmails,
    readableEmailsNonPrimary: [],
    skippedNonPrimaryCount: 24,
    securityNote: "linked",
  };
}

describe("call-in reads walk the whole Primary inbox", () => {
  it("reads one message at a time and reports the real total", async () => {
    const snapshot = snapshotWithEmails(12);

    const first = await handleCallInTool({
      name: "read_emails",
      args: { position: "first" },
      snapshot,
    });
    expect(first.spoken).toMatch(/Email 1 of 12/);
    expect(first.spoken).toMatch(/Subject number 1/);
    expect(first.spoken).toMatch(/Say next for email 2/);
    expect(first.spoken).not.toMatch(/last message/i);

    const fourth = await handleCallInTool({
      name: "read_emails",
      args: { startIndex: 3 },
      snapshot,
    });
    expect(fourth.spoken).toMatch(/Email 4 of 12/);
    expect(fourth.spoken).toMatch(/Say next for email 5/);

    const last = await handleCallInTool({
      name: "read_emails",
      args: { startIndex: 11 },
      snapshot,
    });
    expect(last.spoken).toMatch(/Email 12 of 12/);
    expect(last.spoken).toMatch(/last message/i);
  });

  it("next advances even when the model sends no index", async () => {
    const snapshot = snapshotWithEmails(12);
    const handled = await handleCallInTool({
      name: "read_emails",
      args: { position: "next" },
      snapshot,
    });
    expect(handled.spoken).toMatch(/Email 2 of 12/);
    expect(handled.spoken).not.toMatch(/Email 1 of 12/);
  });

  it("every index in the window is reachable", async () => {
    const snapshot = snapshotWithEmails(20);
    for (let i = 0; i < 20; i++) {
      const handled = await handleCallInTool({
        name: "read_emails",
        args: { startIndex: i },
        snapshot,
      });
      expect(handled.spoken).toContain(`Email ${i + 1} of 20`);
      expect(handled.spoken).toContain(`Subject number ${i + 1}`);
    }
  });

  it("speaks empty-primary copy instead of inventing mail", () => {
    const spoken = speakReadableEmails([], {
      scope: "primary",
      skippedNonPrimaryCount: 18,
    });
    expect(spoken).toMatch(/primary inbox is empty/i);
    expect(spoken).toMatch(/Skipping 18 promotional/i);
    expect(spoken).not.toMatch(/Jordan Lee|example\.com/i);
  });

  it("an invalid mailbox token asks for a reconnect and reads nothing", async () => {
    const snapshot = mailboxNeedsReconnectSnapshot(
      "Eddie",
      "eddie@bannermanmenson.com",
    );
    for (const name of ["read_emails", "get_briefing", "get_needs_attention"]) {
      const handled = await handleCallInTool({ name, snapshot });
      expect(handled.spoken).toMatch(/needs reconnecting/i);
      expect(handled.spoken).toMatch(/Connect Gmail/i);
      expect(handled.spoken).not.toMatch(/Email 1 of|Subject:/i);
      expect(handled.emailSent).toBe(false);
    }
    expect(needsReconnectReason("needs_reconnect")).toBe(true);
    expect(needsReconnectReason("mailbox_token_missing")).toBe(true);
    expect(needsReconnectReason("tenant_scope_required")).toBe(false);
  });
});

describe("reading requests phrased as questions", () => {
  it("routes next / read my mail through the paginated reader", async () => {
    const snapshot = snapshotWithEmails(12);

    expect(readIntentFromQuestion("next one please")).toMatchObject({
      position: "next",
    });
    expect(readIntentFromQuestion("read email 5")).toMatchObject({
      index: 5,
    });
    expect(readIntentFromQuestion("read the first 10")).toMatchObject({
      position: "first",
      selection: "newest",
      count: 10,
    });
    expect(readIntentFromQuestion("read the last 4")).toMatchObject({
      selection: "oldest",
      count: 4,
    });
    expect(readIntentFromQuestion("just the new ones")).toMatchObject({
      selection: "new",
    });
    expect(readIntentFromQuestion("read the next 3")).toMatchObject({
      position: "next",
      selection: "newest",
      count: 3,
    });
    expect(readIntentFromQuestion("any drafts waiting?")).toBeNull();

    const next = await handleCallInTool({
      name: "ask_inbox",
      args: { question: "next email" },
      snapshot,
    });
    expect(next.intent).toBe("read_emails");
    expect(next.spoken).toMatch(/Email 2 of 12/);

    const numbered = await handleCallInTool({
      name: "ask_inbox",
      args: { question: "read email 5" },
      snapshot,
    });
    expect(numbered.spoken).toMatch(/Reading just number 5/);
    expect(numbered.spoken).toMatch(/Email 1 of 1/);
  });
});

describe("caller-selected email subsets", () => {
  const snapshot = {
    ...snapshotWithEmails(8),
    lastSuccessfulCallAt: "2026-08-15T16:30:00.000Z",
    readableEmails: Array.from({ length: 8 }, (_, i) => ({
      ...primaryEmail(i + 1),
      receivedAt: new Date(
        Date.parse("2026-08-15T20:00:00.000Z") - i * 60 * 60 * 1000,
      ).toISOString(),
    })),
  };

  it("selects new N and clamps an over-request to the real count", () => {
    const selected = createReadSelection({
      emails: snapshot.readableEmails,
      snapshot,
      inboxScope: "primary",
      selectionScope: "new",
      count: 5,
      index: null,
    });
    expect(selected.emails).toHaveLength(4);
    expect(selected.confirmation).toMatch(/asked for 5, but only 4 new emails/i);
    expect(selected.confirmation).toMatch(/Reading the 4 emails/i);
  });

  it("maps first N to newest N", () => {
    const selected = createReadSelection({
      emails: snapshot.readableEmails,
      snapshot,
      inboxScope: "primary",
      selectionScope: "newest",
      count: 3,
      index: null,
    });
    expect(selected.emails.map((email) => email.subject)).toEqual([
      "Subject number 1",
      "Subject number 2",
      "Subject number 3",
    ]);
    expect(selected.confirmation).toMatch(/3 emails most recent/i);
  });

  it("maps last N and oldest N to the oldest messages, oldest first", () => {
    const selected = createReadSelection({
      emails: snapshot.readableEmails,
      snapshot,
      inboxScope: "primary",
      selectionScope: "oldest",
      count: 2,
      index: null,
    });
    expect(selected.emails.map((email) => email.subject)).toEqual([
      "Subject number 8",
      "Subject number 7",
    ]);
    expect(selected.confirmation).toMatch(/oldest in the readable window/i);
  });

  it("reads a specific one-based index and preserves continuation keys", () => {
    const selected = createReadSelection({
      emails: snapshot.readableEmails,
      snapshot,
      inboxScope: "primary",
      selectionScope: "all",
      count: null,
      index: 4,
    });
    expect(selected.emails).toHaveLength(1);
    expect(selected.emails[0]?.subject).toBe("Subject number 4");
    expect(selected.confirmation).toBe("Reading just number 4.");
    expect(selected.stored.continuationKeys).toHaveLength(4);
  });

  it("keeps next inside a serialized selection", () => {
    const selected = createReadSelection({
      emails: snapshot.readableEmails,
      snapshot,
      inboxScope: "primary",
      selectionScope: "newest",
      count: 3,
      index: null,
    });
    const restored = decodeStoredReadSelection(
      encodeStoredReadSelection(selected.stored),
    );
    expect(restored).not.toBeNull();
    const restoredEmails = emailsFromStoredSelection(
      snapshot.readableEmails,
      restored?.messageKeys ?? [],
    );
    expect(restoredEmails).toHaveLength(3);
    expect(
      computeReadStartIndex({
        position: "next",
        explicitStartIndex: null,
        stored: {
          index: 1,
          callId: "call_subset",
          scope: encodeStoredReadSelection(selected.stored),
          at: new Date(),
        },
        callId: "call_subset",
      }),
    ).toBe(1);
    expect(restoredEmails[1]?.subject).toBe("Subject number 2");
  });

  it("speaks an empty-new result without substituting old mail", () => {
    const selected = createReadSelection({
      emails: snapshot.readableEmails,
      snapshot: {
        lastSuccessfulCallAt: "2026-08-16T00:00:00.000Z",
      },
      inboxScope: "primary",
      selectionScope: "new",
      count: null,
      index: null,
    });
    expect(selected.emails).toHaveLength(0);
    expect(selected.emptySpoken).toMatch(/no new emails in Primary/i);
  });
});

describe("VAPI assistant instructions", () => {
  it("forbids stopping after the newest message", () => {
    const prompt = buildCallInSystemPrompt();
    expect(prompt).toMatch(/Never end the reading after one email/i);
    expect(prompt).toMatch(/position=next/i);
    expect(prompt).toMatch(/Email N of M/);
    expect(prompt).toMatch(/never summarize the inbox instead of reading/i);
  });

  it("requires the whole body verbatim, with continue and skip", () => {
    const prompt = buildCallInSystemPrompt();
    expect(prompt).toMatch(/READ THE WHOLE EMAIL/);
    expect(prompt).toMatch(/NEVER summarize, shorten, paraphrase/i);
    expect(prompt).toMatch(/position=continue/);
    expect(prompt).toMatch(/position=skip/);
    expect(prompt).toMatch(/interrupt at ANY time/i);
    expect(prompt).toMatch(/speak that offer word for word/i);
  });

  it("exposes position and subset parameters on read_emails", () => {
    const tools = buildCallInVapiTools("https://example.com");
    const read = tools.find((t) => t.function.name === "read_emails");
    const params = read?.function.parameters as {
      properties?: {
        position?: { enum?: string[] };
        selection?: { enum?: string[] };
        count?: { maximum?: number };
        index?: { minimum?: number };
      };
    };
    expect(params?.properties?.position?.enum).toContain("next");
    expect(params?.properties?.position?.enum).toContain("continue");
    expect(params?.properties?.position?.enum).toContain("skip");
    expect(params?.properties?.selection?.enum).toEqual([
      "new",
      "all",
      "oldest",
      "newest",
    ]);
    expect(params?.properties?.count?.maximum).toBe(20);
    expect(params?.properties?.index?.minimum).toBe(1);
    expect(read?.function.description).toMatch(/never stop after one email/i);
  });
});

describe("call-in read cursor", () => {
  it("maps spoken positions to cursor moves", () => {
    expect(parseReadPosition({ position: "next" })).toBe("next");
    // Continue resumes the current body; next/skip move to the following email.
    expect(parseReadPosition({ position: "Continue" })).toBe("continue");
    expect(parseReadPosition({ position: "skip" })).toBe("skip");
    expect(parseReadPosition({ position: "first" })).toBe("first");
    expect(parseReadPosition({ position: "again" })).toBe("repeat");
    expect(parseReadPosition({ position: "back" })).toBe("previous");
    expect(parseReadPosition({})).toBeNull();
  });

  it("advances through the inbox across successive next calls", () => {
    const callId = "call_1";
    let index = computeReadStartIndex({
      position: "first",
      explicitStartIndex: null,
      stored: null,
      callId,
    });
    expect(index).toBe(0);

    const heard: number[] = [];
    for (let turn = 0; turn < 6; turn++) {
      heard.push(index);
      const stored = {
        index: index + 1,
        callId,
        scope: "primary",
        at: new Date(),
      };
      index = computeReadStartIndex({
        position: "next",
        explicitStartIndex: null,
        stored,
        callId,
      });
    }
    expect(heard).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("repeat and previous do not run past the beginning", () => {
    const stored = { index: 1, callId: "c", scope: null, at: new Date() };
    expect(
      computeReadStartIndex({
        position: "repeat",
        explicitStartIndex: null,
        stored,
        callId: "c",
      }),
    ).toBe(0);
    expect(
      computeReadStartIndex({
        position: "previous",
        explicitStartIndex: null,
        stored,
        callId: "c",
      }),
    ).toBe(0);
  });

  it("a new call starts at the newest message", () => {
    const stored = { index: 7, callId: "old_call", scope: null, at: new Date() };
    expect(isCursorUsable(stored, "new_call")).toBe(false);
    expect(
      computeReadStartIndex({
        position: null,
        explicitStartIndex: null,
        stored,
        callId: "new_call",
      }),
    ).toBe(0);
  });

  it("an explicit index always wins", () => {
    const stored = { index: 9, callId: "c", scope: null, at: new Date() };
    expect(
      computeReadStartIndex({
        position: "next",
        explicitStartIndex: 2,
        stored,
        callId: "c",
      }),
    ).toBe(2);
    expect(parseStartIndexArg({ emailNumber: 4 })).toBe(3);
    expect(parseStartIndexArg({ position: "next" })).toBeNull();
  });
});

describe("readable window is not gated on unread", () => {
  const scanRows = [
    // Newest mail is all promotional / other-tab noise, and unread.
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `promo${i}`,
      gmailId: `gpromo${i}`,
      subject: `Sale ${i}`,
      fromAddress: "Deals <noreply@shop.example>",
      snippet: "List-Unsubscribe. Manage preferences.",
      metadata: { labelIds: ["INBOX", "CATEGORY_PROMOTIONS", "UNREAD"] },
      categoryName: "PROMOTIONS",
      receivedAt: new Date(`2026-08-15T1${i}:00:00Z`),
      isRead: false,
    })),
    // Real Primary mail, already read, so needsAttention would have hidden it.
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `real${i}`,
      gmailId: `greal${i}`,
      subject: `Real message ${i}`,
      fromAddress: `Person ${i} <p${i}@client.example>`,
      snippet: "Can we talk about the lease?",
      metadata: { labelIds: ["INBOX", "CATEGORY_PERSONAL"] },
      categoryName: "PRIMARY",
      receivedAt: new Date(`2026-08-14T0${i % 10}:00:00Z`),
      isRead: true,
    })),
    // Sent mail must never be read back to the caller.
    {
      id: "sent1",
      gmailId: "gsent1",
      subject: "Re: lease",
      fromAddress: "Eddie <eddie@bannermanmenson.com>",
      snippet: "Sending the signed copy",
      metadata: { labelIds: ["SENT"] },
      categoryName: "NOT_INBOX",
      receivedAt: new Date("2026-08-14T12:00:00Z"),
      isRead: true,
    },
  ];

  const prismaStub = {
    message: {
      findMany: (async (args: {
        select?: Record<string, unknown>;
        where?: { id?: { in?: string[] } };
      }) => {
        if (args.select && "bodyText" in args.select) {
          const ids = args.where?.id?.in ?? [];
          return ids.map((id) => ({ id, bodyText: `Full body for ${id}.` }));
        }
        return scanRows;
      }) as never,
    },
  };

  it("returns the whole Primary window even when nothing is unread", async () => {
    const result = await loadCallInReadableWindow({
      prisma: prismaStub,
      tenantFilter: { organizationId: "o", workspaceId: "w", mailboxId: "m" },
      organizationId: "o",
      workspaceId: "w",
      mailboxId: "m",
      userId: "u",
    });

    expect(result.readableEmails).toHaveLength(12);
    expect(result.primaryMessageCount).toBe(12);
    expect(result.unreadPrimaryCount).toBe(0);
    expect(result.readableEmailsNonPrimary).toHaveLength(8);
    // Sent mail is not counted as a skipped promotional message either.
    expect(result.skippedNonPrimaryCount).toBe(8);
    expect(
      result.readableEmails.every((e) => e.readableText.startsWith("Full body")),
    ).toBe(true);
    expect(result.readableEmails.some((e) => e.subject === "Re: lease")).toBe(
      false,
    );
  });

  it("says how many messages are ready to walk through", () => {
    expect(speakReadableInboxDepth(12, 3)).toMatch(/12 Primary messages ready/i);
    expect(speakReadableInboxDepth(12, 3)).toMatch(/3 of them are unread/i);
    expect(speakReadableInboxDepth(12, 3)).toMatch(/Say continue for the rest/i);
    expect(speakReadableInboxDepth(12, 3)).toMatch(/next at any time/i);
  });
});

describe("sent, drafts and archived mail are not inbox mail", () => {
  it("classifies non-inbox label sets", () => {
    expect(resolveInboxTab({ fromAddress: "a@b.com", metadata: { labelIds: ["SENT"] } })).toBe(
      "not_inbox",
    );
    expect(
      resolveInboxTab({ fromAddress: "a@b.com", metadata: { labelIds: ["DRAFT"] } }),
    ).toBe("not_inbox");
    // Archived: read, no INBOX label
    expect(
      resolveInboxTab({ fromAddress: "a@b.com", metadata: { labelIds: ["IMPORTANT"] } }),
    ).toBe("not_inbox");
    expect(isPrimaryInboxMessage({ fromAddress: "a@b.com", metadata: { labelIds: ["SENT"] } })).toBe(
      false,
    );
    // No labels at all → still readable (older rows, IMAP/Outlook)
    expect(isPrimaryInboxMessage({ fromAddress: "a@b.com" })).toBe(true);
  });

  it("excludes non-inbox mail from every scope", () => {
    const rows = [
      { fromAddress: "a@b.com", categoryName: "PRIMARY" },
      { fromAddress: "s@b.com", metadata: { labelIds: ["SENT"] } },
      { fromAddress: "p@b.com", categoryName: "PROMOTIONS" },
    ];
    expect(filterMessagesByInboxScope(rows, "primary").kept).toHaveLength(1);
    expect(filterMessagesByInboxScope(rows, "promotions").kept).toHaveLength(1);
    expect(filterMessagesByInboxScope(rows, "everything").kept).toHaveLength(2);
  });
});

describe("Gmail sync depth", () => {
  it("syncs the Primary tab first, then the rest of the inbox", () => {
    const passes = buildGmailSyncPasses(GMAIL_SYNC_DEFAULT_DEPTH);
    expect(passes).toHaveLength(2);
    expect(passes[0]?.q).toContain("in:inbox");
    expect(passes[0]?.q).toContain("-category:promotions");
    expect(passes[0]?.target).toBe(GMAIL_SYNC_DEFAULT_DEPTH);
    expect(passes[1]?.q).toBe("in:inbox");
    // Never sent/draft/archived mail
    for (const pass of passes) expect(pass.q).toContain("in:inbox");
  });

  it("keeps depth well past a handful of messages and bounded", () => {
    expect(GMAIL_SYNC_DEFAULT_DEPTH).toBeGreaterThanOrEqual(50);
    expect(buildGmailSyncPasses(10_000)[0]?.target).toBe(GMAIL_SYNC_MAX_DEPTH);
    expect(buildGmailSyncPasses(0)[0]?.target).toBe(1);
  });
});
