// functions/src/concierge/geminiResponse.ts
// ─────────────────────────────────────────────────────────────────────────────
// Gemini 2.5 Flash response-leg wrapper for the orchestrator.
//
// HISTORY:
//   • May 2026: Migrated response leg from OpenAI gpt-5.4-mini to
//     Gemini 2.5 Flash. ~7-10× cheaper input, ~15× cheaper output, no
//     measurable quality regression after prompt tightening (see
//     systemPrompt.ts for the Gemini-specific anti-formatting rule and
//     strengthened by-appointment rule that landed at the same time).
//   • Router and resolver remain on OpenAI — they're structured tool
//     calls / tiny rewrites where the OpenAI mini/nano tier is already
//     cost-competitive with Gemini and migration risk wouldn't pay off.
//   • Set LLM_PROVIDER=openai to roll back the response leg to OpenAI
//     without a code change. See orchestrator.ts for the switch.
//
// WHY THINKING IS DISABLED:
//   Gemini 2.5 Flash has internal reasoning ("thinking") enabled by
//   default. Thinking tokens count against `maxOutputTokens` but aren't
//   returned in the visible response — so a 350-token cap could burn
//   320 tokens on hidden reasoning and truncate the actual prose to
//   30 tokens. We explicitly set thinkingConfig.thinkingBudget = 0 to
//   make the cap mean what it says. The harness in
//   scripts/concierge/ab-test-providers.js discovered this the hard
//   way — 12 of 23 first-run responses got truncated to short stubs.
//
// PROVIDER PARITY:
//   Returns the same shape the OpenAI path's caller expects:
//     • text: full assistant reply (post-stream)
//     • usage: prompt/completion/cached counts in OpenAI's RawUsage
//       format so costTracker.priceUsage() can bill it directly
//     • finishReason: normalised to lowercase strings matching OpenAI
//       (stop, length, content_filter, etc.) for downstream branching
//   onDelta is invoked for every text fragment as it arrives so the
//   SSE streamer in index.ts can pipe them straight to the chat UI.
// ─────────────────────────────────────────────────────────────────────────────

import { GoogleGenAI } from "@google/genai";
import type { RawUsage } from "./costTracker";

const IS_DEV = process.env.NODE_ENV !== "production";

// Default response model when LLM_PROVIDER=gemini. Override via the
// GEMINI_MODEL env var to A/B Flash Lite or a future Gemini release
// without a redeploy of code. (You still need to redeploy the function
// for an env-var change to take effect — Cloud Run revisions snapshot
// env at deploy time.)
export const GEMINI_RESPONSE_MODEL =
  process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Singleton client. Same lazy-init pattern as getOpenAI() in the
// orchestrator. Throws a clear error at first use if the secret isn't
// bound — better than a runtime 401 the SSE error handler would mask.
let _gemini: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (_gemini) return _gemini;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY secret is not bound to this function. " +
        "Declare it in the function's `secrets:` option in index.ts AND " +
        "run `firebase functions:secrets:set GEMINI_API_KEY` to populate it."
    );
  }
  _gemini = new GoogleGenAI({ apiKey });
  return _gemini;
}

/**
 * Convert OpenAI-style chat messages into the
 * (systemInstruction, contents) shape Gemini wants.
 *
 * The orchestrator builds an OpenAI-style messages array:
 *   [
 *     { role: "system", content: "<cached system prompt>" },
 *     { role: "user", content: "<turn 1>" },
 *     { role: "assistant", content: "<reply 1>" },
 *     { role: "user", content: "<current turn>" },
 *   ]
 *
 * Gemini wants:
 *   systemInstruction: "<cached system prompt>"
 *   contents: [
 *     { role: "user",  parts: [{ text: "<turn 1>" }] },
 *     { role: "model", parts: [{ text: "<reply 1>" }] },
 *     { role: "user",  parts: [{ text: "<current turn>" }] },
 *   ]
 *
 * Two role-mapping rules to remember:
 *   • OpenAI "system"    → Gemini systemInstruction (separate field)
 *   • OpenAI "assistant" → Gemini "model"           (different label)
 */
interface OpenAIStyleMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function toGeminiPayload(
  messages: OpenAIStyleMessage[]
): { systemInstruction: string; contents: Array<{ role: string; parts: Array<{ text: string }> }> } {
  let systemInstruction = "";
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      // If the caller passes multiple system messages, concatenate. The
      // orchestrator only ever passes one, but a defensive concat keeps
      // this function honest in case that ever changes.
      systemInstruction = systemInstruction
        ? `${systemInstruction}\n\n${m.content}`
        : m.content;
      continue;
    }
    const role = m.role === "assistant" ? "model" : "user";
    contents.push({ role, parts: [{ text: m.content }] });
  }
  return { systemInstruction, contents };
}

/**
 * Normalise Gemini's finish-reason enum strings to lowercase OpenAI-
 * style values so downstream code (trimToCompleteSentence, Langfuse
 * tagging) doesn't need a Gemini-specific branch.
 *
 * Mapping:
 *   STOP             → stop
 *   MAX_TOKENS       → length
 *   SAFETY           → content_filter
 *   RECITATION       → content_filter
 *   anything else    → passthrough lowercased
 */
function normaliseFinishReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const r = String(reason).toUpperCase();
  if (r === "STOP") return "stop";
  if (r === "MAX_TOKENS") return "length";
  if (r === "SAFETY" || r === "RECITATION") return "content_filter";
  return r.toLowerCase();
}

export interface GeminiStreamResult {
  text: string;
  usage: RawUsage;
  finishReason: string | null;
  model: string;
}

export interface GeminiStreamOptions {
  messages: OpenAIStyleMessage[];
  maxTokens: number;
  temperature?: number;
  onDelta: (delta: string) => void;
}

/**
 * Stream a single response from Gemini, piping every text fragment to
 * onDelta as it arrives. Resolves when the stream ends with the full
 * reply, normalised usage counts, and a normalised finish reason.
 *
 * Thinking is forcibly disabled — see file header for rationale.
 *
 * Errors bubble up to the caller (orchestrator), which is responsible
 * for surfacing them on the SSE `error` event. We do NOT swallow them
 * here; a Gemini outage should surface to the user as a clean error
 * message, not a silent empty reply.
 */
export async function streamGeminiResponse(
  opts: GeminiStreamOptions
): Promise<GeminiStreamResult> {
  const ai = getGemini();
  const { systemInstruction, contents } = toGeminiPayload(opts.messages);

  const stream = await ai.models.generateContentStream({
    model: GEMINI_RESPONSE_MODEL,
    contents,
    config: {
      systemInstruction,
      maxOutputTokens: opts.maxTokens,
      temperature: opts.temperature ?? 0.7,
      // CRITICAL: see file header. Without this, Gemini 2.5 Flash burns
      // the maxOutputTokens budget on hidden reasoning and the visible
      // reply gets truncated.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  // Accumulate full text for the response (in addition to streaming
  // each delta). The orchestrator needs the final string for
  // post-processing (parseTripProposal, parseWineryCards,
  // trimToCompleteSentence).
  let fullText = "";
  let lastUsage:
    | {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
      }
    | undefined;
  let lastFinishReason: string | null = null;

  // Gemini's SDK streams an async iterable of partial responses. Each
  // chunk carries:
  //   • .text — the new text fragment (sometimes empty on metadata-only chunks)
  //   • .usageMetadata — present on the last chunk (or a few chunks);
  //                       latest wins for total accounting
  //   • .candidates[0].finishReason — present when generation stops
  for await (const chunk of stream) {
    // The SDK exposes .text as a getter on the chunk. Be defensive in
    // case a chunk is metadata-only with no text payload.
    const delta =
      typeof (chunk as { text?: string }).text === "string"
        ? (chunk as { text?: string }).text || ""
        : "";
    if (delta) {
      fullText += delta;
      try {
        opts.onDelta(delta);
      } catch (err) {
        if (IS_DEV) {
          console.warn("[concierge] gemini onDelta threw:", err);
        }
      }
    }
    if (chunk.usageMetadata) {
      lastUsage = chunk.usageMetadata;
    }
    const finishOnChunk = chunk.candidates?.[0]?.finishReason;
    if (finishOnChunk) {
      lastFinishReason = String(finishOnChunk);
    }
  }

  // Translate Gemini usage into the OpenAI-style RawUsage shape so
  // costTracker.priceUsage() can bill it directly. promptTokenCount
  // includes cachedContentTokenCount (per Gemini docs); we mirror
  // OpenAI's convention where prompt_tokens is the total and
  // cached_tokens is a SUBSET.
  const promptTokens = lastUsage?.promptTokenCount ?? 0;
  const cachedTokens = Math.min(
    promptTokens,
    Math.max(0, lastUsage?.cachedContentTokenCount ?? 0)
  );
  const completionTokens = lastUsage?.candidatesTokenCount ?? 0;

  const usage: RawUsage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    prompt_tokens_details: { cached_tokens: cachedTokens },
  };

  return {
    text: fullText,
    usage,
    finishReason: normaliseFinishReason(lastFinishReason),
    model: GEMINI_RESPONSE_MODEL,
  };
}
