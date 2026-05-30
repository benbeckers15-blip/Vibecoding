// functions/src/concierge/winerySourcesRetrieve.ts
// ─────────────────────────────────────────────────────────────────────────────
// Retrieval against the `winery_sources` Upstash namespace.
//
// The namespace holds ~514 per-section prose chunks per winery (see
// scripts/ingest-winery-sources.js for ingestion). Each vector's
// metadata carries the full chunk text — no Firestore hydration round-
// trip needed at retrieval time.
//
// PIPELINE (per turn that fires winery_sources retrieval):
//
//   1. Embed the user query with Voyage (`voyage-3-lite`, 512-dim,
//      `inputType: "query"` so it pairs correctly with the document-
//      side embeddings the ingest script wrote).
//   2. Query Upstash with hard filters:
//        regionId = '<region>'                ← always, multi-region scope
//        AND wineryId IN ('a', 'b', ...)      ← scopes to candidate wineries
//      Fetch wider than we'll return (top-15 by default) so the cross-
//      encoder reranker has signal to triage with.
//   3. Cross-encoder rerank with Voyage Rerank — same rerank.ts helper
//      we already use for knowledge + tasting notes. This is where the
//      sanity-check misses we saw on "unusual trellis system" and
//      "multi-generational family winery" get fixed: pure cosine
//      similarity gets close but a cross-encoder reads each chunk
//      jointly with the query and scores far more precisely.
//   4. Enforce a per-winery diversity cap — max N chunks per winery
//      in the final result set. Without this, a rich-coverage winery
//      can hog all the top slots and small/sparse-coverage wineries
//      get drowned out (the editorial-fairness concern raised earlier).
//      The cap is loosened on `specific_winery` turns (where the named
//      winery legitimately should dominate the slice).
//
// WHAT THIS DOES NOT DO:
//   • Source of truth for structured fields (hours, walk-ins,
//     dog-friendly, biodynamic, restaurant, tours, awards). Those live
//     on the Firestore winery doc and are already in the
//     <relevant_wineries> block. The source excerpts may mention them
//     in natural prose; the system prompt tells the model that the
//     structured fields win in any contradiction.
//   • Wine-level data. Tasting notes / specific bottles / vintages are
//     handled by the `wines` namespace (ingest-tasting-notes.js).
// ─────────────────────────────────────────────────────────────────────────────

import { Index } from "@upstash/vector";
import { VoyageAIClient } from "voyageai";
import { rerankDocuments } from "./rerank";

const IS_DEV = process.env.NODE_ENV !== "production";

const EMBED_MODEL = "voyage-3-lite";
const NAMESPACE = "winery_sources";

// Number of candidates we pull from Upstash before reranking. Wider
// than the final return so the cross-encoder reranker has room to
// re-sort. 15 is comfortable headroom for the rerank call's own
// token budget (each chunk averages ~250 tokens, so 15 × 250 = ~3.75K
// tokens — well under rerank-lite-1's per-request limit).
const VECTOR_FETCH_K = 15;

// Final cap on chunks returned. Defaults match the editorial design:
//   • specific_winery turns: return more chunks (5-8) — the named
//     winery is the focus, multiple sections (history + people +
//     site + cellar door) all serve the answer.
//   • Other intents (regional, feature, itinerary): keep tighter so
//     the model isn't drowning in prose; diversity-cap enforces
//     spread across wineries.
const DEFAULT_TOP_K_SPECIFIC = 5;
const DEFAULT_TOP_K_BROAD = 4;

// Per-winery cap inside the final result. Stops one rich-coverage
// winery from filling all the slots on a multi-winery turn.
//   • specific_winery: no cap (one winery is supposed to dominate)
//   • broad intents: 1-2 chunks per winery max
const DEFAULT_MAX_PER_WINERY_BROAD = 2;

// Minimum cosine score below which we discard the hit before reranking.
// Voyage embeddings on this corpus tend to land hits between 0.55 and
// 0.85; 0.35 is a loose floor that still drops totally-off-topic noise.
const DEFAULT_MIN_SCORE = 0.35;

// ─── Lazy clients ─────────────────────────────────────────────────────────────

let _voyage: VoyageAIClient | null = null;
let _index: Index | null = null;

function getVoyage(): VoyageAIClient {
  if (_voyage) return _voyage;
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOYAGE_API_KEY secret is not bound to this function."
    );
  }
  _voyage = new VoyageAIClient({ apiKey });
  return _voyage;
}

function getIndex(): Index {
  if (_index) return _index;
  const url = process.env.UPSTASH_VECTOR_URL;
  const token = process.env.UPSTASH_VECTOR_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_VECTOR_URL or UPSTASH_VECTOR_TOKEN secret is not bound to this function."
    );
  }
  _index = new Index({ url, token });
  return _index;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Per-vector metadata shape written by scripts/ingest-winery-sources.js.
 * Keep in sync — if the ingest script ever changes its metadata, this
 * interface needs the same change.
 */
export interface WinerySourceMetadata {
  wineryId: string;
  wineryName: string;
  region: string;
  regionId: string;
  section: string;
  sourcePath: string;
  text: string;
  wordCount: number;
  [key: string]: unknown;
}

export interface WinerySourceHit {
  wineryId: string;
  wineryName: string;
  region: string;
  section: string;
  text: string;
  score: number;
}

export interface WinerySourceOptions {
  /**
   * REQUIRED. Top-level region scope. Matches the `regionId` metadata
   * field on each vector. Prevents leakage between regions in a
   * multi-region future.
   */
  regionId: string;
  /**
   * Candidate winery slugs to scope retrieval to. Almost always the
   * output of orchestrator.retrieveCandidates — only wineries already
   * judged relevant by the filter/score pass get their source chunks
   * pulled. Empty array = no scoping (full namespace; rare, used only
   * for broad general queries where no candidates were identified).
   */
  wineryIds?: string[];
  /** Final chunk count to return. Defaults per intent. */
  topK?: number;
  /** Max chunks from the same winery in the result. Defaults per intent. */
  maxPerWinery?: number;
  /** Score floor before reranking. Defaults to 0.35. */
  minScore?: number;
}

// ─── Filter builder ───────────────────────────────────────────────────────────

function buildFilter(opts: WinerySourceOptions): string {
  const clauses: string[] = [];

  // Region scope is non-negotiable. Prevents Margaret River leakage
  // once a second region is ingested.
  clauses.push(`regionId = '${opts.regionId.replace(/'/g, "''")}'`);

  // Winery scope — if provided, only return chunks from these wineries.
  // Almost always supplied; skipped only for very broad general turns.
  if (opts.wineryIds && opts.wineryIds.length > 0) {
    const list = opts.wineryIds
      .map((id) => `'${id.replace(/'/g, "''")}'`)
      .join(", ");
    clauses.push(`wineryId IN (${list})`);
  }

  return clauses.join(" AND ");
}

// ─── Diversity cap ────────────────────────────────────────────────────────────

/**
 * Enforce a per-winery cap on the result list. Preserves rank order
 * (higher-ranked chunks survive). When a winery hits the cap, its
 * remaining chunks are dropped and the next-ranked chunk from another
 * winery slides into the slot.
 *
 * Without this, a rich-coverage winery with 8 strong chunks could
 * fill an entire top-5 result set, and small/sparse-coverage wineries
 * would never get airtime even on regional or feature turns where
 * editorial fairness matters.
 */
function diversifyByWinery<T extends { wineryId: string }>(
  hits: T[],
  maxPerWinery: number,
): T[] {
  if (maxPerWinery <= 0) return [];
  if (maxPerWinery >= hits.length) return hits;
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const h of hits) {
    const count = counts.get(h.wineryId) || 0;
    if (count >= maxPerWinery) continue;
    counts.set(h.wineryId, count + 1);
    out.push(h);
  }
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve top winery_sources chunks for a query.
 *
 * Fail-soft: if Voyage or Upstash misbehaves, returns [] rather than
 * throwing. The concierge keeps working on whatever other context it
 * has — losing source excerpts on one turn is a precision regression,
 * not an availability failure.
 */
export async function retrieveWinerySources(
  query: string,
  opts: WinerySourceOptions,
): Promise<WinerySourceHit[]> {
  // Don't even hit Upstash if there are no candidate wineries to scope
  // to. The orchestrator should pass a list; an empty list usually
  // means out_of_scope or some intent that shouldn't fire this anyway.
  if (opts.wineryIds && opts.wineryIds.length === 0) {
    return [];
  }

  const finalTopK = opts.topK ?? DEFAULT_TOP_K_BROAD;
  const maxPerWinery = opts.maxPerWinery ?? DEFAULT_MAX_PER_WINERY_BROAD;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  const fetchK = Math.max(VECTOR_FETCH_K, finalTopK * 4);

  try {
    const voyage = getVoyage();
    const embedResp = await voyage.embed({
      input: [query],
      model: EMBED_MODEL,
      inputType: "query",
    });
    const vector = embedResp?.data?.[0]?.embedding;
    if (!vector || !Array.isArray(vector)) {
      if (IS_DEV) {
        console.warn("[winery-sources] Voyage returned no embedding; skipping");
      }
      return [];
    }

    const ns = getIndex().namespace(NAMESPACE);
    const filter = buildFilter(opts);
    const results = await ns.query<WinerySourceMetadata>({
      vector,
      topK: fetchK,
      includeMetadata: true,
      filter,
    });

    const candidates: WinerySourceHit[] = results
      .filter((r) => r.score >= minScore && r.metadata)
      .map((r) => {
        const m = r.metadata as WinerySourceMetadata;
        return {
          wineryId: String(m.wineryId || ""),
          wineryName: String(m.wineryName || ""),
          region: String(m.region || ""),
          section: String(m.section || ""),
          text: String(m.text || ""),
          score: r.score,
        };
      });

    if (candidates.length === 0) return [];

    // Cross-encoder rerank. The document we hand the reranker prefixes
    // winery + section for context, mirroring the embedText shape used
    // at ingest time — gives the reranker the same signal both sides.
    const { items: reranked } = await rerankDocuments(
      query,
      candidates,
      (c) => `${c.wineryName} (${c.region}) — ${c.section}\n${c.text}`,
      // Rerank a bit wider than the final cut so diversifyByWinery
      // has room to enforce the per-winery cap without truncating
      // below finalTopK.
      Math.max(finalTopK * 2, 8),
      "winery-sources-rerank",
    );

    // Enforce per-winery diversity cap. For specific_winery callers
    // who want the named winery to dominate, they pass a very high
    // maxPerWinery; otherwise this is the editorial-fairness gate.
    const diversified = diversifyByWinery(reranked, maxPerWinery);

    return diversified.slice(0, finalTopK);
  } catch (err) {
    if (IS_DEV) {
      console.warn("[winery-sources] retrieval failed; returning empty:", err);
    }
    return [];
  }
}

// ─── Convenience: per-intent defaults ─────────────────────────────────────────

/**
 * Pick reasonable defaults for topK and maxPerWinery based on the
 * router's intent. Keeps the orchestrator from having to know these
 * tunings. Mirrors how DEFAULT_TOP_K_* and DEFAULT_MAX_PER_WINERY_BROAD
 * map to intents:
 *
 *   specific_winery → topK 5, no per-winery cap (one winery dominates)
 *   regional        → topK 4, max 1 per winery (spread across the region)
 *   feature         → topK 4, max 1 per winery (spread across feature hits)
 *   itinerary       → topK 5, max 2 per winery (a few wineries deeper)
 *   anything else   → topK 4, max 2 per winery
 */
export function defaultsForIntent(intent: string): { topK: number; maxPerWinery: number } {
  switch (intent) {
    case "specific_winery":
      // Effectively no cap — the named winery often has 5-8 chunks
      // and all are legitimately about the same producer.
      return { topK: DEFAULT_TOP_K_SPECIFIC, maxPerWinery: 99 };
    case "regional":
    case "feature":
      return { topK: DEFAULT_TOP_K_BROAD, maxPerWinery: 1 };
    case "itinerary":
      return { topK: DEFAULT_TOP_K_SPECIFIC, maxPerWinery: 2 };
    default:
      return { topK: DEFAULT_TOP_K_BROAD, maxPerWinery: 2 };
  }
}

// ─── Prompt formatting ────────────────────────────────────────────────────────

/**
 * Format retrieved chunks into the `<source_excerpts>` block that
 * lands in the per-turn user message. Mirrors the visual style of
 * <tasting_notes> and <knowledge_base>.
 *
 * The IMPORTANT inline reminder about Firestore-wins-for-structured-
 * fields lives both here AND in the cached system prompt. The system
 * prompt is the authoritative rule; this block reinforces it at the
 * point of use so the model can't miss it.
 *
 * Returns "" if there are no chunks, so the orchestrator's append-if-
 * truthy pattern naturally omits the block on empty turns.
 */
export function formatWinerySourcesForPrompt(hits: WinerySourceHit[]): string {
  if (hits.length === 0) return "";

  const blocks = hits.map((h) => {
    const header = h.region
      ? `=== ${h.wineryName} (${h.region}) — ${h.section} ===`
      : `=== ${h.wineryName} — ${h.section} ===`;
    return [header, h.text].join("\n");
  });

  return [
    "<source_excerpts>",
    "Editorial source material on the wineries below. Use this to ground",
    "answers about history, people, vineyard sites, cellar door experience,",
    "food, awards, sustainability, and distinctive character. Speak from",
    "these excerpts directly; do not invent details beyond what they say.",
    "",
    "IMPORTANT: Structured facts — hours, address, phone, walk-in vs",
    "by-appointment, dog-friendly, restaurant, organic, biodynamic,",
    "award-winning, tours — come from the <relevant_wineries> block",
    "above. That block is the source of truth for those fields. If a",
    "source excerpt below appears to contradict the structured tags,",
    "trust the structured tags.",
    "",
    ...blocks,
    "</source_excerpts>",
  ].join("\n");
}
