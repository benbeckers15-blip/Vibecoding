// services/concierge/costTracker.ts
// ─────────────────────────────────────────────────────────────────────────────
// Per-turn token + USD cost accounting for the concierge.
//
// Every concierge turn makes UP TO THREE OpenAI calls:
//
//   1. Coreference resolver (gpt-5.4-nano by default)  — rewrites referential
//      follow-ups. Skipped on the first turn when there's no history.
//      Override via EXPO_PUBLIC_OPENAI_RESOLVER_MODEL.
//   2. Router (gpt-5.4-mini by default)                — classifies the question.
//      Override via EXPO_PUBLIC_OPENAI_ROUTER_MODEL.
//   3. Response model (gpt-5.4 by default)             — produces the reply.
//      Override via EXPO_PUBLIC_OPENAI_MODEL.
//
// OpenAI's usage shape:
//   • prompt_tokens                                       — total input tokens
//   • completion_tokens                                   — generated reply tokens
//                                                           (INCLUDES reasoning_tokens
//                                                           on the gpt-5.x family —
//                                                           do not add them on top)
//   • prompt_tokens_details.cached_tokens (optional)      — subset of prompt_tokens
//                                                           that hit the cache
//   • completion_tokens_details.reasoning_tokens (opt.)   — surfaced for debugging
//                                                           on gpt-5.x; already
//                                                           billed inside completion
//
// OpenAI caches transparently: there is no `cache_control` knob and no
// "cache write" charge — fresh input is just the regular input rate,
// cached input is heavily discounted (≈10% of fresh on nano/mini/base,
// ≈25% on gpt-5.4-pro). So we price three buckets:
//
//   freshInput  = prompt_tokens - cached_tokens   → input rate
//   cachedInput = cached_tokens                   → cachedInput rate
//   output      = completion_tokens               → output rate
//
// LONG-CONTEXT SURCHARGE (gpt-5.4 and gpt-5.4-pro only):
//   When prompt_tokens > 272,000, OpenAI bills 2× input/cached-input and
//   1.5× output for the ENTIRE call. We apply that multiplier here.
//   gpt-5.4-mini and gpt-5.4-nano are NOT subject to the surcharge — their
//   context windows top out below the threshold.
//
// DATED SNAPSHOTS:
//   Model strings like "gpt-5.4-2026-05-19" or "gpt-5.4-mini-2026-04-01"
//   are normalised back to their family (gpt-5.4 / gpt-5.4-mini) for
//   pricing lookup. New base SKUs (e.g. gpt-5.4-pro) need explicit
//   entries in PRICING.
//
// We retain the `cacheWrite` field on the breakdown (always 0) so the UI
// layer (components/ConciergeChat.tsx) can keep its existing column
// without a refactor.
//
// Source: https://openai.com/api/pricing/  +  https://developers.openai.com/api/docs/pricing
// Last reviewed: 2026-05-19
// ─────────────────────────────────────────────────────────────────────────────

// Raw shape of `response.usage` as returned by the OpenAI SDK.
export interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    // Reasoning tokens are already counted inside completion_tokens for
    // the gpt-5.x family — surfaced here only for debugging / display.
    reasoning_tokens?: number;
  };
}

// Per-bucket prices in USD per **1 million tokens**.
interface ModelPricing {
  input: number;       // fresh (uncached) input
  cachedInput: number; // cached input (heavily discounted on OpenAI)
  cacheWrite: number;  // always 0 on OpenAI — no write surcharge
  output: number;      // generated output
  // If true, prompts over LONG_CONTEXT_THRESHOLD get the long-context
  // surcharge (2× input/cached-input, 1.5× output). Only base SKUs with
  // >=1M-token context windows opt in.
  longContextSurcharge?: boolean;
}

// Pricing table for the gpt-5.4 family. Add new models here as you adopt
// them. Defaults to gpt-5.4-mini if the model string is unrecognised —
// better to show an estimated cost than nothing at all.
//
// Source: https://openai.com/api/pricing/
// Last reviewed: 2026-05-19.
const PRICING: Record<string, ModelPricing> = {
  // Cheapest tier. Used by the coreference resolver.
  "gpt-5.4-nano": {
    input: 0.20,
    cachedInput: 0.02,
    cacheWrite: 0,
    output: 1.25,
    longContextSurcharge: false,
  },
  // Mid tier. Used by the router.
  "gpt-5.4-mini": {
    input: 0.75,
    cachedInput: 0.075,
    cacheWrite: 0,
    output: 4.50,
    longContextSurcharge: false,
  },
  // Full-size base model. Used by the responder. Subject to the
  // long-context surcharge over 272K prompt tokens.
  "gpt-5.4": {
    input: 2.50,
    cachedInput: 0.25,
    cacheWrite: 0,
    output: 15.00,
    longContextSurcharge: true,
  },
  // Reasoning-heavy variant. Not currently called from the codebase, but
  // priced here so a future EXPO_PUBLIC_OPENAI_MODEL=gpt-5.4-pro flip
  // works without code changes. Cached-input is ~25% of fresh (not 10%)
  // for the pro tier. Output price is the publicly-listed figure as of
  // 2026-05; double-check before flipping production traffic to it.
  "gpt-5.4-pro": {
    input: 5.00,
    cachedInput: 1.25,
    cacheWrite: 0,
    output: 40.00,
    longContextSurcharge: true,
  },
};

const FALLBACK_MODEL = "gpt-5.4-mini";

// Prompts strictly larger than this many input tokens trip the
// long-context surcharge on eligible base SKUs (see above). 272K is the
// boundary OpenAI documents.
const LONG_CONTEXT_THRESHOLD = 272_000;
const LONG_CONTEXT_INPUT_MULTIPLIER = 2.0;
const LONG_CONTEXT_OUTPUT_MULTIPLIER = 1.5;

// `cacheWriteTTL` is no longer meaningful on OpenAI (no write surcharge),
// but we keep the type around so the public API in this module stays
// stable for callers and the UI layer.
export type CacheWriteTTL = "ephemeral_5m" | "ephemeral_1h";

// What we surface to the rest of the app. Field names are kept stable so
// the chat UI doesn't need to change — `cacheWriteTokens` is always 0 on
// OpenAI, and `cacheReadTokens` carries the cached_tokens count.
export interface CostBreakdown {
  // Token counters.
  inputTokens: number;       // fresh (uncached) input portion of prompt_tokens
  outputTokens: number;      // completion_tokens (INCLUDES reasoning)
  reasoningTokens: number;   // subset of outputTokens spent on reasoning, for display
  cacheWriteTokens: number;  // always 0 on OpenAI
  cacheReadTokens: number;   // prompt_tokens_details.cached_tokens
  // Convenience: total tokens flowing through this call.
  totalTokens: number;
  // True iff the long-context surcharge was applied to this call.
  longContextSurchargeApplied: boolean;
  // USD cost broken down so you can see WHERE the money went.
  usd: {
    input: number;
    output: number;
    cacheWrite: number; // always 0
    cacheRead: number;
    total: number;
  };
  // Echoed for debugging. Reflects the NORMALISED model id used to look
  // up pricing (dated snapshots collapse to their family).
  model: string;
}

// A whole turn (resolver + router + response) rolled up.
export interface TurnCost {
  total: CostBreakdown;
  parts: Array<{ label: string; breakdown: CostBreakdown }>;
}

/**
 * Strip a dated snapshot suffix off a model string so we can look it up
 * in PRICING.
 *
 *   "gpt-5.4-2026-05-19"        → "gpt-5.4"
 *   "gpt-5.4-mini-2026-04-01"   → "gpt-5.4-mini"
 *   "gpt-5.4-nano"              → "gpt-5.4-nano"
 *   "gpt-5.4-pro-2026-03-10"    → "gpt-5.4-pro"
 *
 * Falls back to the original string if it doesn't match the YYYY-MM-DD
 * suffix pattern, so non-standard names hit the FALLBACK_MODEL branch
 * inside priceUsage rather than silently mis-pricing.
 */
function normaliseModel(model: string): string {
  // Strip a trailing `-YYYY-MM-DD` from the model id.
  const datedSnapshot = /^(.+)-\d{4}-\d{2}-\d{2}$/.exec(model);
  if (datedSnapshot && datedSnapshot[1] in PRICING) {
    return datedSnapshot[1];
  }
  return model;
}

/**
 * Price a single OpenAI `usage` object.
 *
 * The `cacheWriteTTL` argument is accepted for API compatibility with
 * the previous Anthropic implementation but has no effect — OpenAI does
 * not charge a write surcharge for cache population.
 */
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
  // `cached_tokens` is reported as a subset of prompt_tokens. Clamp
  // defensively in case the SDK ever reports more cached than prompt.
  const cachedTokens = Math.min(
    promptTokens,
    Math.max(0, usage?.prompt_tokens_details?.cached_tokens ?? 0)
  );
  const freshInputTokens = Math.max(0, promptTokens - cachedTokens);

  // Long-context surcharge: applies to the ENTIRE call (all three
  // buckets) when prompt_tokens crosses the threshold on an eligible
  // SKU. Cached input is part of the input bucket, so it doubles too.
  const surchargeApplies =
    !!pricing.longContextSurcharge && promptTokens > LONG_CONTEXT_THRESHOLD;
  const inputMultiplier = surchargeApplies ? LONG_CONTEXT_INPUT_MULTIPLIER : 1;
  const outputMultiplier = surchargeApplies ? LONG_CONTEXT_OUTPUT_MULTIPLIER : 1;

  // Divide by 1M because rates are quoted per 1M tokens.
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
    // promptTokens + completionTokens; equivalent to
    // fresh + cached + completion, but written that way to make the
    // accounting obvious.
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

/**
 * Sum any number of CostBreakdowns into a single CostBreakdown. Used to
 * roll the resolver + router + response-model costs into one turn-level
 * total for the UI. The `model` field on the total is set to "combined"
 * so downstream code doesn't accidentally re-price it.
 */
export function combineBreakdowns(parts: CostBreakdown[]): CostBreakdown {
  return parts.reduce<CostBreakdown>(
    (acc, p) => ({
      inputTokens: acc.inputTokens + p.inputTokens,
      outputTokens: acc.outputTokens + p.outputTokens,
      reasoningTokens: acc.reasoningTokens + p.reasoningTokens,
      cacheWriteTokens: acc.cacheWriteTokens + p.cacheWriteTokens,
      cacheReadTokens: acc.cacheReadTokens + p.cacheReadTokens,
      totalTokens: acc.totalTokens + p.totalTokens,
      // Sticky: if any leg of the turn hit the surcharge, flag the total.
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

/** Convenience: build a TurnCost from labelled (label, usage, model) entries. */
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

// ─── Formatting helpers (used by UI) ─────────────────────────────────────────
// Sub-cent totals are common (cached turns often cost < $0.001), so we
// always show 4 decimal places. For longer sessions where things creep
// past a penny, that still reads sensibly.

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.0000";
  if (usd < 0.0001) return "<$0.0001";
  return `$${usd.toFixed(4)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
