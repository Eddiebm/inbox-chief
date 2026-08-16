import { describe, expect, it } from "vitest";
import { assertConfirmedSend } from "@/lib/email-send";
import {
  CALENDAR_NOT_CONNECTED_SPEECH,
  formatCalendarEventsSpeech,
} from "@/lib/calendar";
import { resolveContact } from "@/lib/contacts";
import {
  buildCallInSystemPrompt,
  buildCallInVapiTools,
  currentReplyTarget,
  isForbiddenSendTool,
} from "@/lib/call-in/vapi-tools";
import { demoMailboxSnapshot } from "@/lib/call-in/assistant";

describe("confirmed voice send safety", () => {
  it("never permits send without both approved state and explicit confirmation", () => {
    expect(() =>
      assertConfirmedSend({ status: "APPROVED", confirmed: false }),
    ).toThrow(/confirmation/i);
    expect(() =>
      assertConfirmedSend({ status: "AWAITING_APPROVAL", confirmed: true }),
    ).toThrow(/confirmation/i);
    expect(() =>
      assertConfirmedSend({ status: "APPROVED", confirmed: true }),
    ).not.toThrow();
  });

  it("publishes separate compose and confirmation tools", () => {
    const names = buildCallInVapiTools("https://example.com").map(
      (tool) => tool.function.name,
    );
    expect(names).toContain("compose_email");
    expect(names).toContain("confirm_email_send");
    expect(isForbiddenSendTool("compose_email")).toBe(false);
    expect(isForbiddenSendTool("confirm_email_send")).toBe(false);
    expect(isForbiddenSendTool("send_message")).toBe(true);
    const prompt = buildCallInSystemPrompt();
    expect(prompt).toMatch(/original request authorizes drafting only/i);
    expect(prompt).toMatch(/replyToCurrent=true/i);
  });

  it("replies to the message most recently read", () => {
    const target = currentReplyTarget(demoMailboxSnapshot("Alex"), 2);
    expect(target?.fromAddress).toMatch(/Sam Rivera/);
    expect(target?.subject).toMatch(/proposal/i);
  });
});

describe("contact resolution", () => {
  const contacts = [
    {
      id: "1",
      email: "jordan.one@example.com",
      displayName: "Jordan Lee",
      nickname: null,
    },
    {
      id: "2",
      email: "jordan.two@example.com",
      displayName: "Jordan Smith",
      nickname: null,
    },
    {
      id: "3",
      email: "mother@example.com",
      displayName: "Mary Lee",
      nickname: "Mom",
    },
  ];

  it("resolves a voice nickname", () => {
    expect(resolveContact("Mom", contacts)).toMatchObject({
      kind: "resolved",
      contact: { email: "mother@example.com" },
    });
  });

  it("requires disambiguation rather than guessing", () => {
    const result = resolveContact("Jordan", contacts);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") expect(result.candidates).toHaveLength(2);
  });
});

describe("calendar speech", () => {
  it("uses the exact not-connected guidance", () => {
    expect(CALENDAR_NOT_CONNECTED_SPEECH).toBe(
      "Calendar isn't connected yet. You can connect it in Settings.",
    );
  });

  it("speaks real event time, title, and location", () => {
    const spoken = formatCalendarEventsSpeech({
      range: "today",
      timeZone: "America/Chicago",
      events: [
        {
          summary: "Client review",
          location: "Conference room A",
          start: { dateTime: "2026-08-15T14:30:00-05:00" },
        },
      ],
    });
    expect(spoken).toMatch(/2:30 PM/i);
    expect(spoken).toMatch(/Client review/);
    expect(spoken).toMatch(/Conference room A/);
  });
});
