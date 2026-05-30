// functions/src/concierge/v2/retrievers.ts
// ─────────────────────────────────────────────────────────────────────────────
// Thin v2 wrappers over the existing v1 retriever functions. Each
// wrapper:
//   • Pins the v2 calling shape (positional + options) so the v2
//     orchestrator can evolve without reaching into v1 internals.
//   • Guarantees fail-soft semantics (returns [] on error, never throws).
//   • Drops the v1 router-flag plumbing the v2 orchestrator no longer
//     uses — branches in §2.1 call these unconditionally per their own
//     contract, no global gating.
//
// The actual Voyage embeds, Upstash queries, Firestore hydrations, and
// reranking all stay in the v1 implementation files. This file is
// indirection, not new logic — keeps v1 and v2 sharing the same
// expensive plumbing during the soak period.
// ─────────────────────────────────────────────────────────────────────────────

import {
  retrieveTastingNotes as v1RetrieveTastingNotes,
  formatTastingNotesForPrompt as v1FormatTastingNotes,
  type TastingNoteHit,
  type WineVectorMetadata,
} from "../tastingNotes";
import {
  retrieveKnowledge as v1RetrieveKnowledge,
  formatKnowledgeChunksForPrompt as v1FormatKnowledge,
  type KnowledgeChunk,
} from "../knowledgeRetrieve";
import {
  retrieveWinerySources as v1RetrieveWinerySources,
  formatWinerySourcesForPrompt as v1FormatWinerySources,
  defaultsForIntent as v1WinerySourcesDefaults,
  type WinerySourceHit,
} from "../winerySourcesRetrieve";

const IS_DEV = process.env.NODE_ENV !== "production";

// Re-export the hit types so v2 callers don't need to reach into v1
// modules. Lets us evolve the v2 contract independently later.
export type {
  TastingNoteHit,
  WineVectorMetadata,
  KnowledgeChunk,
  WinerySourceHit,
};

// ─── Tasting notes ────────────────────────────────────────────────────────

export interface TastingNotesOptions {
  /** Region to scope the search to. Always required. */
  regionId: string;
  /**
   * Owning wineries to filter by. Three modes per spec §2.1:
   *   • [singleSlug]   → WINERY_FOCUS scope.
   *   • [...candidates]→ TRIP scope (limit to the candidate slice).
   *   • undefined      → DISCOVERY whole-namespace search.
   *
   * Empty array is treated as `undefined` (whole namespace) — saves
   * the orchestrator a branch when its candidate list happens to be
   * empty. The v1 retriever already does this, but we re-document
   * here so the v2 contract is unambiguous.
   */
  wineryIds?: string[];
  /** Final number of notes returned. Defaults to 4. */
  topK?: number;
}

export async function retrieveTastingNotesV2(
  query: string,
  opts: TastingNotesOptions
): Promise<TastingNoteHit[]> {
  // Normalise [] → undefined so the v1 layer omits the IN-clause.
  const wineryIds =
    opts.wineryIds && opts.wineryIds.length > 0 ? opts.wineryIds : undefined;
  try {
    return await v1RetrieveTastingNotes(query, {
      regionId: opts.regionId,
      wineryIds,
      topK: opts.topK,
    });
  } catch (err) {
    if (IS_DEV) {
      console.warn(
        "[v2:tasting-notes] retrieval failed; returning empty:",
        err
      );
    }
    return [];
  }
}

export const formatTastingNotesV2 = v1FormatTastingNotes;

// ─── Knowledge base ───────────────────────────────────────────────────────

export interface KnowledgeOptions {
  regionId: string;
  /** Sub-region names (NOT the same as regionId). */
  regions?: string[];
  topK?: number;
}

export async function retrieveKnowledgeV2(
  query: string,
  opts: KnowledgeOptions
): Promise<KnowledgeChunk[]> {
  try {
    return await v1RetrieveKnowledge(query, {
      regionId: opts.regionId,
      regions: opts.regions,
      topK: opts.topK,
    });
  } catch (err) {
    if (IS_DEV) {
      console.warn("[v2:knowledge] retrieval failed; returning empty:", err);
    }
    return [];
  }
}

export const formatKnowledgeV2 = v1FormatKnowledge;

// ─── Winery sources ───────────────────────────────────────────────────────

export interface WinerySourcesOptions {
  regionId: string;
  /**
   * Wineries to pull source chunks for. Required — there is no
   * "whole namespace" mode for winery_sources in v2 (it would burn
   * rerank budget on irrelevant producers).
   */
  wineryIds: string[];
  topK?: number;
  maxPerWinery?: number;
}

export async function retrieveWinerySourcesV2(
  query: string,
  opts: WinerySourcesOptions
): Promise<WinerySourceHit[]> {
  if (opts.wineryIds.length === 0) return [];
  try {
    return await v1RetrieveWinerySources(query, {
      regionId: opts.regionId,
      wineryIds: opts.wineryIds,
      topK: opts.topK,
      maxPerWinery: opts.maxPerWinery,
    });
  } catch (err) {
    if (IS_DEV) {
      console.warn(
        "[v2:winery-sources] retrieval failed; returning empty:",
        err
      );
    }
    return [];
  }
}

export const formatWinerySourcesV2 = v1FormatWinerySources;

/**
 * Per-branch defaults for winery_sources retrieval. The v2 branches
 * (spec §2.1) only fire winery_sources on WINERY_FOCUS, so this is
 * almost always called with "WINERY_FOCUS". Kept as a function so the
 * orchestrator can hand-pick defaults per turn if it ever needs to.
 */
export function winerySourcesDefaults(
  branch: "WINERY_FOCUS" | "TRIP" | "DISCOVERY"
): { topK: number; maxPerWinery: number } {
  // The v1 defaults table is keyed by v1 intent names. Map v2 → v1.
  switch (branch) {
    case "WINERY_FOCUS":
      return v1WinerySourcesDefaults("specific_winery");
    case "TRIP":
      return v1WinerySourcesDefaults("itinerary");
    case "DISCOVERY":
    default:
      return v1WinerySourcesDefaults("regional");
  }
}
