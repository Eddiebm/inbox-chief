import { describe, expect, it } from "vitest";
import {
  answerCallInQuestion,
  demoMailboxSnapshot,
  emailsForCallInScope,
  speakReadableEmails,
} from "@/lib/call-in/assistant";
import {
  categoryNameFromGmailLabels,
  filterMessagesByInboxScope,
  isPrimaryInboxMessage,
  looksLikeMarketingJunk,
  parseCallInInboxScope,
  resolveInboxTab,
  speakPrimaryInboxIntro,
} from "@/lib/call-in/primary-inbox";

describe("call-in Primary inbox filter", () => {
  it("maps Gmail labels to categoryName including Primary and tabs", () => {
    expect(
      categoryNameFromGmailLabels(["INBOX", "CATEGORY_PERSONAL", "UNREAD"]),
    ).toBe("PRIMARY");
    expect(
      categoryNameFromGmailLabels(["INBOX", "CATEGORY_PRIMARY", "IMPORTANT"]),
    ).toBe("PRIMARY");
    expect(categoryNameFromGmailLabels(["INBOX", "CATEGORY_PROMOTIONS"])).toBe(
      "PROMOTIONS",
    );
    expect(categoryNameFromGmailLabels(["INBOX", "CATEGORY_SOCIAL"])).toBe(
      "SOCIAL",
    );
    expect(categoryNameFromGmailLabels(["INBOX", "CATEGORY_UPDATES"])).toBe(
      "UPDATES",
    );
    expect(categoryNameFromGmailLabels(["INBOX", "CATEGORY_FORUMS"])).toBe(
      "FORUMS",
    );
    expect(categoryNameFromGmailLabels(["SPAM"])).toBe("SPAM");
    // INBOX alone → Primary
    expect(categoryNameFromGmailLabels(["INBOX", "UNREAD"])).toBe("PRIMARY");
  });

  it("treats CATEGORY_PERSONAL / CATEGORY_PRIMARY / INBOX-without-tabs as Primary", () => {
    expect(
      isPrimaryInboxMessage({
        fromAddress: "a@b.com",
        categoryName: "PRIMARY",
      }),
    ).toBe(true);
    expect(
      isPrimaryInboxMessage({
        fromAddress: "a@b.com",
        metadata: { labelIds: ["INBOX", "CATEGORY_PERSONAL"] },
      }),
    ).toBe(true);
    expect(
      isPrimaryInboxMessage({
        fromAddress: "a@b.com",
        metadata: { labelIds: ["INBOX"] },
      }),
    ).toBe(true);
    expect(
      isPrimaryInboxMessage({
        fromAddress: "a@b.com",
        metadata: { labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] },
      }),
    ).toBe(false);
  });

  it("filters default scope to Primary and counts skipped tabs", () => {
    const messages = [
      {
        fromAddress: "jordan@example.com",
        subject: "Meeting",
        categoryName: "PRIMARY",
      },
      {
        fromAddress: "deals@shop.example",
        subject: "Sale",
        categoryName: "PROMOTIONS",
      },
      {
        fromAddress: "social@network.example",
        subject: "Liked your post",
        categoryName: "SOCIAL",
      },
      {
        fromAddress: "spam@bad.example",
        subject: "Win cash",
        categoryName: "SPAM",
      },
    ];
    const { kept, skippedNonPrimaryCount } = filterMessagesByInboxScope(
      messages,
      "primary",
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.fromAddress).toBe("jordan@example.com");
    expect(skippedNonPrimaryCount).toBe(3);
  });

  it("opt-in promotions scope returns non-primary tabs but not spam or primary", () => {
    const messages = [
      { fromAddress: "a@b.com", categoryName: "PRIMARY" },
      { fromAddress: "p@b.com", categoryName: "PROMOTIONS" },
      { fromAddress: "s@b.com", categoryName: "SOCIAL" },
      { fromAddress: "x@b.com", categoryName: "SPAM" },
    ];
    const { kept } = filterMessagesByInboxScope(messages, "promotions");
    expect(kept.map((m) => m.categoryName).sort()).toEqual([
      "PROMOTIONS",
      "SOCIAL",
    ]);
  });

  it("conservative marketing heuristic requires strong signals", () => {
    expect(
      looksLikeMarketingJunk({
        fromAddress: "Alex <alex@company.com>",
        subject: "Quick question",
        snippet: "Can we talk Thursday?",
      }),
    ).toBe(false);

    expect(
      looksLikeMarketingJunk({
        fromAddress: "Deals <noreply@shop.example>",
        subject: "40% off flash sale",
        snippet: "List-Unsubscribe. Manage preferences. View in browser.",
      }),
    ).toBe(true);
  });

  it("parses opt-in phrases for scope", () => {
    expect(parseCallInInboxScope("read my emails")).toBe("primary");
    expect(parseCallInInboxScope("give me a briefing")).toBe("primary");
    expect(parseCallInInboxScope("read promotions")).toBe("promotions");
    expect(parseCallInInboxScope("read junk")).toBe("promotions");
    expect(parseCallInInboxScope("read everything")).toBe("everything");
    expect(parseCallInInboxScope("include all tabs")).toBe("everything");
  });

  it("speaks a Primary skip intro", () => {
    expect(
      speakPrimaryInboxIntro({
        keptCount: 3,
        skippedCount: 12,
        scope: "primary",
      }),
    ).toMatch(/Reading your primary inbox/i);
    expect(
      speakPrimaryInboxIntro({
        keptCount: 3,
        skippedCount: 12,
        scope: "primary",
      }),
    ).toMatch(/Skipping 12 promotional/i);
  });

  it("default read my emails stays on Primary and announces skip", () => {
    const snap = demoMailboxSnapshot("Eddie");
    expect(snap.skippedNonPrimaryCount).toBeGreaterThan(0);
    const a = answerCallInQuestion("Read my emails", snap);
    expect(a.spoken).toMatch(/primary inbox/i);
    expect(a.spoken).toMatch(/Skipping 1 promotional/i);
    expect(a.spoken).toMatch(/Jordan Lee/i);
    expect(a.spoken).not.toMatch(/noreply@shop\.example|flash sale/i);
  });

  it("read promotions opt-in reads non-primary list", () => {
    const snap = demoMailboxSnapshot("Eddie");
    const a = answerCallInQuestion("Read promotions", snap);
    expect(a.intent).toBe("read_emails");
    expect(a.spoken).toMatch(/promotions|non-primary/i);
    expect(a.spoken).toMatch(/flash sale|Deals/i);
    expect(a.spoken).not.toMatch(/Jordan Lee/i);
  });

  it("emailsForCallInScope combines lists for everything", () => {
    const snap = demoMailboxSnapshot("Eddie");
    const all = emailsForCallInScope(snap, "everything");
    expect(all.length).toBe(
      snap.readableEmails.length + snap.readableEmailsNonPrimary.length,
    );
    const spoken = speakReadableEmails(all, {
      scope: "everything",
      skippedNonPrimaryCount: 0,
    });
    expect(spoken).toMatch(/everything except spam/i);
  });

  it("resolves tab from metadata labelIds when categoryName missing", () => {
    expect(
      resolveInboxTab({
        fromAddress: "x@y.com",
        metadata: { labelIds: ["INBOX", "CATEGORY_UPDATES"] },
      }),
    ).toBe("updates");
  });
});
