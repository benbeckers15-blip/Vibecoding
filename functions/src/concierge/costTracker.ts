// functions/src/concierge/costTracker.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side port of services/concierge/costTracker.ts.
// NO LOGIC CHANGES from the client version — pure pricing math, no external
// dependencies. Pricing table mirrored 1:1 with the client copy.
//
// Per-turn token + USD cost accounting for the concierge.
// ─────────────────────────────────────────────────────────────────────────────

export interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

interface ModelPricing {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  longContextSurcharge?: boolean;
}

const PRICING: Record<string, ModelPricing> = {
  "gpt-5.4-nano": {
    input: 0.20,
    cachedInput: 0.02,
    cacheWrite: 0,
    output: 1.25,
    longContextSurcharge: false,
  },
  "gpt-5.4-mini": {
    input: 0.75,
    cachedInput: 0.075,
    cacheWrite: 0,
    output: 4.50,
    longContextSurcharge: false,
  },
  "gpt-5.4": {
    input: 2.50,
    cachedInput: 0.25,
    cacheWrite: 0,
    output: 15.00,
    longContextSurcharge: true,
  },
  "gpt-5.4-pro": {
    input: 5.00,
    cachedInput: 1.25,
    cacheWrite: 0,
    output: 40.00,
    longContextSurcharge: true,
  },
  // ── Gemini family (Google AI Studio paid-tier pricing) ──────────────
  // Used by the response leg when LLM_PROVIDER=gemini (default after the
  // May 2026 migration). Router and resolver remain on OpenAI, so OpenAI
  // entries above stay live too. No long-context surcharge — Gemini's
  // 1M-token window is flat-priced up to the cap.
  //
  // Source: https://ai.google.dev/pricing (last reviewed 2026-05). The
  // thinking-mode tier (input $0.30 / output $2.50) is NOT priced here
  // because the orchestrator explicitly disables thinking via
  // thinkingConfig.thinkingBudget = 0 — we'd misprice every turn if we
  // used the thinking rates.
  "gemini-2.5-flash": {
    input: 0.075,
    cachedInput: 0.01875,
    cacheWrite: 0,
    output: 0.30,
    longContextSurcharge: false,
  },
  // Smaller / cheaper variant. Priced here so a future env-var flip can
  // A/B it without code changes. Slightly worse prose quality than full
  // Flash but ~half the cost.
  "gemini-2.5-flash-lite": {
    input: 0.04,
    cachedInput: 0.01,
    cacheWrite: 0,
    output: 0.15,
    longContextSurcharge: false,
  },
};

const FALLBACK_MODEL = "gpt-5.4-mini";
const LONG_CONTEXT_THRESHOLD = 272_000;
const LONG_CONTEXT_INPUT_MULTIPLIER = 2.0;
const LONG_CONTEXT_OUTPUT_MULTIPLIER = 1.5;

export type CacheWriteTTL = "ephemeral_5m" | "ephemeral_1h";

export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  longContextSurchargeApplied: boolean;
  usd: {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
    total: number;
  };
  model: string;
}

export interface TurnCost {
  total: CostBreakdown;
  parts: Array<{ label: string; breakdown: CostBreakdown }>;
}

function normaliseModel(model: string): string {
  const datedSnapshot = /^(.+)-\d{4}-\d{2}-\d{2}$/.exec(model);
  if (datedSnapshot && datedSnapshot[1] in PRICING) {
    return datedSnapshot[1];
  }
  return model;
}

export function priceUsage(
  usage: RawUsage | undefined | null,
  model: string,
  _cacheWriteTTL: CacheWriteTTL = "ephemeral_1h"
): CostBreakdown {
  const normalised = normaliseModel(model);
  const pricing = PRICING[normalised] || PRICING[FALLBACK_MODEL];
  const pricedModel = PRICING[normalised] ? normalised : FALLBACK_MODEL;

  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const reasoningTokens =
    usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const cachedTokens = Math.min(
    promptTokens,
    Math.max(0, usage?.prompt_tokens_details?.cached_tokens ?? 0)
  );
  const freshInputTokens = Math.max(0, promptTokens - cachedTokens);

  const surchargeApplies =
    !!pricing.longContextSurcharge && promptTokens > LONG_CONTEXT_THRESHOLD;
  const inputMultiplier = surchargeApplies ? LONG_CONTEXT_INPUT_MULTIPLIER : 1;
  const outputMultiplier = surchargeApplies ? LONG_CONTEXT_OUTPUT_MULTIPLIER : 1;

  const freshInputUsd =
    (freshInputTokens / 1_000_000) * pricing.input * inputMultiplier;
  const cachedInputUsd =
    (cachedTokens / 1_000_000) * pricing.cachedInput * inputMultiplier;
  const outputUsd =
    (completionTokens / 1_000_000) * pricing.output * outputMultiplier;

  return {
    inputTokens: freshInputTokens,
    outputTokens: completionTokens,
    reasoningTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: cachedTokens,
    totalTokens: freshInputTokens + cachedTokens + completionTokens,
    longContextSurchargeApplied: surchargeApplies,
    usd: {
      input: freshInputUsd,
      output: outputUsd,
      cacheWrite: 0,
      cacheRead: cachedInputUsd,
      total: freshInputUsd + outputUsd + cachedInputUsd,
    },
    model: pricedModel,
  };
}

export function combineBreakdowns(parts: CostBreakdown[]): CostBreakdown {
  return parts.reduce<CostBreakdown>(
    (acc, p) => ({
      inputTokens: acc.inputTokens + p.inputTokens,
      outputTokens: acc.outputTokens + p.outputTokens,
      reasoningTokens: acc.reasoningTokens + p.reasoningTokens,
      cacheWriteTokens: acc.cacheWriteTokens + p.cacheWriteTokens,
      cacheReadTokens: acc.cacheReadTokens + p.cacheReadTokens,
      totalTokens: acc.totalTokens + p.totalTokens,
      longContextSurchargeApplied:
        acc.longContextSurchargeApplied || p.longContextSurchargeApplied,
      usd: {
        input: acc.usd.input + p.usd.input,
        output: acc.usd.output + p.usd.output,
        cacheWrite: acc.usd.cacheWrite + p.usd.cacheWrite,
        cacheRead: acc.usd.cacheRead + p.usd.cacheRead,
        total: acc.usd.total + p.usd.total,
      },
      model: "combined",
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      longContextSurchargeApplied: false,
      usd: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
      model: "combined",
    }
  );
}

export function buildTurnCost(
  entries: Array<{ label: string; usage: RawUsage | undefined | null; model: string }>
): TurnCost {
  const parts = entries.map((e) => ({
    label: e.label,
    breakdown: priceUsage(e.usage, e.model),
  }));
  const total = combineBreakdowns(parts.map((p) => p.breakdown));
  return { total, parts };
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.0000";
  if (usd < 0.0001) return "<$0.0001";
  return `$${usd.toFixed(4)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
