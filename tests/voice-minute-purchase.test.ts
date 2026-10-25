import { describe, expect, it } from "vitest";
import {
  isBuyMinutesRequest,
  parseMinutePackChoice,
  parseMinutePackFromArgs,
  speakMinutePackMenu,
  startVoiceMinutePackPurchase,
} from "@/lib/billing/voice-minute-purchase";
import {
  buildCallInSystemPrompt,
  buildCallInVapiTools,
  VAPI_CALL_IN_TOOL_NAMES,
} from "@/lib/call-in/vapi-tools";

describe("voice minute purchase", () => {
  it("parses 30 / 60 / 120 from speech and tool args", () => {
    expect(parseMinutePackChoice("buy 30 minutes")).toBe("pack_30");
    expect(parseMinutePackChoice("buy sixty minutes")).toBe("pack_60");
    expect(parseMinutePackChoice("one hundred twenty")).toBe("pack_120");
    expect(parseMinutePackChoice(120)).toBe("pack_120");
    expect(parseMinutePackFromArgs({ minutes: 60 })).toBe("pack_60");
    expect(parseMinutePackChoice("buy minutes")).toBeNull();
  });

  it("detects buy requests without treating remaining-minutes questions as purchases", () => {
    expect(isBuyMinutesRequest("buy more minutes")).toBe(true);
    expect(isBuyMinutesRequest("top up my time")).toBe(true);
    expect(isBuyMinutesRequest("how many minutes do I have left")).toBe(false);
  });

  it("lists packs without taking a card on the call", () => {
    const spoken = speakMinutePackMenu();
    expect(spoken).toMatch(/30 minutes is 18 dollars/i);
    expect(spoken).toMatch(/60 minutes is 30 dollars/i);
    expect(spoken).toMatch(/120 minutes is 48 dollars/i);
    expect(spoken).toMatch(/never|without giving a card number/i);
  });

  it("exposes buy_minutes and forbids card numbers in the prompt", () => {
    expect(VAPI_CALL_IN_TOOL_NAMES).toContain("buy_minutes");
    const names = buildCallInVapiTools("https://example.test").map(
      (tool) => tool.function.name,
    );
    expect(names).toContain("buy_minutes");
    const prompt = buildCallInSystemPrompt();
    expect(prompt).toMatch(/buy_minutes/);
    expect(prompt).toMatch(/NEVER ask for a card number/i);
  });

  it("does not start checkout for an unmatched or demo caller", async () => {
    const result = await startVoiceMinutePackPurchase({
      organizationId: "demo_org",
      userId: "user_1",
      callerPhone: "+14055106989",
      packId: "pack_30",
    });
    expect(result.smsSent).toBe(false);
    expect(result.spoken).toMatch(/saved Inbox Chief phone/i);
  });
});
