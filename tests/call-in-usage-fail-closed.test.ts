import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoMailboxSnapshot } from "@/lib/call-in/assistant";
import { USAGE_UNAVAILABLE_SPOKEN } from "@/lib/billing/call-usage";

const mocks = vi.hoisted(() => ({
  loadCallMinuteUsageForOrg: vi.fn(),
  resolveSnapshotForCaller: vi.fn(),
}));

vi.mock("@/lib/billing/call-usage-server", () => ({
  loadCallMinuteUsageForOrg: mocks.loadCallMinuteUsageForOrg,
}));

vi.mock("@/lib/call-in/identity", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/call-in/identity")
  >("@/lib/call-in/identity");
  return { ...actual, resolveSnapshotForCaller: mocks.resolveSnapshotForCaller };
});

import { handleVapiCallInWebhook } from "@/lib/call-in/vapi-webhook";

/** A matched, paying org — the path where minutes must be accounted for. */
const matchedSnapshot = {
  ...demoMailboxSnapshot("Eddie"),
  organizationId: "org_real",
  workspaceId: "ws_real",
  mailboxId: "mb_real",
  identityStatus: "matched" as const,
  connectionStatus: "connected" as const,
};

function toolCallBody(names: string[]) {
  return {
    message: {
      type: "tool-calls",
      call: { id: "call_1", customer: { number: "+14055106989" } },
      toolCallList: names.map((name, i) => ({ id: `tc_${i}`, name, arguments: {} })),
    },
  };
}

describe("call minute usage failures fail closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.resolveSnapshotForCaller.mockResolvedValue({
      snapshot: matchedSnapshot,
      matched: true,
      phoneE164: "+14055106989",
      callInIdentityId: "cid_1",
      userId: null,
      source: "call_in_identity",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses billable tools when the minute balance cannot be loaded", async () => {
    // Simulates an unapplied minute-pack migration or a Neon outage.
    mocks.loadCallMinuteUsageForOrg.mockRejectedValue(
      new Error('relation "CallMinuteBalance" does not exist'),
    );

    const result = await handleVapiCallInWebhook(
      toolCallBody(["read_emails", "get_briefing", "compose_email"]),
    );
    expect("results" in result).toBe(true);
    if (!("results" in result)) return;

    for (const row of result.results) {
      expect(row.result).toBe(USAGE_UNAVAILABLE_SPOKEN);
      expect(row.result).not.toMatch(/Jordan Lee|Schedule confirmation/i);
    }
  });

  it("keeps setup and status tools available during a usage outage", async () => {
    mocks.loadCallMinuteUsageForOrg.mockRejectedValue(new Error("db down"));

    const result = await handleVapiCallInWebhook(
      toolCallBody(["get_connection_status"]),
    );
    if (!("results" in result)) throw new Error("expected tool results");
    expect(result.results[0]?.result).not.toBe(USAGE_UNAVAILABLE_SPOKEN);
    expect(result.results[0]?.result).toMatch(/connect|connection|disconnected/i);
  });

  it("says so on the opening rather than inviting the caller to spend minutes", async () => {
    mocks.loadCallMinuteUsageForOrg.mockRejectedValue(new Error("db down"));

    const result = await handleVapiCallInWebhook({
      message: {
        type: "conversation-update",
        call: { id: "call_2", customer: { number: "+14055106989" } },
      },
    });
    if (!("note" in result)) throw new Error("expected a spoken note");
    expect(result.note).not.toBe(USAGE_UNAVAILABLE_SPOKEN);
    expect(result.note).toMatch(/read your emails/i);
  });

  it("serves normally when the balance loads with minutes left", async () => {
    mocks.loadCallMinuteUsageForOrg.mockResolvedValue({
      hardCapReached: false,
      warningLevel: "none",
      spokenWarning: "",
      spokenCapReached: "unused",
    });

    const result = await handleVapiCallInWebhook(toolCallBody(["read_emails"]));
    if (!("results" in result)) throw new Error("expected tool results");
    expect(result.results[0]?.result).not.toBe(USAGE_UNAVAILABLE_SPOKEN);
    expect(result.results[0]?.result).toMatch(/Email 1 of|From Jordan/i);
  });
});
