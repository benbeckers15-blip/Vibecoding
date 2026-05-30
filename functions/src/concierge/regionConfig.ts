// functions/src/concierge/regionConfig.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side loader for per-region config from Firestore (regions/{regionId}).
//
// Why this file mirrors types/region.ts in shape (and doesn't import from it):
//   The client code lives at /types/region.ts; the functions tsconfig has
//   "rootDir": "./src" so it can't reach out of `functions/src` for imports.
//   Rather than restructure the monorepo, we keep the type definition in
//   sync by hand. The shape is tiny and rarely changes, and any drift
//   would manifest at runtime as a missing field — easy to catch in test.
//
// Cache strategy:
//   • Module-scope Map<regionId, Promise<RegionConfig>>.
//   • Cloud Functions warm starts share this across requests, so once a
//     region is loaded it stays loaded for the life of the container.
//   • Caches the IN-FLIGHT promise (not just the result) so two concurrent
//     requests on a cold container share a single Firestore round-trip.
//   • A failed load clears its cache entry so the next request retries
//     (rather than serving the same error forever).
//
// Validation:
//   Loose. The loader returns whatever is in the doc, typed as RegionConfig.
//   If a required field is missing the downstream code will fail loudly
//   (e.g. an undefined regionalPrimer becomes an empty string in the
//   prompt). We don't do schema validation here because (a) the data
//   layer is owned by us and seeded by scripts, and (b) Firestore client
//   doesn't have a JSON-schema validator built in.
// ─────────────────────────────────────────────────────────────────────────────

import { getFirestore } from "firebase-admin/firestore";

// ─── Types (mirror of client types/region.ts) ────────────────────────────────

export interface SubRegion {
  name: string;
  lat: number;
  lon: number;
  adjacent: string[];
}

export interface RegionMapBounds {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface RegionConfig {
  regionId: string;
  displayName: string;
  displayNameUpper: string;
  brandVoiceLine: string;
  regionalPrimer: string;
  /** Optional. Empty/absent = flat region (no sub-regions). */
  subRegions?: SubRegion[];
  suggestedPrompts: string[];
  homeHeadline?: string;
  mapBounds: RegionMapBounds;
  /** Optional override for the system prompt's itinerary-discipline rule.
   *  undefined → use legacy Tasmanian wording (back-compat).
   *  ""        → omit the rule entirely.
   *  "<text>"  → use verbatim. */
  itineraryDisciplineRule?: string;
  /** Demonym adjective (e.g. "Tasmanian"). Used in TASK_AND_SCOPE and
   *  HARD_RULES wherever the prompt previously said "Tasmanian X".
   *  Falls back to `displayName` when absent. */
  regionAdjective?: string;
  /** Geographic noun (e.g. "island", "valley", "region"). Used in
   *  STYLE_NOTES and HARD_RULES wherever the prompt previously said
   *  "the island". Falls back to "region" when absent. */
  geographyNoun?: string;
  /** Curated sub-region names to surface in STYLE_NOTES. Falls back to
   *  `subRegions.map(s => s.name)`. Empty array → omit the bullet. */
  promptSubRegions?: string[];
  /** IANA timezone identifier for the region (e.g. "Australia/Hobart").
   *  Used to compute "today" for the user — both in the cached world
   *  index ("today:open→5pm" hints per winery) and in the per-turn
   *  `<today>` tag. Without this the server falls back to UTC, which is
   *  ~10 hours behind Tasmania and a full day off for users in their
   *  morning. Optional in the type for back-compat with older docs;
   *  missing → UTC + warning log. Set on every region doc. */
  timezone?: string;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

interface CachedRegion {
  /** In-flight or resolved promise. Concurrent cold-start requests
   *  share this so a single Firestore round-trip serves them all. */
  promise: Promise<RegionConfig>;
  /** Wall-clock time the load was kicked off — used for TTL. We stamp
   *  at kick-off (not at resolve) so a slow load doesn't extend its
   *  own TTL. */
  loadedAt: number;
}

const _cache = new Map<string, CachedRegion>();

// TTL for the region-config cache. Default 15 minutes; same default as
// the corpus cache (see orchestrator.ts), and overridden by the same
// CONCIERGE_CACHE_TTL_MS env var. Without this, an edit to the
// `regions/{regionId}` doc (regional primer, brand voice line,
// sub-regions, picker prompts) wouldn't reach the concierge until the
// Cloud Run container was recycled — could be hours under steady
// traffic. With the TTL, edits propagate within a quarter-hour.
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_TTL_MS =
  Number(process.env.CONCIERGE_CACHE_TTL_MS) || DEFAULT_CACHE_TTL_MS;

/**
 * Load a region's config doc. Cached at module scope with a bounded
 * TTL — subsequent calls within the TTL window are free; calls after
 * the window re-read Firestore so edits propagate without a redeploy.
 * Concurrent cold-start requests share the in-flight promise.
 *
 * Throws if regions/{regionId} doesn't exist. The HTTP handler converts
 * this into a 400 with a clear error message — better than serving a
 * concierge response with a half-formed system prompt.
 */
export async function getRegionConfig(regionId: string): Promise<RegionConfig> {
  const now = Date.now();
  const entry = _cache.get(regionId);
  if (entry && now - entry.loadedAt < CACHE_TTL_MS) {
    return entry.promise;
  }

  const promise = (async () => {
    const db = getFirestore();
    const snap = await db.collection("regions").doc(regionId).get();
    if (!snap.exists) {
      throw new Error(
        `Unknown regionId="${regionId}" — no regions/${regionId} document in Firestore.`
      );
    }
    const data = snap.data() as Omit<RegionConfig, "regionId">;
    return { regionId, ...data };
  })();

  // Stamp + store BEFORE awaiting so concurrent requests reuse the
  // in-flight load.
  _cache.set(regionId, { promise, loadedAt: now });

  // On failure: drop ONLY if our entry is still the latest. Another
  // request may have already replaced it with a successful retry, and
  // we don't want to evict that one.
  promise.catch(() => {
    const current = _cache.get(regionId);
    if (current?.promise === promise) {
      _cache.delete(regionId);
    }
  });

  return promise;
}

// ─── Helpers derived from RegionConfig.subRegions ───────────────────────────
// These replace the hardcoded TASMANIA_REGIONS / REGION_CENTROIDS /
// ADJACENT_REGIONS constants. Each is a pure function of the region config,
// so the orchestrator and router can rebuild them per-request at zero cost.

/** Sub-region names as a plain string[] — used by the router's tool schema
 *  and the wineries-filter UI on the client. Returns `[]` for flat regions. */
export function subRegionNames(region: RegionConfig): string[] {
  return (region.subRegions ?? []).map((s) => s.name);
}

/** Adjacency map: { "Tamar Valley": ["Pipers River"], ... }. Empty for
 *  flat regions or for regions whose sub-regions have empty adjacent[]. */
export function buildAdjacencyMap(
  region: RegionConfig
): Record<string, readonly string[]> {
  const map: Record<string, readonly string[]> = {};
  for (const s of region.subRegions ?? []) {
    if (s.adjacent && s.adjacent.length > 0) {
      map[s.name] = [...s.adjacent];
    }
  }
  return map;
}

/** Centroid list for nearestRegion() — finds the sub-region closest to
 *  a user's GPS coordinates. Returns `[]` for flat regions, in which case
 *  the caller should skip the "nearest sub-region" pipeline entirely. */
export function buildCentroidList(
  region: RegionConfig
): { name: string; lat: number; lon: number }[] {
  return (region.subRegions ?? []).map((s) => ({
    name: s.name,
    lat: s.lat,
    lon: s.lon,
  }));
}
