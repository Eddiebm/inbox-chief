import { afterEach, describe, expect, it } from "vitest";
import { demoMailboxSnapshot } from "@/lib/call-in/assistant";
import { normalizePhoneE164 } from "@/lib/call-in/identity";
import {
  handleCallInTool,
  isForbiddenSendTool,
  neverSendSpoken,
} from "@/lib/call-in/vapi-tools";
import { handleVapiCallInWebhook, parseToolCall } from "@/lib/call-in/vapi-webhook";

const snap = demoMailboxSnapshot("Alex");

const ENV_KEYS = ["MOCK_INTEGRATIONS", "VAPI_WEBHOOK_SECRET", "DATABASE_URL"] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("VAPI call-in webhook tool routing", () => {
  it("normalizes US caller phones to E.164", () => {
    expect(normalizePhoneE164("405 716 9240")).toBe("+14057169240");
    expect(normalizePhoneE164("+14057169240")).toBe("+14057169240");
    expect(normalizePhoneE164("(405) 716-9240")).toBe("+14057169240");
    // Eddie's cell — all inbound forms must normalize to the same E.164
    expect(normalizePhoneE164("4055106989")).toBe("+14055106989");
    expect(normalizePhoneE164("14055106989")).toBe("+14055106989");
    expect(normalizePhoneE164("+14055106989")).toBe("+14055106989");
    expect(normalizePhoneE164("+1 405 510 6989")).toBe("+14055106989");
  });

  it("phoneE164Candidates covers 10-digit / 11-digit / +E.164 forms", async () => {
    const { phoneE164Candidates } = await import("@/lib/call-in/identity");
    const set = new Set(phoneE164Candidates("4055106989"));
    expect(set.has("+14055106989")).toBe(true);
    expect(set.has("4055106989")).toBe(true);
    expect(set.has("14055106989")).toBe(true);
  });

  it("routes briefing / attention / drafts / approvals / follow-ups / connection tools", async () => {
    process.env.MOCK_INTEGRATIONS = "true";

    const cases = [
      { name: "get_briefing", expectIntent: /Subject:|From Jordan|Subjects first|read email/i },
      { name: "read_emails", expectIntent: /Email 1 of|From Jordan|Message:/i },
      { name: "get_needs_attention", expectIntent: /Email 1 of|From Jordan|attention/i },
      { name: "get_drafts", expectIntent: /draft/i },
      { name: "get_approvals", expectIntent: /approval/i },
      { name: "get_follow_ups", expectIntent: /follow-up/i },
      { name: "get_connection_status", expectIntent: /connection|disconnected|connected/i },
    ] as const;

    for (const c of cases) {
      const handled = await handleCallInTool({ name: c.name, snapshot: snap });
      expect(handled.emailSent).toBe(false);
      expect(handled.spoken).toMatch(c.expectIntent);
    }
  });

  it("briefing tool payload includes subjects suitable for TTS", async () => {
    const handled = await handleCallInTool({
      name: "get_briefing",
      snapshot: snap,
    });
    expect(handled.emailSent).toBe(false);
    expect(handled.spoken).toMatch(/From Jordan Lee/i);
    expect(handled.spoken).toMatch(/Subject: Schedule confirmation/i);
    expect(handled.spoken).toMatch(/read email 1|read my emails|Nothing sends/i);
  });

  it("first briefing tool result includes the new-Primary count", async () => {
    const handled = await handleCallInTool({
      name: "get_briefing",
      snapshot: {
        ...snap,
        newPrimaryCount: 2,
        isFirstSuccessfulCall: false,
        newPrimaryAnnouncement:
          "You have 2 new emails in Primary since your last call.",
      },
    });
    expect(handled.spoken).toMatch(
      /^You have 2 new emails in Primary since your last call\./,
    );
  });

  it("read_emails respects startIndex for next-email flow", async () => {
    const handled = await handleCallInTool({
      name: "read_emails",
      args: { startIndex: 1 },
      snapshot: snap,
    });
    expect(handled.intent).toBe("read_emails");
    expect(handled.spoken).toMatch(/Email 2 of 3/i);
    expect(handled.spoken).toMatch(/Sam Rivera|proposal/i);
  });

  it("ask_inbox reuses assistant + never claims send", async () => {
    const handled = await handleCallInTool({
      name: "ask_inbox",
      args: { question: "Give me a briefing" },
      snapshot: snap,
    });
    expect(handled.intent).toBe("briefing");
    expect(handled.emailSent).toBe(false);
    expect(handled.spoken.toLowerCase()).not.toMatch(
      /i (have )?sent|email (was |has been )?sent|sending now/,
    );
  });

  it("rejects forbidden send tools (never-send invariant)", async () => {
    expect(isForbiddenSendTool("send_message")).toBe(true);
    expect(isForbiddenSendTool("approve_and_send")).toBe(true);
    expect(isForbiddenSendTool("get_briefing")).toBe(false);

    const handled = await handleCallInTool({
      name: "send_message",
      args: { to: "x@example.com", body: "hi" },
      snapshot: snap,
    });
    expect(handled.intent).toBe("forbidden_send");
    expect(handled.emailSent).toBe(false);
    expect(handled.spoken).toBe(neverSendSpoken());
    expect(handled.spoken.toLowerCase()).toMatch(/never sends/);
  });

  it("webhook tool-calls returns speakable results and blocks send", async () => {
    process.env.MOCK_INTEGRATIONS = "true";

    const body = {
      message: {
        type: "tool-calls",
        call: {
          id: "call_test_1",
          customer: { number: "+14057169240" },
        },
        toolCallList: [
          { id: "tc_brief", name: "get_briefing", arguments: {} },
          {
            id: "tc_send",
            name: "send_message",
            arguments: { to: "victim@example.com" },
          },
          {
            id: "tc_ask",
            function: {
              name: "ask_inbox",
              arguments: { question: "What needs attention?" },
            },
          },
        ],
      },
    };

    const result = await handleVapiCallInWebhook(body);
    expect("results" in result).toBe(true);
    if (!("results" in result)) return;

    expect(result.results).toHaveLength(3);
    expect(result.results[0]?.toolCallId).toBe("tc_brief");
    expect(result.results[0]?.result).toMatch(/Email 1 of|From Jordan|Subject:/i);
    expect(result.results[0]?.result.length).toBeGreaterThan(40);
    expect(result.results[1]?.result.toLowerCase()).toMatch(/never sends/);
    expect(result.results[2]?.result).toMatch(/Email 1 of|From Jordan/i);

    for (const row of result.results) {
      expect(row.result.toLowerCase()).not.toMatch(
        /\b(email sent|message sent|i sent|sending your email)\b/,
      );
    }
  });

  it("hard cap denies billable tools and speaks the exhausted message verbatim", async () => {
    const capSpoken =
      "You have no call minutes left. Your 90 included minutes for this Patron period are used up, and you have no purchased minutes remaining. To keep using call-in, buy more minutes or upgrade your plan in the Inbox Chief dashboard, or wait until your included minutes reset on September 1. I cannot read more mail or start a new request until then.";
    const hardCap = { reached: true, spoken: capSpoken };

    // Reading / composing / asking is denied at the cap — no mail is read.
    for (const name of [
      "read_emails",
      "get_briefing",
      "get_needs_attention",
      "ask_inbox",
      "compose_email",
    ] as const) {
      const handled = await handleCallInTool({
        name,
        args: { question: "read my emails", body: "hi", recipient: "x@y.com" },
        snapshot: snap,
        hardCap,
      });
      expect(handled.intent).toBe("minute_cap");
      expect(handled.spoken).toBe(capSpoken);
      expect(handled.spoken.toLowerCase()).toContain("buy more minutes");
      expect(handled.emailSent).toBe(false);
      expect(handled.spoken).not.toMatch(/Schedule confirmation|Jordan Lee/i);
    }
  });

  it("hard cap still allows cheap setup/status tools", async () => {
    const hardCap = {
      reached: true,
      spoken: "You have used all your minutes.",
    };
    const status = await handleCallInTool({
      name: "get_connection_status",
      snapshot: snap,
      hardCap,
    });
    expect(status.intent).not.toBe("minute_cap");
    expect(status.spoken).toMatch(/connect|connection|disconnected/i);
  });

  it("under the cap, tools run normally (no minute_cap block)", async () => {
    const handled = await handleCallInTool({
      name: "read_emails",
      snapshot: snap,
      hardCap: { reached: false, spoken: "unused" },
    });
    expect(handled.intent).toBe("read_emails");
    expect(handled.spoken).toMatch(/Email 1 of|From Jordan/i);
  });

  it("unmatched caller with MOCK off never gets demo email subjects", async () => {
    process.env.MOCK_INTEGRATIONS = "false";
    process.env.DATABASE_URL = "postgresql://unused";

    const { handleCallInTool: handle } = await import("@/lib/call-in/vapi-tools");
    const { unrecognizedCallerSnapshot, UNRECOGNIZED_CALLER_SPOKEN } =
      await import("@/lib/call-in/assistant");
    const snapU = unrecognizedCallerSnapshot();

    for (const name of ["get_briefing", "read_emails", "get_needs_attention"] as const) {
      const handled = await handle({ name, snapshot: snapU });
      expect(handled.emailSent).toBe(false);
      expect(handled.spoken).toBe(UNRECOGNIZED_CALLER_SPOKEN);
      expect(handled.spoken).toMatch(/don't recognize this phone number/i);
      expect(handled.spoken).toMatch(/Anytime call-in phone/i);
      expect(handled.spoken).not.toMatch(/Schedule confirmation|Jordan Lee|Anita/i);
      expect(handled.spoken).not.toMatch(/\brecognize the name\b/i);
    }
  });

  it("VAPI system prompt forbids inventing CNAM names and demo mail for unmatched", async () => {
    const { buildCallInSystemPrompt } = await import("@/lib/call-in/vapi-tools");
    const prompt = buildCallInSystemPrompt();
    expect(prompt).toMatch(/NEVER invent or speak a person's name/i);
    expect(prompt).toMatch(/CNAM/i);
    expect(prompt).toMatch(/VERBATIM/i);
    expect(prompt).toMatch(/Never invent demo/i);
    expect(prompt).toMatch(/ATTACHMENT CONSENT/i);
    expect(prompt).toMatch(/never.*extract attachment contents/i);
    expect(prompt).toMatch(/never hallucinate content/i);
    expect(prompt).not.toMatch(/still answer with available demo/i);
  });

  it("assistant-request returns firstMessage from identity path (no CNAM name)", async () => {
    process.env.MOCK_INTEGRATIONS = "false";
    process.env.DATABASE_URL = "postgresql://unused";

    // Force unrecognized by making resolve fail (bad DATABASE_URL) — snapshot is unrecognized
    const { UNRECOGNIZED_CALLER_SPOKEN } = await import("@/lib/call-in/assistant");

    // Mock resolve via MOCK off + no usable DB → unrecognized on catch
    // Identity resolve catches DB errors and returns unrecognized
    const result = await handleVapiCallInWebhook({
      message: {
        type: "assistant-request",
        call: {
          id: "call_unrec",
          customer: { number: "+14055106989", name: "Anita" },
        },
      },
    });

    expect(result).toMatchObject({ ok: true, eventType: "assistant-request" });
    if (!("assistant" in result) || !result.assistant) {
      throw new Error("expected assistant override");
    }
    const first = String(result.assistant.firstMessage ?? "");
    expect(first).toBe(UNRECOGNIZED_CALLER_SPOKEN);
    expect(first).not.toMatch(/Anita/i);
    expect(first).toMatch(/don't recognize this phone number/i);
    // extractCallerNumber must ignore name — only number used
    expect(first).not.toMatch(/recognize the name/i);
  });

  it("matched real mailbox snapshot is used instead of demo when provided to tools", async () => {
    const realSnap = {
      ...demoMailboxSnapshot("Eddie"),
      identityStatus: "matched" as const,
      organizationId: "org_real",
      workspaceId: "ws_real",
      mailboxId: "mb_real",
      mailboxEmail: "eddie@bannermanmenson.com",
      connectionStatus: "connected" as const,
      needingAttention: 1,
      recentSubjects: ["Re: *Updated* 1330 S. New FLORISSANT RD."],
      readableEmails: [
        {
          fromAddress: "Eddie Bannerman-Menson <eddie@bannermanmenson.com>",
          subject: "Re: *Updated* 1330 S. New FLORISSANT RD.",
          readableText: "Rent was set at 2200. What has changed",
          contentSource: "snippet" as const,
        },
      ],
      briefing: "1 message to read.",
      securityNote: "linked",
    };

    const handled = await handleCallInTool({
      name: "read_emails",
      snapshot: realSnap,
    });
    expect(handled.spoken).toMatch(/FLORISSANT/i);
    expect(handled.spoken).toMatch(/Rent was set at 2200/i);
    expect(handled.spoken).not.toMatch(/Schedule confirmation for Thursday/i);
  });

  it("parses nested function tool-call shapes from VAPI", () => {
    const parsed = parseToolCall({
      id: "tc1",
      function: {
        name: "ask_inbox",
        arguments: JSON.stringify({ question: "Any drafts?" }),
      },
    });
    expect(parsed.name).toBe("ask_inbox");
    expect(parsed.args.question).toBe("Any drafts?");
  });

  it("end-of-call records cost without contradicting confirmed sends", async () => {
    process.env.MOCK_INTEGRATIONS = "true";
    const result = await handleVapiCallInWebhook({
      message: {
        type: "end-of-call-report",
        endedReason: "hangup",
        cost: 0.12,
        durationSeconds: 88,
        call: { id: "call_end", customer: { number: "+14057169240" } },
        summary: "Caller asked for briefing",
      },
    });
    expect(result).toMatchObject({
      ok: true,
      eventType: "end-of-call-report",
      callId: "call_end",
      costUsd: 0.12,
      costRecorded: false,
    });
    if ("note" in result) {
      expect(result.note?.toLowerCase()).toMatch(/explicit read-back confirmation/);
    }
  });
});
