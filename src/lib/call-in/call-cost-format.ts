/**
 * Pure VAPI call-cost helpers (safe for client components).
 * Cost amounts from VAPI are USD (end-of-call-report `cost` / call.cost).
 */

export type ParsedVapiCallCost = {
  callId: string | null;
  costUsd: number | null;
  durationSeconds: number | null;
  endedReason: string | null;
  summary: string | null;
  fromPhone: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  costBreakdown: Record<string, unknown> | null;
  costSource: "vapi_webhook" | "vapi_api" | null;
};

export type CallCostRow = {
  costUsd: number;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  providerCallSid: string | null;
  costBreakdown?: Record<string, unknown> | null;
};

export type CallCostLineItems = {
  stt: number | null;
  llm: number | null;
  tts: number | null;
  vapi: number | null;
  total: number | null;
  /** TTS / total when both known (0–1). */
  ttsShare: number | null;
};

export type CallCostTally = {
  lastCallCostUsd: number | null;
  lastCallDurationSeconds: number | null;
  lastCallId: string | null;
  lastCallAt: string | null;
  lastCallBreakdown: CallCostLineItems | null;
  /** Soft tip when last call TTS share was high. */
  highTtsTip: string | null;
  todayUsd: number;
  monthUsd: number;
  lifetimeUsd: number;
  callCountLifetime: number;
  currency: "USD";
  /** Screen-reader friendly summary, e.g. "Last call cost 12 cents. Total call cost this month: $1.40." */
  spokenSummary: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Extract cost/duration from a VAPI webhook message (or GET /call body). */
export function parseVapiCallCost(payload: unknown): ParsedVapiCallCost {
  const root = asRecord(payload) ?? {};
  const message = asRecord(root.message) ?? root;
  const call = asRecord(message.call) ?? asRecord(root.call) ?? {};
  const customer = asRecord(call.customer) ?? {};

  const costUsd =
    asNumber(message.cost) ??
    asNumber(call.cost) ??
    asNumber(asRecord(message.costBreakdown)?.total) ??
    asNumber(asRecord(call.costBreakdown)?.total);

  const durationSeconds =
    asNumber(message.durationSeconds) ??
    asNumber(call.durationSeconds) ??
    (asNumber(message.durationMs) != null
      ? (asNumber(message.durationMs) as number) / 1000
      : null) ??
    (asNumber(call.durationMs) != null
      ? (asNumber(call.durationMs) as number) / 1000
      : null) ??
    (asNumber(message.durationMinutes) != null
      ? (asNumber(message.durationMinutes) as number) * 60
      : null);

  const breakdown =
    asRecord(message.costBreakdown) ?? asRecord(call.costBreakdown);

  return {
    callId: asString(call.id) ?? asString(message.callId) ?? asString(root.id),
    costUsd,
    durationSeconds,
    endedReason:
      asString(message.endedReason) ?? asString(call.endedReason) ?? null,
    summary:
      asString(message.summary) ??
      asString(asRecord(message.analysis)?.summary) ??
      null,
    fromPhone:
      asString(customer.number) ??
      asString(asRecord(message.customer)?.number) ??
      null,
    startedAt: asDate(message.startedAt) ?? asDate(call.startedAt),
    endedAt: asDate(message.endedAt) ?? asDate(call.endedAt),
    costBreakdown: breakdown,
    costSource: costUsd != null ? "vapi_webhook" : null,
  };
}

/** Format USD for patrons in plain language (cents under $1 when whole cents). */
export function formatUsdPlain(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) return "$0.00";
  if (amountUsd === 0) return "$0.00";

  const cents = Math.round(amountUsd * 100);
  if (cents > 0 && cents < 100 && Math.abs(amountUsd * 100 - cents) < 0.05) {
    return cents === 1 ? "1 cent" : `${cents} cents`;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amountUsd);
}

export function buildSpokenCallCostSummary(tally: {
  lastCallCostUsd: number | null;
  monthUsd: number;
  lifetimeUsd: number;
  callCountLifetime: number;
}): string {
  if (tally.callCountLifetime === 0 || tally.lastCallCostUsd == null) {
    return "No phone call costs recorded yet.";
  }
  const last = formatUsdPlain(tally.lastCallCostUsd);
  const month = formatUsdPlain(tally.monthUsd);
  const lifetime = formatUsdPlain(tally.lifetimeUsd);
  return `Last call cost ${last}. Total call cost this month: ${month}. Lifetime call cost: ${lifetime}.`;
}

/** Parse VAPI / STT / LLM / TTS line items from a costBreakdown object. */
export function parseCostBreakdownLines(
  breakdown: Record<string, unknown> | null | undefined,
): CallCostLineItems | null {
  if (!breakdown) return null;
  const stt =
    asNumber(breakdown.stt) ??
    asNumber(breakdown.transcriber) ??
    asNumber(asRecord(breakdown.transcriber)?.cost);
  const llm =
    asNumber(breakdown.llm) ??
    asNumber(breakdown.model) ??
    asNumber(asRecord(breakdown.model)?.cost);
  const tts =
    asNumber(breakdown.tts) ??
    asNumber(breakdown.voice) ??
    asNumber(asRecord(breakdown.voice)?.cost);
  const vapi =
    asNumber(breakdown.vapi) ??
    asNumber(breakdown.platform) ??
    asNumber(asRecord(breakdown.vapi)?.cost);
  const total =
    asNumber(breakdown.total) ??
    ([stt, llm, tts, vapi].every((n) => n == null)
      ? null
      : roundUsd(
          (stt ?? 0) + (llm ?? 0) + (tts ?? 0) + (vapi ?? 0),
        ));
  if (stt == null && llm == null && tts == null && vapi == null && total == null) {
    return null;
  }
  const ttsShare =
    tts != null && total != null && total > 0
      ? Math.round((tts / total) * 1000) / 1000
      : null;
  return { stt, llm, tts, vapi, total, ttsShare };
}

export function formatCostBreakdownSnippet(lines: CallCostLineItems): string {
  const bits: string[] = [];
  if (lines.vapi != null) bits.push(`VAPI ${formatUsdPlain(lines.vapi)}`);
  if (lines.tts != null) bits.push(`TTS ${formatUsdPlain(lines.tts)}`);
  if (lines.stt != null) bits.push(`STT ${formatUsdPlain(lines.stt)}`);
  if (lines.llm != null) bits.push(`LLM ${formatUsdPlain(lines.llm)}`);
  return bits.length ? bits.join(" · ") : "No line-item breakdown.";
}

/** Soft tip when TTS dominated last-call cost. */
export function highTtsCostTipFromBreakdown(
  lines: CallCostLineItems | null,
  tipRatio = 0.45,
): string | null {
  if (!lines || lines.ttsShare == null) return null;
  if (lines.ttsShare < tipRatio) return null;
  return "Switch to Standard voice to lower cost.";
}

function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfLocalMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Aggregate per-call rows into a running tally (tenant rows already filtered). */
export function aggregateCallCostTally(
  rows: CallCostRow[],
  now = new Date(),
): CallCostTally {
  const sorted = [...rows].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
  );
  const dayStart = startOfLocalDay(now).getTime();
  const monthStart = startOfLocalMonth(now).getTime();

  let todayUsd = 0;
  let monthUsd = 0;
  let lifetimeUsd = 0;

  for (const row of sorted) {
    const cost = row.costUsd;
    if (!Number.isFinite(cost) || cost < 0) continue;
    lifetimeUsd += cost;
    const t = row.startedAt.getTime();
    if (t >= monthStart) monthUsd += cost;
    if (t >= dayStart) todayUsd += cost;
  }

  const last = sorted[0] ?? null;
  const lastBreakdown = last
    ? parseCostBreakdownLines(last.costBreakdown ?? null)
    : null;
  const tally: CallCostTally = {
    lastCallCostUsd: last ? last.costUsd : null,
    lastCallDurationSeconds: last?.durationSeconds ?? null,
    lastCallId: last?.providerCallSid ?? null,
    lastCallAt:
      last?.endedAt?.toISOString() ?? last?.startedAt.toISOString() ?? null,
    lastCallBreakdown: lastBreakdown,
    highTtsTip: highTtsCostTipFromBreakdown(lastBreakdown),
    todayUsd: roundUsd(todayUsd),
    monthUsd: roundUsd(monthUsd),
    lifetimeUsd: roundUsd(lifetimeUsd),
    callCountLifetime: sorted.length,
    currency: "USD",
    spokenSummary: "",
  };
  tally.spokenSummary = buildSpokenCallCostSummary(tally);
  return tally;
}
