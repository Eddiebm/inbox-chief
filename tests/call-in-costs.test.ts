import { describe, expect, it } from "vitest";
import {
  aggregateCallCostTally,
  buildSpokenCallCostSummary,
  formatUsdPlain,
  parseVapiCallCost,
} from "@/lib/call-in/call-cost-format";

describe("VAPI call cost parse + tally", () => {
  it("parses end-of-call-report cost in USD with duration and endedReason", () => {
    const parsed = parseVapiCallCost({
      message: {
        type: "end-of-call-report",
        endedReason: "customer-ended-call",
        cost: 0.12,
        durationSeconds: 95,
        startedAt: "2026-08-11T18:00:00.000Z",
        endedAt: "2026-08-11T18:01:35.000Z",
        summary: "Caller asked for briefing",
        call: {
          id: "call_abc123",
          customer: { number: "+14057169240" },
        },
        costBreakdown: { stt: 0.02, llm: 0.05, tts: 0.04, vapi: 0.01, total: 0.12 },
      },
    });

    expect(parsed.callId).toBe("call_abc123");
    expect(parsed.costUsd).toBe(0.12);
    expect(parsed.durationSeconds).toBe(95);
    expect(parsed.endedReason).toBe("customer-ended-call");
    expect(parsed.fromPhone).toBe("+14057169240");
    expect(parsed.costSource).toBe("vapi_webhook");
    expect(parsed.costBreakdown?.total).toBe(0.12);
  });

  it("falls back to call.cost and durationMs when top-level fields missing", () => {
    const parsed = parseVapiCallCost({
      message: {
        type: "end-of-call-report",
        call: {
          id: "call_ms",
          cost: 0.045,
          durationMs: 45000,
          customer: { number: "+15551234567" },
        },
      },
    });
    expect(parsed.costUsd).toBe(0.045);
    expect(parsed.durationSeconds).toBe(45);
  });

  it("formats cents and dollars in plain language", () => {
    expect(formatUsdPlain(0.12)).toBe("12 cents");
    expect(formatUsdPlain(0.01)).toBe("1 cent");
    expect(formatUsdPlain(1.4)).toBe("$1.40");
    expect(formatUsdPlain(0)).toBe("$0.00");
  });

  it("aggregates last / today / month / lifetime totals", () => {
    const now = new Date(2026, 7, 11, 15, 0, 0); // Aug 11 2026 local
    const rows = [
      {
        costUsd: 0.12,
        startedAt: new Date(2026, 7, 11, 10, 0, 0),
        endedAt: new Date(2026, 7, 11, 10, 2, 0),
        durationSeconds: 120,
        providerCallSid: "call_last",
      },
      {
        costUsd: 0.5,
        startedAt: new Date(2026, 7, 10, 9, 0, 0),
        endedAt: new Date(2026, 7, 10, 9, 5, 0),
        durationSeconds: 300,
        providerCallSid: "call_yesterday",
      },
      {
        costUsd: 0.78,
        startedAt: new Date(2026, 6, 1, 9, 0, 0),
        endedAt: new Date(2026, 6, 1, 9, 3, 0),
        durationSeconds: 180,
        providerCallSid: "call_july",
      },
    ];

    const tally = aggregateCallCostTally(rows, now);
    expect(tally.lastCallCostUsd).toBe(0.12);
    expect(tally.lastCallId).toBe("call_last");
    expect(tally.todayUsd).toBe(0.12);
    expect(tally.monthUsd).toBe(0.62);
    expect(tally.lifetimeUsd).toBe(1.4);
    expect(tally.callCountLifetime).toBe(3);
    expect(tally.spokenSummary).toBe(
      "Last call cost 12 cents. Total call cost this month: 62 cents. Lifetime call cost: $1.40.",
    );
  });

  it("spoken summary handles empty tally", () => {
    expect(
      buildSpokenCallCostSummary({
        lastCallCostUsd: null,
        monthUsd: 0,
        lifetimeUsd: 0,
        callCountLifetime: 0,
      }),
    ).toBe("No phone call costs recorded yet.");
  });

  it("exposes last-call VAPI/TTS/STT/LLM breakdown and high-TTS tip", () => {
    const now = new Date(2026, 7, 11, 15, 0, 0);
    const tally = aggregateCallCostTally(
      [
        {
          costUsd: 0.2,
          startedAt: new Date(2026, 7, 11, 10, 0, 0),
          endedAt: new Date(2026, 7, 11, 10, 2, 0),
          durationSeconds: 120,
          providerCallSid: "call_tts",
          costBreakdown: {
            stt: 0.02,
            llm: 0.03,
            tts: 0.12,
            vapi: 0.03,
            total: 0.2,
          },
        },
      ],
      now,
    );
    expect(tally.lastCallBreakdown?.tts).toBe(0.12);
    expect(tally.lastCallBreakdown?.stt).toBe(0.02);
    expect(tally.lastCallBreakdown?.llm).toBe(0.03);
    expect(tally.lastCallBreakdown?.vapi).toBe(0.03);
    expect(tally.lastCallBreakdown?.ttsShare).toBeGreaterThan(0.45);
    expect(tally.highTtsTip).toMatch(/Standard voice/i);
  });
});
