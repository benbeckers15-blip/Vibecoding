// functions/src/concierge/rerank.ts
// ─────────────────────────────────────────────────────────────────────────────
// Voyage Rerank wrapper used by knowledgeRetrieve.ts and tastingNotes.ts.
//
// WHY THIS EXISTS:
//   Vector search (cosine over Voyage embeddings) is good at recall but
//   noisy at precision — the top-K results often include 1-2 chunks that
//   are tangentially related to the user's question but eat prompt
//   budget. Voyage's reranker is a cross-encoder that scores each
//   (query, document) pair jointly and re-orders them with much sharper
//   relevance signal. We fetch a wider candidate set from Upstash, then
//   keep only the rerank-topK that actually matter.
//
//   Net effect per turn:
//     • Tighter context for the response model (less noise = better
//       grounding AND lower fresh-input cost).
//     • Trivial extra latency (~50-150ms) since the rerank call runs
//       against a small candidate set.
//     • Trivial extra cost (~$0.0001/call at rerank-lite-1 pricing).
//
// FAIL-SOFT BEHAVIOUR:
//   Reranking is a precision boost, not a hard dependency. If Voyage's
//   rerank endpoint is down, the caller still has its vector-search
//   results — `rerankDocuments` catches and logs the error and returns
//   the original ordering. The user never sees a turn fail because the
//   reranker hiccuped.
// ─────────────────────────────────────────────────────────────────────────────

import { VoyageAIClient } from "voyageai";

const IS_DEV = process.env.NODE_ENV !== "production";

// Voyage offers `rerank-lite-1` (fast, cheap, ~$0.05/MTok) and
// `rerank-1` (slower, more accurate). For our chunk-level relevance
// scoring over short prose blocks, lite is plenty. Override via env if
// you want to A/B against the heavier model.
const RERANK_MODEL = process.env.VOYAGE_RERANK_MODEL || "rerank-lite-1";

let _voyage: VoyageAIClient | null = null;

function getVoyage(): VoyageAIClient {
  if (_voyage) return _voyage;
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOYAGE_API_KEY secret is not bound to this function. " +
        "Declare it in the function's `secrets:` option."
    );
  }
  _voyage = new VoyageAIClient({ apiKey });
  return _voyage;
}

export interface RerankResult<T> {
  /** The reranked items, in descending relevance order. Length ≤ topK. */
  items: T[];
  /** Whether the reranker actually ran (true) or we fell back to the
   *  original ordering due to an error (false). Surfaced for the caller
   *  to log so we can spot a degraded path in Langfuse. */
  reranked: boolean;
}

/**
 * Rerank a candidate list against a query, return the top-K most
 * relevant items in descending relevance order.
 *
 * Generic over T — the caller passes its own item type (KnowledgeChunk,
 * TastingNoteHit, etc.) along with an extractor that says how to turn
 * each item into the document string the reranker scores.
 *
 * Returns the original ordering (truncated to topK) on any error so a
 * Voyage outage degrades quality, not availability.
 */
export async function rerankDocuments<T>(
  query: string,
  items: T[],
  toDocument: (item: T) => string,
  topK: number,
  context: string = "rerank"
): Promise<RerankResult<T>> {
  // Trivial cases — no rerank call needed, no API cost incurred.
  if (items.length === 0) {
    return { items: [], reranked: false };
  }
  if (items.length <= topK) {
    // Already at or below the cap. Reranking would only RE-ORDER, not
    // trim — small precision gain, but probably not worth the latency
    // for ≤topK candidates. Caller can override if they care.
    return { items, reranked: false };
  }

  // Build the document array. Defensive: skip empty strings so we don't
  // confuse the reranker with blank documents.
  const documents: string[] = [];
  const originalIndices: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const doc = toDocument(items[i]);
    if (typeof doc === "string" && doc.trim().length > 0) {
      documents.push(doc);
      originalIndices.push(i);
    }
  }

  if (documents.length === 0) {
    return { items: items.slice(0, topK), reranked: false };
  }
  if (documents.length <= topK) {
    return {
      items: originalIndices.map((i) => items[i]),
      reranked: false,
    };
  }

  try {
    const voyage = getVoyage();
    const resp = await voyage.rerank({
      query,
      documents,
      model: RERANK_MODEL,
      topK,
    });

    const data = resp?.data ?? [];
    if (data.length === 0) {
      if (IS_DEV) {
        console.warn(`[${context}] rerank returned empty data, using vector order`);
      }
      return { items: items.slice(0, topK), reranked: false };
    }

    // Voyage returns items sorted by descending relevanceScore already.
    // Map each reranked entry back to the original item via the index it
    // returned — which points into the `documents` array we sent, not
    // into the original `items` array — so we double-hop through
    // `originalIndices`.
    const reranked: T[] = [];
    for (const entry of data) {
      const docIdx = entry?.index;
      if (typeof docIdx !== "number") continue;
      const itemIdx = originalIndices[docIdx];
      if (itemIdx === undefined) continue;
      reranked.push(items[itemIdx]);
      if (reranked.length >= topK) break;
    }

    if (reranked.length === 0) {
      // Shouldn't happen with a non-empty `data`, but guard anyway.
      return { items: items.slice(0, topK), reranked: false };
    }

    return { items: reranked, reranked: true };
  } catch (err) {
    // Fail-soft: log in DEV, return the original ordering truncated.
    if (IS_DEV) {
      console.warn(`[${context}] rerank failed, falling back to vector order:`, err);
    }
    return { items: items.slice(0, topK), reranked: false };
  }
}
