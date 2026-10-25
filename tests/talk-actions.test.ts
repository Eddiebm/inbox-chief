import { beforeEach, describe, expect, it, vi } from "vitest";
import { askSchema } from "@/app/api/call-in/ask/route";
import {
  confirmationDraftId,
  parseTalkAction,
  phoneToolForUtterance,
} from "@/lib/call-in/talk-actions";
import { dispatchTalkAction } from "@/lib/call-in/talk-dispatch";
import { handleCallInTool } from "@/lib/call-in/vapi-tools";
import type { CallInMailboxSnapshot } from "@/lib/call-in/assistant";

vi.mock("@/lib/db-node", () => ({
  getNodePrisma: () => ({
    callInIdentity: {
      findFirst: async () => ({ id: "identity_1" }),
    },
  }),
}));

vi.mock("@/lib/call-in/vapi-tools", async () => {
  const actual = await vi.importActual<typeof import("@/lib/call-in/vapi-tools")>(
    "@/lib/call-in/vapi-tools",
  );
  return {
    ...actual,
    handleCallInTool: vi.fn(),
  };
});

describe("askSchema", () => {
  it("accepts a briefing when no draft is waiting", () => {
    const parsed = askSchema.safeParse({
      question: "Give me a briefing",
      sessionId: "talk_1",
      timeZone: "America/Chicago",
      pendingDraftId: null,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.pendingDraftId ?? null).toBeNull();
  });

  it("accepts next when no draft is waiting", () => {
    const parsed = askSchema.safeParse({
      question: "next",
      sessionId: "talk_1",
      timeZone: "America/Chicago",
      pendingDraftId: null,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.question).toBe("next");
    expect(parsed.data.pendingDraftId ?? null).toBeNull();
  });
});

describe("parseTalkAction", () => {
  it("reads the calendar without stealing the next email", () => {
    expect(parseTalkAction("What is on my calendar today?")).toEqual({
      kind: "calendar",
      range: "today",
    });
    expect(parseTalkAction("What's on my calendar tomorrow")).toEqual({
      kind: "calendar",
      range: "tomorrow",
    });
    expect(parseTalkAction("What is next on my calendar")).toEqual({
      kind: "calendar",
      range: "next",
    });
    expect(parseTalkAction("Read the next email")).toBeNull();
  });

  it("drafts a new email and waits for an explicit send", () => {
    expect(parseTalkAction("Email Jordan about Thursday")).toEqual({
      kind: "compose",
      recipient: "Jordan",
      subject: "Thursday",
      body: "About Thursday.",
      replyToCurrent: false,
    });
    expect(parseTalkAction("Send a message to Jordan saying I will be late")).toMatchObject({
      kind: "compose",
      recipient: "Jordan",
      body: "I will be late",
      replyToCurrent: false,
    });
    expect(parseTalkAction("Reply to this one saying thanks")).toMatchObject({
      kind: "compose",
      replyToCurrent: true,
      body: "thanks",
    });
    expect(parseTalkAction("Email Jordan")).toEqual({
      kind: "need_message",
      replyToCurrent: false,
    });
    expect(parseTalkAction("Send it.")).toEqual({ kind: "confirm_send" });
    expect(parseTalkAction("Yes")).toBeNull();
    expect(parseTalkAction("Read my emails")).toBeNull();
  });

  it("finds the confirmation code in a read-back", () => {
    expect(
      confirmationDraftId("Nothing has been sent yet. Confirmation code cm123abc."),
    ).toBe("cm123abc");
  });
});

describe("phoneToolForUtterance", () => {
  it("reads mail instead of leaving a briefing as a spoken plan", () => {
    expect(phoneToolForUtterance("Give me a briefing")).toEqual({
      name: "read_emails",
      args: { position: "first", question: "Give me a briefing" },
    });
    expect(phoneToolForUtterance("Read my emails")?.name).toBe("read_emails");
    expect(phoneToolForUtterance("Any drafts waiting?")).toEqual({
      name: "get_drafts",
      args: {},
    });
    expect(phoneToolForUtterance("What needs attention?")?.name).toBe("read_emails");
    expect(phoneToolForUtterance("Is my Gmail connected?")?.name).toBe(
      "get_connection_status",
    );
  });

  it("does not steal a research request", () => {
    expect(phoneToolForUtterance("Find original papers on retinal repair")).toBeNull();
    expect(phoneToolForUtterance("Email this to me")).toBeNull();
  });

  it("advances, repeats, and steps back through the phone read tool", () => {
    expect(phoneToolForUtterance("next")).toEqual({
      name: "read_emails",
      args: { position: "next", question: "next" },
    });
    expect(phoneToolForUtterance("Next.")).toEqual({
      name: "read_emails",
      args: { position: "next", question: "Next" },
    });
    expect(phoneToolForUtterance("skip this")).toEqual({
      name: "read_emails",
      args: { position: "skip", question: "skip this" },
    });
    expect(phoneToolForUtterance("previous")).toEqual({
      name: "read_emails",
      args: { position: "previous", question: "previous" },
    });
    expect(phoneToolForUtterance("go back")).toEqual({
      name: "read_emails",
      args: { position: "previous", question: "go back" },
    });
    expect(phoneToolForUtterance("repeat")).toEqual({
      name: "read_emails",
      args: { position: "repeat", question: "repeat" },
    });
    expect(phoneToolForUtterance("continue")).toEqual({
      name: "read_emails",
      args: { position: "continue", question: "continue" },
    });
    expect(phoneToolForUtterance("slower")).toEqual({
      name: "set_speech_speed",
      args: { command: "slower", question: "slower" },
    });
    expect(phoneToolForUtterance("What is next on my calendar")).toBeNull();
    expect(phoneToolForUtterance("Read the next email")).toMatchObject({
      name: "read_emails",
      args: { position: "next" },
    });
  });
});

describe("dispatchTalkAction", () => {
  const snapshot = { organizationId: "org" } as CallInMailboxSnapshot;

  beforeEach(() => {
    vi.mocked(handleCallInTool).mockReset();
  });

  it("refuses to send when no draft is waiting", async () => {
    const result = await dispatchTalkAction({
      text: "Send it",
      snapshot,
      userId: "user",
      pendingDraftId: null,
    });
    expect(result?.intent).toBe("send_email");
    expect(result?.spoken).toMatch(/Nothing was sent/);
    expect(result?.draftId).toBeNull();
  });

  it("runs the phone read tool instead of announcing a plan", async () => {
    vi.mocked(handleCallInTool).mockResolvedValueOnce({
      spoken: "Email 1 of 2. From Jordan. Subject: Thursday. Message: Thursday works.",
      intent: "read_emails",
      toolName: "read_emails",
      emailSent: false,
    });
    const result = await dispatchTalkAction({
      text: "Give me a briefing",
      snapshot,
      userId: "user",
    });
    expect(handleCallInTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "read_emails",
        callInIdentityId: "identity_1",
        args: expect.objectContaining({ position: "first" }),
      }),
    );
    expect(result?.spoken).toMatch(/From Jordan/);
    expect(result?.spoken).not.toMatch(/I will read each one/);
  });

  it("runs read_emails for next instead of a plan with no tool call", async () => {
    vi.mocked(handleCallInTool).mockResolvedValueOnce({
      spoken: "Email 2 of 3. From Sam. Subject: Budget. Message: The revised quote is attached.",
      intent: "read_emails",
      toolName: "read_emails",
      emailSent: false,
    });
    const result = await dispatchTalkAction({
      text: "next",
      snapshot,
      userId: "user",
      pendingDraftId: null,
      callId: "talk_1",
    });
    expect(handleCallInTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "read_emails",
        callId: "talk_1",
        callInIdentityId: "identity_1",
        args: expect.objectContaining({ position: "next", question: "next" }),
      }),
    );
    expect(result?.intent).toBe("read_emails");
    expect(result?.spoken).toMatch(/Email 2 of 3/);
    expect(result?.spoken).not.toMatch(/I will|I'll /);
  });

  it("runs the phone cursor for previous and repeat", async () => {
    vi.mocked(handleCallInTool).mockResolvedValue({
      spoken: "Email 1 of 3. From Jordan.",
      intent: "read_emails",
      toolName: "read_emails",
      emailSent: false,
    });
    await dispatchTalkAction({
      text: "previous",
      snapshot,
      userId: "user",
      callId: "talk_1",
    });
    expect(handleCallInTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "read_emails",
        args: expect.objectContaining({ position: "previous" }),
      }),
    );
    await dispatchTalkAction({
      text: "repeat",
      snapshot,
      userId: "user",
      callId: "talk_1",
    });
    expect(handleCallInTool).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "read_emails",
        args: expect.objectContaining({ position: "repeat" }),
      }),
    );
  });

  it("ignores no unless a draft is waiting", async () => {
    expect(
      await dispatchTalkAction({
        text: "No",
        snapshot,
        userId: "user",
      }),
    ).toBeNull();
  });
});
