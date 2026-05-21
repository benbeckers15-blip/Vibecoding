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
  schemaVersion: number;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const _cache = new Map<string, Promise<RegionConfig>>();

/**
 * Load a region's config doc. Cached at module scope, so subsequent calls
 * on a warm container are free. Concurrent cold-start requests share the
 * in-flight promise.
 *
 * Throws if regions/{regionId} doesn't exist. The HTTP handler converts
 * this into a 400 with a clear error message — better than serving a
 * concierge response with a half-formed system prompt.
 */
export async function getRegionConfig(regionId: string): Promise<RegionConfig> {
  let p = _cache.get(regionId);
  if (!p) {
    p = (async () => {
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
    // On failure, drop the cache entry so the next request retries
    // rather than serving the same error forever.
    p.catch(() => {
      _cache.delete(regionId);
    });
    _cache.set(regionId, p);
  }
  return p;
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
