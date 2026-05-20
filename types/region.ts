// types/region.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared region-config types — imported by both the client (RegionContext,
// screens) AND the Cloud Functions concierge (orchestrator, system-prompt
// builder). One source of truth so any schema drift would surface as a
// TypeScript error in both places at once.
//
// Backed by Firestore at `regions/{regionId}`. Each document corresponds to
// one supported wine region (Tasmania, Margaret River, …). The active
// region is picked by the user on first launch, persisted in AsyncStorage,
// and piped through every Firestore query and concierge request.
//
// PHILOSOPHY: keep this surface minimal. Anything that's truly per-region
// (display name, regional primer, sub-regions if any, picker prompts, map
// extent) lives here. Anything that's per-WINERY stays on the winery
// document. Anything that's universal (HARD_RULES, HOURS_RULE, DATASET_FORMAT
// etc. in the system prompt) stays as a const in the concierge code.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A wine sub-region within a parent region. Optional concept — Tasmania
 * has six (Tamar Valley, Pipers River, East Coast, Coal River Valley,
 * Derwent Valley, Huon Valley) and the prompt + UI lean on them heavily.
 * Other regions may be flat — one geographic area, no subdivision.
 *
 * When present, sub-regions drive:
 *   • Router output: `decision.regions` is constrained to these names.
 *   • Itinerary planning: "don't combine sub-regions >45 min apart".
 *   • User-location anchoring: nearest sub-region centroid → friendly label.
 *   • Neighbour expansion in retrieval: when a user asks about a winery in
 *     sub-region X, the candidate slice includes wineries from `adjacent`
 *     sub-regions too.
 *   • Filter UI: a chip row on the wineries screen.
 *
 * When `subRegions` is empty (flat region), every dependent path no-ops.
 */
export interface SubRegion {
  /** Human-readable sub-region name. Used in the prompt, the router's
   *  enum, the wineries-screen chip row, and the `<user_location>` block.
   *  Match the casing of the existing `wineries.region` field exactly —
   *  this is the value rows are joined on. */
  name: string;

  /** Centroid latitude — used to map a user's GPS coordinates to the
   *  nearest sub-region for the `<user_location>` prompt block. */
  lat: number;

  /** Centroid longitude. */
  lon: number;

  /** Other sub-region names within a short drive (~<45 min). Used for
   *  neighbour expansion in concierge retrieval so an itinerary turn
   *  about Tamar Valley can include nearby Pipers River wineries. */
  adjacent: string[];
}

/**
 * Map viewport — the initial camera position when the user opens the
 * wineries-screen map view. Shape matches `react-native-maps`' Region
 * type so it can be passed straight through.
 */
export interface RegionMapBounds {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/**
 * Full region configuration document. Read from `regions/{regionId}` once
 * per session on the client (cached in RegionContext) and once per cold
 * start per region on the server (cached at module scope per regionId).
 */
export interface RegionConfig {
  /** Slug matching the Firestore doc id (e.g. "tasmania", "margaret-river").
   *  Lowercase, kebab-case. This is the SAME value that appears in the
   *  `regionId` field on every wineries/premade_trips/pour_articles/etc.
   *  document, and in every concierge request body. */
  regionId: string;

  /** Mixed-case display name shown in UI copy (e.g. "Tasmania"). */
  displayName: string;

  /** All-caps variant for the editorial label style (e.g. "TASMANIA").
   *  Precomputed so screens don't repeat `.toUpperCase()` calls. */
  displayNameUpper: string;

  /** Sentence substituted into the system prompt's BRAND_VOICE block.
   *  Example (Tasmania):
   *    "the in-app concierge for SipLocal, an editorial wine-tourism guide
   *     to Tasmania."
   *  Example (Margaret River):
   *    "the in-app concierge for SipLocal, an editorial wine-tourism guide
   *     to Margaret River."
   *  Should read as a self-contained clause — the prompt template wraps
   *  it without adding punctuation. */
  brandVoiceLine: string;

  /** Long-form markdown injected into the system prompt as the
   *  "## Regional primer" block. Describes the region's character,
   *  sub-regions (if any), drive times, and any region-specific texture
   *  the sommelier should reference. Authored per-region by you. */
  regionalPrimer: string;

  /** Optional. Tasmania has six sub-regions; other regions may be flat.
   *  See SubRegion docstring for what's gated on this field's presence.
   *  Treat missing and [] as equivalent — every dependent code path must
   *  short-circuit cleanly on empty. */
  subRegions?: SubRegion[];

  /** Empty-state prompt chips shown in the concierge modal before the
   *  user has asked anything. 3 entries is the established pattern. */
  suggestedPrompts: string[];

  /** Optional editorial headline shown on the home screen / region picker.
   *  Falls back to a generic if absent. */
  homeHeadline?: string;

  /** Initial camera position for the wineries-screen map view. Replaces
   *  the per-region hardcoded constants that previously lived in
   *  app/(tabs)/wineries/index.tsx. */
  mapBounds: RegionMapBounds;

  /** Optional override for the system prompt's itinerary-discipline rule
   *  (currently a hardcoded paragraph in HARD_RULES about not combining
   *  sub-regions more than ~45 min apart). Three behaviours:
   *    • undefined  — use the legacy Tasmanian wording (back-compat).
   *    • "<text>"   — use this verbatim in place of the legacy text.
   *    • ""         — omit the rule entirely (small/flat regions).
   *  Templating the rule (rather than putting it in regionalPrimer) keeps
   *  it inside HARD_RULES, which the model treats as more authoritative. */
  itineraryDisciplineRule?: string;

  /** Schema version. Bump when the shape changes so older clients can
   *  detect a mismatch and either upgrade or fall back gracefully. */
  schemaVersion: number;
}

/** Compact descriptor used by the region picker — pulled from the regions
 *  collection without fetching the full config payload. */
export interface RegionSummary {
  regionId: string;
  displayName: string;
}
