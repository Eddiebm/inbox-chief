import { describe, expect, it } from "vitest";
import {
  loadNewPrimaryCount,
  speakNewPrimaryCount,
  type MessageForNewPrimaryCount,
} from "@/lib/call-in/new-primary-count";

function prismaWith(messages: MessageForNewPrimaryCount[]) {
  return {
    message: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        const receivedAt = args.where.receivedAt as { gt?: Date } | undefined;
        return receivedAt?.gt
          ? messages.filter((message) => message.receivedAt > receivedAt.gt!)
          : messages;
      },
    },
  };
}

describe("new Primary mail since last completed call", () => {
  it("announces every Primary message on the first call", async () => {
    const count = await loadNewPrimaryCount({
      prisma: prismaWith([
        {
          fromAddress: "person@example.com",
          metadata: { labelIds: ["INBOX", "CATEGORY_PERSONAL"] },
          categoryName: "PRIMARY",
          receivedAt: new Date("2026-08-15T10:00:00Z"),
        },
      ]),
      tenantFilter: { mailboxId: "mb_1" },
      since: null,
    });

    expect(count).toBe(1);
    expect(speakNewPrimaryCount({ count, isFirstCall: true })).toBe(
      "Welcome. You have 1 message in Primary.",
    );
  });

  it("announces a positive count after the last call", async () => {
    expect(speakNewPrimaryCount({ count: 4, isFirstCall: false })).toBe(
      "You have 4 new emails in Primary since your last call.",
    );
  });

  it("announces when there are no new Primary messages", () => {
    expect(speakNewPrimaryCount({ count: 0, isFirstCall: false })).toBe(
      "No new emails since your last call.",
    );
  });

  it("counts only newer Primary mail and excludes promotions", async () => {
    const lastCall = new Date("2026-08-15T09:00:00Z");
    const count = await loadNewPrimaryCount({
      prisma: prismaWith([
        {
          fromAddress: "person@example.com",
          metadata: { labelIds: ["INBOX", "CATEGORY_PERSONAL"] },
          categoryName: "PRIMARY",
          receivedAt: new Date("2026-08-15T10:00:00Z"),
        },
        {
          fromAddress: "offers@shop.example",
          metadata: { labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] },
          categoryName: "PROMOTIONS",
          receivedAt: new Date("2026-08-15T11:00:00Z"),
        },
        {
          fromAddress: "older@example.com",
          metadata: { labelIds: ["INBOX", "CATEGORY_PERSONAL"] },
          categoryName: "PRIMARY",
          receivedAt: new Date("2026-08-15T08:00:00Z"),
        },
      ]),
      tenantFilter: { mailboxId: "mb_1" },
      since: lastCall,
    });

    expect(count).toBe(1);
  });
});
