// functions/src/concierge/v2/wineriesFilter.ts
// ─────────────────────────────────────────────────────────────────────────────
// In-memory candidate selection for the DISCOVERY and TRIP branches.
// WINERY_FOCUS doesn't use this — it just loads the anchored winery
// directly from the corpus by slug.
//
// Replaces v1's `retrieveCandidates` (~200 lines) without the four
// patches that produced the audit bugs:
//   • NO neighbour expansion. WINERY_FOCUS already scopes to the
//     anchor only (spec §2.1). Pulling 8+ same-region + 3 adjacent
//     wineries into the candidate set then bleeding them into the
//     tasting-notes wineryIds filter was the Bangor-neighbour bug.
//   • NO router-fuzzy-fallback duplication. The nameIndex (called
//     by the router) is the only name-extraction path. If the router
//     misses, the orchestrator's WINERY_FOCUS branch is missed too —
//     and the DISCOVERY branch's filter logic is structural (region,
//     tag, day), not name-based, so a missed name doesn't break it.
//   • NO forced-protection cap. Without forced-include there's
//     nothing to protect.
//   • NO descriptions hydration. The disabled v1 code path is just
//     gone in v2; the system prompt's grounding rule covers what it
//     was trying to do.
//
// What's left is a clean filter + sort + cap pass over the in-memory
// corpus.
// ─────────────────────────────────────────────────────────────────────────────

import type { WineryDoc } from "../buildContext";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// Tag → boolean field on the WineryDoc. Same mapping as v1.
const TAG_TO_FIELD: Record<string, keyof WineryDoc> = {
  "dog-friendly": "dogFriendly",
  restaurant: "hasRestaurant",
  organic: "isOrganic",
  biodynamic: "isBiodynamic",
  "walk-ins": "walkinWelcome",
  "award-winning": "awardWinning",
  tours: "hasTours",
  featured: "featured",
};

export interface CandidateFilterOptions {
  /** Sub-region names to keep. Empty = no region constraint. */
  regions: string[];
  /** Boolean feature tags the winery must satisfy. Empty = no tag constraint. */
  tags: string[];
  /** Day-of-week the winery must NOT be closed on. null = no day check. */
  dayOfWeek: string | null;
  /** Maximum candidates to return. v2 default 8 for DISCOVERY, 12 for TRIP. */
  limit: number;
}

/**
 * Filter, sort, and cap the corpus.
 *
 * Filter pass: keep wineries whose region is in `regions` (or
 * `regions` is empty), whose boolean tags all pass, and which are
 * not explicitly closed on `dayOfWeek`.
 *
 * Sort pass: owner-controlled `boost` desc, then `rating` desc.
 * The orchestrator may further sort by drive-time after this (TRIP
 * branch + user location available).
 *
 * Cap pass: slice to `limit`.
 *
 * Fail-soft on empty result: returns a small fallback sampler
 * (featured + top-rated) so the model always has SOMETHING to
 * recommend rather than a hard "no matches" deflection. The model's
 * grounding rule will keep it from over-promising on these fallback
 * candidates.
 */
export function filterCandidates(
  corpus: WineryDoc[],
  opts: CandidateFilterOptions
): WineryDoc[] {
  // 1. Filter pass.
  const passed = corpus.filter((w) => {
    if (opts.regions.length > 0) {
      if (!w.region || !opts.regions.includes(w.region)) return false;
    }
    for (const tag of opts.tags) {
      const field = TAG_TO_FIELD[tag];
      if (field && !w[field]) return false;
    }
    if (opts.dayOfWeek && isExplicitlyClosedOn(w, opts.dayOfWeek)) {
      return false;
    }
    return true;
  });

  // 2. Sort.
  const sorted = passed.slice().sort((a, b) => {
    const bb = b.boost ?? 0;
    const ab = a.boost ?? 0;
    if (bb !== ab) return bb - ab;
    return (b.rating ?? 0) - (a.rating ?? 0);
  });

  // 3. Empty result → fallback sampler.
  if (sorted.length === 0) {
    return pickFallbackSampler(corpus, opts.limit);
  }

  // 4. Cap.
  return sorted.slice(0, Math.max(1, opts.limit));
}

/**
 * Check whether a winery is explicitly closed on a given day.
 * Conservative: returns false unless we have structured hours data
 * AND the day is marked Closed. An unknown day defaults to "not
 * explicitly closed" — better to surface and let the model hedge
 * than to silently drop a winery on a hours-data gap.
 *
 * Lifted from v1's isExplicitlyClosedOn — same semantics.
 */
function isExplicitlyClosedOn(w: WineryDoc, dayShort: string): boolean {
  if (!Array.isArray(w.hoursStructured)) return false;
  const want = dayShort.toLowerCase();

  let sawDay = false;
  let sawClosed = false;

  for (const entry of w.hoursStructured) {
    const label = String(entry?.day ?? "").toLowerCase();
    const time = String(entry?.time ?? "").toLowerCase();
    if (!label) continue;

    if (
      label.startsWith(want) ||
      label === "daily" ||
      label === "open daily" ||
      label === "every day"
    ) {
      sawDay = true;
      if (time === "closed") {
        sawClosed = true;
      } else {
        // Day explicitly listed as open — not closed.
        return false;
      }
    }
  }

  return sawDay && sawClosed;
}

/**
 * Fallback when zero candidates match the filter. Returns featured
 * wineries first, then top-rated, capped at `limit`. Same logic as
 * v1's `pickFallbackSampler` — kept identical so the v1→v2 cutover
 * doesn't introduce a behaviour change here.
 */
function pickFallbackSampler(corpus: WineryDoc[], limit: number): WineryDoc[] {
  if (corpus.length === 0) return [];
  const featured = corpus.filter((w) => w.featured);
  const rest = corpus
    .filter((w) => !w.featured)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  return [...featured, ...rest].slice(0, Math.max(1, limit));
}

// Re-export for tests / eval harness.
export const _internal = {
  isExplicitlyClosedOn,
  pickFallbackSampler,
  TAG_TO_FIELD,
  DAY_ORDER,
};
