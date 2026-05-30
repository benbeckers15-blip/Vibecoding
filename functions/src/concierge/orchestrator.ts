// functions/src/concierge/orchestrator.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side port of the Concierge class from services/concierge/concierge.ts.
//
// ARCHITECTURAL CHANGES FROM THE CLIENT VERSION:
//   • Stateless per-call. The client held an instance with mutable history;
//     the server is called fresh each turn and history is sent in the
//     request body. (That's how a stateless HTTPS function HAS to work —
//     instances can be torn down between requests, and concurrent requests
//     share the process.)
//   • Context (winery corpus + slug map + world index) is cached at module
//     scope with an in-flight Promise so concurrent cold-start requests
//     share a single Firestore load.
//   • OpenAI client is also a lazy module-level singleton — same instance
//     for every request that lands on a warm container.
//   • `expo/fetch` import is gone; Node 22's global fetch handles streaming
//     response bodies natively.
//
// ALL prompt content, routing logic, retrieval pipeline, streaming filter,
// trimming logic, and per-turn message shape are unchanged from the client.
// The model sees the same payload it has been tuned against.
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from "openai";
import { Langfuse } from "langfuse";
import {
  compactWinery,
  loadContext,
  renderWineryFull,
  renderWorldIndex,
  type WineryDoc,
} from "./buildContext";
import {
  buildTurnCost,
  type RawUsage,
  type TurnCost,
} from "./costTracker";
// `hydrateDescriptions` (from ./retrieve) is intentionally NOT imported.
// The Upstash `descriptions` index doesn't currently store description
// text in vector metadata (see scripts/embed-wineries.js — metadata is
// filter fields only), so every hydration call returned hits with
// `text: null` and `descriptionChunk` was never populated on any
// candidate. The Voyage embed + Upstash query were pure waste. To
// re-enable: (1) update embed-wineries.js to include `description` in
// metadata, (2) re-run the embed script, (3) reinstate the hydration
// block in retrieveCandidates below.
import {
  retrieveTastingNotes,
  formatTastingNotesForPrompt,
  type TastingNoteHit,
} from "./tastingNotes";
import {
  retrieveKnowledge,
  formatKnowledgeChunksForPrompt,
  type KnowledgeChunk,
} from "./knowledgeRetrieve";
import {
  retrieveWinerySources,
  formatWinerySourcesForPrompt,
  defaultsForIntent as winerySourcesDefaultsForIntent,
  type WinerySourceHit,
} from "./winerySourcesRetrieve";
import { resolveCoreference } from "./resolveCoreference";
import { routeQuery, type RouteDecision, type RouteIntent } from "./router";
import { streamGeminiResponse, GEMINI_RESPONSE_MODEL } from "./geminiResponse";
import { sortByDriveTime } from "./driveTimes";
import { buildSystemPrompt } from "./systemPrompt";
import {
  buildAdjacencyMap,
  buildCentroidList,
  getRegionConfig,
  type RegionConfig,
} from "./regionConfig";
import {
  TRIP_PLAN_OPEN,
  WINERY_CARD_OPEN,
  WINERY_CARD_PREFIX_LOWER,
  parseTripProposal,
  parseWineryCards,
  trimToCompleteSentence,
  type TripProposal,
  type WineryCardSuggestion,
} from "./parsers";

const IS_DEV = process.env.NODE_ENV !== "production";

// ── Tunables ────────────────────────────────────────────────────────────────
// Same defaults the client used. The MODEL is the OpenAI base SKU for the
// response leg; the resolver and router use their own model IDs (set in
// their respective files).

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

// Provider switch for the response leg ONLY. Router and resolver
// continue to use OpenAI — they're structured/tiny calls where the
// mini/nano tier already costs pennies per turn and migration would
// not pay off.
//
// Default: gemini (rolled out May 2026 for ~10× cost reduction on
// the response leg, which carries ~92% of per-turn LLM spend).
// Rollback: redeploy with `LLM_PROVIDER=openai` set in the function's
// environment to flip back to gpt-5.4-mini without any code change.
// The OpenAI response path stays compiled into the bundle precisely
// so this rollback is one env-var flip away.
type ResponseProvider = "openai" | "gemini";
const RESPONSE_PROVIDER: ResponseProvider =
  (process.env.LLM_PROVIDER || "gemini").toLowerCase() === "openai"
    ? "openai"
    : "gemini";

// Output-token caps tiered by router intent. Replaces a single 550 cap
// that was paying for sprawl on factual turns and simultaneously
// truncating itinerary trip plans (see audit P1 — model could hit the
// cap mid-`<<TRIP_PLAN>>{...}` block, leaving `parseTripProposal` to
// silently drop the Start-Trip card). Tightening factual intents
// trims output spend; bumping itinerary closes the truncation bug.
//
// Headroom rule of thumb: leave ~30-80 tokens above expected prose
// length for the trailing `<<TRIP_PLAN>>` / `<<WINERY_CARD>>` JSON
// blocks the model appends. trimToCompleteSentence handles partial
// truncation gracefully when the prose itself overruns.
const MAX_TOKENS_BY_INTENT: Record<RouteIntent, number> = {
  specific_winery: 350,  // hours lookups + "tell me about X"; possible winery card
  feature: 300,          // tag-filter queries, list-style
  regional: 400,         // multi-winery prose recommendation
  itinerary: 650,        // multi-stop prose + trip plan tail (bumped from 550)
  general: 400,          // open-ended discovery
  out_of_scope: 150,     // polite deflection only; no markers
};
const MAX_TOKENS_FALLBACK = 400;

function maxTokensForIntent(intent: RouteIntent): number {
  return MAX_TOKENS_BY_INTENT[intent] ?? MAX_TOKENS_FALLBACK;
}

const MAX_HISTORY_TURNS = 4;

// ── Types ───────────────────────────────────────────────────────────────────

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface AskResult {
  reply: string;
  usage?: unknown;
  stopReason?: string | null;
  routerDecision?: RouteDecision;
  candidateCount?: number;
  cost: TurnCost;
  proposal?: TripProposal | null;
  wineryCards?: WineryCardSuggestion | null;
  /** History the SERVER built (with the new turns appended) — the client
   *  should replace its local copy with this so the next request includes
   *  the canonical trimmed history. */
  history: ChatMessage[];
}

// ─── Module-level singletons ────────────────────────────────────────────────
// Cloud Functions warm starts share these across requests.
//
// Multi-region: the corpus cache is keyed by regionId. A warm container
// that has served Tasmania once won't pay the Firestore round-trip on
// subsequent Tasmania requests; if it later serves a different region,
// that region's corpus loads on first request and then stays warm too.
//
// World-index cache is SEPARATE and keyed by `${regionId}:${todayShort}`.
// Why split? The world index contains a `today:open→5pm`-style hint per
// winery, derived from `new Date()`. When this lived inside the corpus
// cache, warm containers kept serving yesterday's day across midnight
// — silently wrong "is X open today?" answers for hours each morning.
// Splitting lets the corpus stay cached forever while the index
// recomputes the moment the day rolls over in the region's timezone.
//
// Bounded staleness: the corpus cache also has a TTL (CACHE_TTL_MS).
// Without it, a winery edit (hours, description, tags) in Firestore
// wouldn't reach the concierge until the Cloud Run container was
// recycled — could be hours under steady traffic. With a 15-min TTL,
// edits propagate within a quarter-hour without a redeploy. Cost is
// trivial: each container does ~1 extra Firestore read per region
// per 15 min. When the corpus reloads, we also evict the derived
// world-index entries so the model never sees a row that references
// a winery the corpus no longer has.

interface ConciergeContext {
  wineries: WineryDoc[];
  bySlug: Map<string, WineryDoc>;
}

interface CachedContext {
  /** In-flight or resolved promise. Stored as a promise (not a value)
   *  so concurrent cold-start requests share a single Firestore round-
   *  trip rather than racing to issue duplicate reads. */
  promise: Promise<ConciergeContext>;
  /** Wall-clock time the load was kicked off — used for TTL comparison.
   *  We don't wait for the promise to resolve before stamping it; that
   *  way a slow load doesn't extend its own TTL. */
  loadedAt: number;
}

const _contextByRegion = new Map<string, CachedContext>();
const _worldIndexByKey = new Map<string, string>();
let _openai: OpenAI | null = null;

// TTL for the corpus cache. Default 15 minutes. Override via
// CONCIERGE_CACHE_TTL_MS — set to a low value in local dev to iterate
// on Firestore content quickly. The same env var also drives the
// region-config cache TTL in regionConfig.ts.
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_TTL_MS =
  Number(process.env.CONCIERGE_CACHE_TTL_MS) || DEFAULT_CACHE_TTL_MS;

// Langfuse client is OPTIONAL. If the LANGFUSE_* secrets aren't bound, this
// returns null and every tracing call in orchestrateTurn is short-circuited
// by optional chaining. The concierge keeps working — you just don't get
// observability for those turns. That lets you deploy / run locally without
// Langfuse configured.
let _langfuse: Langfuse | null = null;
let _langfuseChecked = false;

function getLangfuse(): Langfuse | null {
  if (_langfuseChecked) return _langfuse;
  _langfuseChecked = true;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    // Log unconditionally — Cloud Functions runs as production, so the
    // previous IS_DEV gate hid this exact diagnostic in deployed traffic.
    console.warn(
      "[concierge] LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set — tracing disabled."
    );
    return null;
  }
  // Langfuse Cloud hosts:
  //   • https://cloud.langfuse.com         → EU (the original/default host)
  //   • https://us.cloud.langfuse.com      → US
  // We default to EU because that matches the SDK's own default; override via
  // the LANGFUSE_BASEURL secret if your project is on US or self-hosted.
  const baseUrl = process.env.LANGFUSE_BASEURL || "https://cloud.langfuse.com";
  // One-line boot log so the function log makes it obvious which Langfuse
  // host this container is talking to (US vs EU vs self-hosted). Public
  // key prefix only — secret key is never logged.
  console.info(
    `[concierge] Langfuse initialized → ${baseUrl} (pk: ${publicKey.slice(0, 10)}…)`
  );
  _langfuse = new Langfuse({
    publicKey,
    secretKey,
    baseUrl,
    // Flush quickly in the serverless model — we don't want events to sit
    // in a buffer past the lifetime of a single Cloud Function invocation.
    flushAt: 1,
    flushInterval: 1000,
    // Release tag = the Cloud Run revision name (e.g. "concierge-00007-pet").
    // Cloud Run injects this as `K_REVISION` on every container, so a
    // regression after a deploy can be traced back to the exact revision
    // that introduced it. Override via LANGFUSE_RELEASE if you want to
    // tag traces with a git SHA or a semver string instead.
    release: process.env.LANGFUSE_RELEASE || process.env.K_REVISION || undefined,
  });
  // Permanent: surface SDK-level errors that flushAsync() otherwise
  // swallows. The SDK logs internally at a level Cloud Run doesn't
  // capture by default; this hook promotes any error event to a real
  // stderr line so we see it in Cloud Logging. Auth failures (wrong
  // secret key, key/project mismatch, expired key) show up here as
  // 401s — without this listener the dashboard would silently look
  // empty even though `flushAsync()` reports success, which is exactly
  // how we got bitten the first time we set this up. Worth keeping.
  _langfuse.on("error", (err) => {
    console.error("[concierge] Langfuse SDK error event:", err);
  });
  return _langfuse;
}

async function getContext(regionId: string): Promise<ConciergeContext> {
  const now = Date.now();
  const entry = _contextByRegion.get(regionId);

  // Fresh hit. Concurrent requests during an in-flight load share the
  // same promise — `set` happens BEFORE the load completes (see below).
  if (entry && now - entry.loadedAt < CACHE_TTL_MS) {
    return entry.promise;
  }

  // Expired or absent. Drop derived world-index entries first — they
  // were built from the old corpus and may reference wineries that
  // have since been added, removed, or had their fields edited.
  for (const key of _worldIndexByKey.keys()) {
    if (key.startsWith(`${regionId}:`)) {
      _worldIndexByKey.delete(key);
    }
  }

  const promise = (async () => {
    const { wineries } = await loadContext(regionId);
    const bySlug = new Map<string, WineryDoc>();
    for (const w of wineries) {
      bySlug.set(w.slug || w.id, w);
    }
    return { wineries, bySlug };
  })();

  // Stamp + store BEFORE awaiting so concurrent requests reuse this
  // promise instead of issuing duplicate Firestore reads.
  _contextByRegion.set(regionId, { promise, loadedAt: now });

  // On failure: drop ONLY if our entry is still the latest — another
  // request may have already replaced it with a successful retry.
  promise.catch(() => {
    const current = _contextByRegion.get(regionId);
    if (current?.promise === promise) {
      _contextByRegion.delete(regionId);
    }
  });

  return promise;
}

/**
 * Return the cached world-index string for a region on a given day.
 *
 * Cache key is `${regionId}:${todayShort}` — so a warm container that
 * served Tasmania on Mon → Sun in the same calendar week ends up with at
 * most 7 entries per region (trivial memory). When the day rolls over in
 * the region's timezone, the next turn computes a fresh string and the
 * model sees the right "today:" hints.
 *
 * Synchronous: no IO. `renderWorldIndex` is a pure string concat over
 * the already-loaded corpus.
 */
function getWorldIndex(
  regionId: string,
  wineries: WineryDoc[],
  todayShort: string
): string {
  const key = `${regionId}:${todayShort}`;
  let s = _worldIndexByKey.get(key);
  if (s !== undefined) return s;
  s = renderWorldIndex(wineries, todayShort);
  _worldIndexByKey.set(key, s);
  return s;
}

// ─── Timezone-aware "today" helpers ─────────────────────────────────────────
// Cloud Functions runs in UTC by default. For a Tasmanian user at 8am AEST
// (UTC+10) that's 10pm UTC the PREVIOUS day — server `new Date().getDay()`
// would return Monday when the user means Tuesday. We anchor "today" to the
// region's timezone instead, using Intl.DateTimeFormat (Node 22 has full
// ICU). en-US's `weekday: "short"` returns exactly "Mon"|"Tue"|…|"Sun" —
// the same format the rest of the codebase uses for day-of-week keys.

function todayShortInTimezone(timezone: string | undefined): string {
  const tz = timezone || "UTC";
  if (!timezone) {
    // Surface this loudly — a missing region timezone re-introduces the
    // bug this helper exists to fix. Log unconditionally (production
    // included) so a fresh region doc without the field is obvious in
    // Cloud Logging the first time it serves a turn.
    console.warn(
      "[concierge] region timezone not configured — falling back to UTC. " +
        "Set `timezone` on regions/{regionId} (e.g. 'Australia/Hobart')."
    );
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: tz,
    }).format(new Date());
  } catch (err) {
    // Bad/unknown timezone string. Fall back to UTC. Better wrong day
    // than a crash.
    console.warn(
      `[concierge] invalid timezone "${tz}" — falling back to UTC:`,
      err
    );
    return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
      new Date()
    );
  }
}

function todayLongInTimezone(timezone: string | undefined): string {
  const tz = timezone || "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: tz,
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(
      new Date()
    );
  }
}

function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY secret is not bound to this function. " +
        "Declare it in the function's `secrets:` option."
    );
  }
  _openai = new OpenAI({ apiKey });
  return _openai;
}

// ─── Helper: extract OpenAI usage into our RawUsage shape ───────────────────

function extractUsage(
  rawUsage: OpenAI.Completions.CompletionUsage | undefined
): RawUsage | undefined {
  if (!rawUsage) return undefined;
  return {
    prompt_tokens: rawUsage.prompt_tokens,
    completion_tokens: rawUsage.completion_tokens,
    prompt_tokens_details: {
      cached_tokens:
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rawUsage as any).prompt_tokens_details?.cached_tokens,
    },
  };
}

// ─── Module-level retrieval helpers (lifted from client Concierge class) ────

const ROUTER_TAG_TO_FIELD: Record<string, keyof WineryDoc> = {
  "dog-friendly": "dogFriendly",
  restaurant: "hasRestaurant",
  organic: "isOrganic",
  biodynamic: "isBiodynamic",
  "walk-ins": "walkinWelcome",
  "award-winning": "awardWinning",
  tours: "hasTours",
  featured: "featured",
};

const FULL_DETAIL_SLICE_THRESHOLD = 5;

// Intents for which the editorial knowledge base (regional history, food
// culture, etiquette, seasons, etc.) is worth retrieving. Specific-
// winery, feature, and out-of-scope turns don't benefit from prose
// chunks — they're factual lookups, filter queries, and deflections
// respectively — so we skip the Voyage embed + Upstash query + Firestore
// getAll + ~1K tokens of fresh prompt input on those turns.
//
// Module-scope so we don't allocate a Set per turn.
const INTENTS_NEEDING_KNOWLEDGE: ReadonlySet<RouteIntent> = new Set([
  "general",
  "regional",
  "itinerary",
]);

// Intents that benefit from per-winery source-grounded prose chunks
// (founder names, vineyard details, distinctive character) pulled from
// the `winery_sources` Upstash namespace. Skipped on `general` and
// `out_of_scope`:
//   • general — open-ended curiosity (e.g. "why is Tasmania good for
//     sparkling?") doesn't reference any specific winery, so there's
//     no candidate list to scope source retrieval to. The knowledge
//     namespace covers these.
//   • out_of_scope — short polite deflection, no winery context needed.
//
// Module-scope ReadonlySet so we don't allocate per turn.
const INTENTS_NEEDING_WINERY_SOURCES: ReadonlySet<RouteIntent> = new Set([
  "specific_winery",
  "regional",
  "feature",
  "itinerary",
]);

function renderDetailBlock(candidates: WineryDoc[]): string {
  if (candidates.length === 0) return "";
  if (candidates.length <= FULL_DETAIL_SLICE_THRESHOLD) {
    return candidates.map(renderWineryFull).join("\n\n");
  }
  return candidates.map(compactWinery).join("\n");
}

// Adjacency map + centroid list used to live as hardcoded constants here.
// They now derive from `RegionConfig.subRegions` per request (cheap — just
// map/filter calls over the loaded region doc). See regionConfig.ts.

function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Map a user's GPS coordinates to the nearest sub-region centroid.
 * Returns null for flat regions (no centroids) — the caller should
 * fall back to a region-display-name string.
 */
function nearestRegion(
  lat: number,
  lon: number,
  centroids: { name: string; lat: number; lon: number }[]
): string | null {
  if (centroids.length === 0) return null;
  let best = centroids[0];
  let bestDist = haversineKm(lat, lon, best.lat, best.lon);
  for (const c of centroids.slice(1)) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best.name;
}

const NEARBY_REQUEST_RE =
  /\b(?:nearby|near\s+(?:me|us|here)|close\s+(?:to\s+(?:me|us)|by)|closest|nearest|around\s+(?:here|me|us)|in\s+my\s+(?:area|vicinity)|from\s+(?:here|my\s+(?:current\s+)?location|where\s+(?:i|we)['’]?\s*(?:m|re|am|are)))\b/i;

function shouldUseUserLocation(
  userMessage: string,
  decision: RouteDecision
): boolean {
  if (decision.intent === "itinerary") return true;
  if (NEARBY_REQUEST_RE.test(userMessage)) return true;
  return false;
}

function isExplicitlyClosedOn(w: WineryDoc, dayShort: string): boolean {
  if (!Array.isArray(w.hoursStructured)) return false;
  const want = dayShort.toLowerCase();
  let sawDay = false;
  let sawClosed = false;
  for (const entry of w.hoursStructured) {
    const label = String(entry?.day || "").toLowerCase();
    const time = String(entry?.time || "").toLowerCase();
    if (!label) continue;
    if (label.startsWith(want) || label === "daily" ||
        label === "open daily" || label === "every day") {
      sawDay = true;
      if (time === "closed") sawClosed = true;
      else return false;
    }
  }
  return sawDay && sawClosed;
}

function pickFallbackSampler(wineries: WineryDoc[], limit: number): WineryDoc[] {
  if (wineries.length === 0) return [];
  const featured = wineries.filter((w) => w.featured);
  const rest = wineries
    .filter((w) => !w.featured)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));
  return [...featured, ...rest].slice(0, Math.max(1, limit));
}

function buildTurnContent(
  userMessage: string,
  wineryBlock: string,
  tastingNotesBlock: string,
  knowledgeBlock: string,
  sourceExcerptsBlock: string,
  userLocation: { latitude: number; longitude: number } | null,
  regionConfig: RegionConfig,
  centroids: { name: string; lat: number; lon: number }[],
  todayLong: string
): string {
  const parts: string[] = [];
  // `todayLong` is the full weekday name ("Monday", "Tuesday", …) in
  // the region's timezone — computed once per turn in orchestrateTurn
  // and passed in so this function stays a pure string builder.
  parts.push(`<today>${todayLong}</today>`);
  if (userLocation) {
    const subRegion = nearestRegion(
      userLocation.latitude,
      userLocation.longitude,
      centroids
    );
    // For regions with sub-regions, anchor to the nearest one. For flat
    // regions (no centroids), just name the region.
    const locationDesc = subRegion
      ? `near the ${subRegion} area of ${regionConfig.displayName}`
      : `in ${regionConfig.displayName}`;
    parts.push(
      `<user_location>User is currently ${locationDesc}.</user_location>`
    );
  }
  if (wineryBlock) {
    parts.push(`<relevant_wineries>\n${wineryBlock}\n</relevant_wineries>`);
  }
  if (tastingNotesBlock) parts.push(tastingNotesBlock);
  if (knowledgeBlock) parts.push(knowledgeBlock);
  // Source excerpts AFTER knowledge so the model reads grounded prose
  // about THIS winery before any general regional context. The
  // formatter inlines its own Firestore-wins-for-structured-fields
  // reminder so the rule stays at the point of use.
  if (sourceExcerptsBlock) parts.push(sourceExcerptsBlock);
  parts.push(userMessage);
  return parts.join("\n\n");
}

// ─── Fuzzy name-matching fallback ─────────────────────────────────────────────

// Wine-industry generic words that AREN'T distinctive winery identifiers.
// Used by findFuzzyWineryMatches to avoid false positives like matching
// "Coal Valley Vineyard" on a "Coal River Valley" region mention, or
// "Bream Creek" on any sentence mentioning a creek.
const FUZZY_MATCH_STOPWORDS: ReadonlySet<string> = new Set([
  "winery", "wineries", "vineyard", "vineyards", "wines", "wine",
  "cellar", "door", "estate", "estates", "company", "tasmania",
  "tasmanian", "tas", "farm", "house", "creek", "valley", "bay",
  "ridge", "hill", "hills", "rock", "river", "island", "point",
  "north", "south", "east", "west", "and", "the", "of", "tasmania,",
]);

/**
 * Fallback winery-name detection. The router's job is to extract
 * nameKeywords from the user message, but it occasionally misses obvious
 * references — observed in production on
 * "What's the vineyard size at Tolpuddle in hectares?", which returned
 * nameKeywords=[] and silently dropped Tolpuddle from the candidate
 * list. This is the safety net.
 *
 * For each winery, take its name's "distinctive" words (≥4 chars, not a
 * wine-industry stopword). If any distinctive word appears as a discrete
 * token (word-boundary match) in the user message, treat that winery as
 * named.
 *
 * Word-boundary regex avoids substring false positives ("rose" → wouldn't
 * match inside "moorilla"). The stopword list bounds false positives on
 * generic region/place words.
 *
 * Used as FALLBACK ONLY — only kicks in when router.nameKeywords is
 * empty, so the router stays the primary extraction path and we don't
 * accidentally double-extract.
 */
function findFuzzyWineryMatches(
  userMessage: string,
  wineries: WineryDoc[],
): WineryDoc[] {
  const messageWords = new Set(
    userMessage.toLowerCase().match(/\b[a-z][a-z\-']{2,}\b/g) || [],
  );
  if (messageWords.size === 0) return [];

  const matches: WineryDoc[] = [];
  for (const w of wineries) {
    const name = (w.name || "").toLowerCase();
    if (!name) continue;
    const nameWords = (name.match(/\b[a-z][a-z\-']{2,}\b/g) || [])
      .filter((word) => word.length >= 4 && !FUZZY_MATCH_STOPWORDS.has(word));
    for (const word of nameWords) {
      if (messageWords.has(word)) {
        matches.push(w);
        break;
      }
    }
  }
  return matches;
}

// ─── Retrieval (lifted from Concierge.retrieveCandidates) ───────────────────

async function retrieveCandidates(
  userMessage: string,
  decision: RouteDecision,
  context: ConciergeContext,
  userLocation: { latitude: number; longitude: number } | null,
  adjacencyMap: Record<string, readonly string[]>
): Promise<WineryDoc[]> {
  if (decision.intent === "out_of_scope" || decision.limit === 0) {
    return [];
  }

  const wineries = context.wineries;

  // 1. Filter pass over the in-memory winery list.
  let candidates = wineries.filter((w) => {
    if (decision.regions.length > 0) {
      if (!w.region || !decision.regions.includes(w.region)) return false;
    }
    for (const tag of decision.tags) {
      const field = ROUTER_TAG_TO_FIELD[tag];
      if (field && !w[field]) return false;
    }
    if (decision.dayOfWeek && isExplicitlyClosedOn(w, decision.dayOfWeek)) {
      return false;
    }
    return true;
  });

  // 2. Determine effective name keywords. The router's nameKeywords are
  //    the primary signal; when it returns nothing AND the user message
  //    actually names a winery, fall back to a word-boundary fuzzy match
  //    so we don't silently drop the user's named winery from the
  //    candidate list. Real bug this fixes: "What's the vineyard size at
  //    Tolpuddle in hectares?" — router returned [], Tolpuddle was
  //    dropped, model deflected on a question the source had the answer
  //    for.
  let effectiveNameKeywords = decision.nameKeywords;
  if (effectiveNameKeywords.length === 0) {
    const fuzzyHits = findFuzzyWineryMatches(userMessage, wineries);
    if (fuzzyHits.length > 0) {
      if (IS_DEV) {
        console.log(
          "[concierge] router missed name extraction; fuzzy fallback caught:",
          fuzzyHits.map((w) => w.slug || w.id).join(", "),
        );
      }
      // Convert fuzzy hits into name keywords the downstream logic can
      // use as-is (it matches by `name.includes(kw)` so any of the
      // winery's distinctive words works). Use the longest distinctive
      // word per winery — most specific match.
      effectiveNameKeywords = fuzzyHits
        .map((w) => {
          const distinctive = (w.name || "")
            .toLowerCase()
            .match(/\b[a-z][a-z\-']{2,}\b/g)
            ?.filter(
              (word) =>
                word.length >= 4 && !FUZZY_MATCH_STOPWORDS.has(word),
            )
            .sort((a, b) => b.length - a.length)[0];
          return distinctive || "";
        })
        .filter(Boolean);
    }
  }

  // 3. Force-include named wineries (router-extracted OR fuzzy-fallback).
  //    Track them in `forcedSlugs` so step 7 (cap) can protect them
  //    from being sorted past the limit and silently dropped.
  const forcedSlugs = new Set<string>();
  if (effectiveNameKeywords.length > 0) {
    const have = new Set(candidates.map((c) => c.slug || c.id));
    const forced: WineryDoc[] = [];
    for (const w of wineries) {
      const id = w.slug || w.id;
      const name = (w.name || "").toLowerCase();
      const slug = (w.slug || w.id || "").toLowerCase();
      for (const kw of effectiveNameKeywords) {
        if (name.includes(kw) || slug.includes(kw)) {
          if (!have.has(id)) {
            forced.push(w);
            have.add(id);
          }
          // Mark as forced REGARDLESS of whether it was already in
          // candidates — this is what the cap step uses to protect it.
          forcedSlugs.add(id);
          break;
        }
      }
    }
    if (forced.length > 0) {
      candidates = [...forced, ...candidates];
    }
  }

  // 4. Neighbour expansion for itinerary / specific-winery turns.
  if (
    (decision.intent === "itinerary" ||
      decision.intent === "specific_winery") &&
    effectiveNameKeywords.length > 0
  ) {
    const matchedRegions = new Set<string>();
    for (const c of candidates) {
      const name = (c.name || "").toLowerCase();
      const slug = (c.slug || c.id || "").toLowerCase();
      for (const kw of effectiveNameKeywords) {
        if (name.includes(kw) || slug.includes(kw)) {
          if (c.region) matchedRegions.add(c.region);
          break;
        }
      }
    }
    if (matchedRegions.size > 0) {
      const adjacentRegions = new Set<string>();
      for (const r of matchedRegions) {
        for (const adj of adjacencyMap[r] ?? []) {
          if (!matchedRegions.has(adj)) adjacentRegions.add(adj);
        }
      }
      const have = new Set(candidates.map((c) => c.slug || c.id));
      const NEIGHBOURS_CAP = 8;
      const ADJACENT_CAP = 3;
      const sameRegion: WineryDoc[] = [];
      const adjacent: WineryDoc[] = [];
      for (const w of wineries) {
        if (sameRegion.length + adjacent.length >= NEIGHBOURS_CAP) break;
        const id = w.slug || w.id;
        if (have.has(id)) continue;
        if (!w.region) continue;
        if (matchedRegions.has(w.region)) {
          sameRegion.push(w);
          have.add(id);
        } else if (
          adjacent.length < ADJACENT_CAP &&
          adjacentRegions.has(w.region)
        ) {
          adjacent.push(w);
          have.add(id);
        }
      }
      const neighbours = [...sameRegion, ...adjacent];
      if (neighbours.length > 0) {
        candidates = [...candidates, ...neighbours];
      }
    }
  }

  // 5. Owner-controlled sort.
  candidates.sort((a, b) =>
    (b.boost ?? 0) - (a.boost ?? 0) ||
    (b.rating ?? 0) - (a.rating ?? 0)
  );

  // 6. Drive-time sort.
  if (
    userLocation &&
    shouldUseUserLocation(userMessage, decision) &&
    decision.regions.length === 0 &&
    candidates.length > 1
  ) {
    candidates = await sortByDriveTime(userLocation, candidates);
  }

  // 7. Cap, PROTECTING forced (named) wineries.
  //
  //   Why this matters: step 5's rating sort can push a named winery
  //   below the cap if other candidates have higher ratings. Without
  //   protection, the user asking about a specific (lower-rated) winery
  //   gets that winery silently dropped — the model never sees its
  //   source chunks and deflects on a question we have the answer for.
  //
  //   Partition into forced vs non-forced. Forced wineries are always
  //   preserved; non-forced fill the remaining slots up to
  //   decision.limit. If the user named MORE wineries than the cap
  //   (e.g. compared 5 producers), all named ones are returned — better
  //   to send extra context than silently drop a named winery.
  if (candidates.length > decision.limit) {
    const forced = candidates.filter((c) =>
      forcedSlugs.has(c.slug || c.id),
    );
    const rest = candidates.filter(
      (c) => !forcedSlugs.has(c.slug || c.id),
    );
    const slotsForRest = Math.max(0, decision.limit - forced.length);
    candidates = [...forced, ...rest.slice(0, slotsForRest)];
  }

  // 8. Description hydration — DISABLED.
  // Previously: when decision.retrieval.descriptions was true we'd embed
  // the user query with Voyage and pull top-K from the Upstash
  // `descriptions` index, then attach the returned chunk to each
  // candidate as `descriptionChunk` for the renderer to use.
  //
  // Reality check (May 2026): scripts/embed-wineries.js writes only
  // filter fields into the Upstash metadata — no `description` or
  // `text`. So every hit came back with text: null, bySlug stayed
  // empty, and `descriptionChunk` was never set on any candidate. We
  // paid for one Voyage embed + one Upstash query per
  // retrieveDescriptions=true turn for nothing.
  //
  // The router still emits the flag and the renderer still has a
  // fallback branch for `descriptionChunk` — both are no-ops today,
  // kept intact so the flag stays meaningful when we re-ingest with
  // description text in metadata and re-enable this block. See the
  // import comment at the top of this file for the re-enable steps.

  if (candidates.length === 0) {
    return pickFallbackSampler(wineries, decision.limit);
  }

  return candidates;
}

async function retrieveTastingNotesForTurn(
  userMessage: string,
  decision: RouteDecision,
  candidates: WineryDoc[],
  regionId: string
): Promise<TastingNoteHit[]> {
  if (!decision.retrieval.tastingNotes) return [];
  if (candidates.length === 0) return [];

  const query =
    decision.wineKeywords.length > 0
      ? [userMessage, ...decision.wineKeywords].join(" ")
      : userMessage;

  const wineryIds = candidates.map((c) => c.slug || c.id);

  try {
    return await retrieveTastingNotes(query, {
      regionId,
      wineryIds,
      topK: decision.intent === "specific_winery" ? 8 : 4,
    });
  } catch (err) {
    if (IS_DEV) {
      console.warn(
        "[concierge] tasting-note retrieval failed (continuing without notes):",
        err
      );
    }
    return [];
  }
}

async function retrieveKnowledgeChunks(
  userMessage: string,
  regionId: string
): Promise<KnowledgeChunk[]> {
  try {
    return await retrieveKnowledge(userMessage, { regionId });
  } catch (err) {
    if (IS_DEV) {
      console.warn("[concierge] knowledge retrieval failed:", err);
    }
    return [];
  }
}

/**
 * Per-turn winery_sources retrieval. Scopes to the candidate list the
 * filter/sort/drive-time pass identified — only wineries already
 * considered relevant get their source chunks pulled, so we don't
 * waste rerank budget on irrelevant producers.
 *
 * Per-intent defaults (topK + per-winery cap) come from
 * winerySourcesDefaultsForIntent so the orchestrator stays out of the
 * tuning business — see winerySourcesRetrieve.ts for the table.
 *
 * Fail-soft: a Voyage / Upstash hiccup returns [] rather than failing
 * the turn. The model will still have the structured winery rows in
 * <relevant_wineries> — losing source excerpts is a precision
 * regression, not an availability one.
 */
async function retrieveWinerySourcesForTurn(
  userMessage: string,
  decision: RouteDecision,
  candidateSlugs: string[],
  regionId: string
): Promise<WinerySourceHit[]> {
  if (candidateSlugs.length === 0) return [];
  const { topK, maxPerWinery } = winerySourcesDefaultsForIntent(decision.intent);
  try {
    return await retrieveWinerySources(userMessage, {
      regionId,
      wineryIds: candidateSlugs,
      topK,
      maxPerWinery,
    });
  } catch (err) {
    if (IS_DEV) {
      console.warn("[concierge] winery-sources retrieval failed:", err);
    }
    return [];
  }
}

// ─── Public entry point — orchestrateTurn ───────────────────────────────────

export interface OrchestrateOptions {
  /** Optional model override (default: OPENAI_MODEL env or "gpt-5.4"). */
  model?: string;
}

/**
 * Run a single concierge turn end-to-end. Streaming variant — the caller
 * provides an `onDelta` callback that's invoked once per text fragment.
 *
 * Flow (identical to the client's Concierge.askStream):
 *   0. Resolve coreference (referential follow-up → self-contained query)
 *   1. Route the query → structured filter spec
 *   2. Parallel retrieval (wineries + knowledge base) → candidate slice
 *   3. Sequential tasting-note retrieval (scoped to candidate slice)
 *   4. Build the per-turn user message body
 *   5. Stream the response model's reply through a marker-filter pipeline
 *   6. Trim to a complete sentence if cut off
 *   7. Parse hidden trip-plan / winery-card blocks off the tail
 *   8. Append turns to history (returned, NOT stored — server is stateless)
 *   9. Bill the three OpenAI calls into a single per-turn cost breakdown
 */
export async function orchestrateTurn(
  userMessage: string,
  history: ChatMessage[],
  userLocation: { latitude: number; longitude: number } | null,
  regionId: string,
  onDelta: (delta: string) => void,
  identity: { sessionId?: string; userId?: string } = {},
  opts: OrchestrateOptions = {}
): Promise<AskResult> {
  // ── Langfuse tracing ─────────────────────────────────────────────────
  // Open a single trace per concierge turn. Every sub-step (resolve,
  // route, retrieval, response) is attached as a child generation/span,
  // grouped under the same sessionId so an entire user conversation
  // shows up as one thread in the Langfuse dashboard.
  //
  // If Langfuse isn't configured (no env vars), `trace` is undefined
  // and every `.generation()` / `.span()` call below short-circuits via
  // optional chaining — the concierge keeps working with zero overhead.
  const langfuse = getLangfuse();
  // Environment tag follows Langfuse's recommended convention for filtering
  // dashboards by deployment stage. Cloud Functions sets NODE_ENV=production
  // at runtime, so deployed traffic gets `env:production` and the local
  // emulator gets `env:development`.
  const envTag = process.env.NODE_ENV === "production"
    ? "env:production"
    : "env:development";
  const trace = langfuse?.trace({
    name: "concierge.turn",
    sessionId: identity.sessionId,
    userId: identity.userId,
    input: userMessage,
    metadata: {
      regionId,
      historyTurns: history.length,
      hasUserLocation: !!userLocation,
    },
    // Tags drive the dashboard's filterable views. We follow the skill's
    // convention of `<facet>:<value>` so a single tag space stays readable.
    // Add new tags here when you ship a new surface that calls this
    // function (e.g. a Slack bot) — never as ad-hoc free strings.
    tags: [
      "feature:concierge",
      envTag,
      `region:${regionId}`,
      identity.userId ? "signed-in" : "anonymous",
    ],
  });

  try {
  // Load the region config first, in parallel with the winery context.
  // Both are cached at module scope, so this is a no-op after the first
  // call per region per warm container.
  const [regionConfig, context] = await Promise.all([
    getRegionConfig(regionId),
    getContext(regionId),
  ]);
  const client = getOpenAI();
  const model = opts.model || DEFAULT_MODEL;

  // Derive adjacency + centroids from the region's sub-regions. Cheap
  // (just shape transforms) so we do it per turn rather than caching.
  // For flat regions, both come back empty and downstream paths no-op.
  const adjacencyMap = buildAdjacencyMap(regionConfig);
  const centroids = buildCentroidList(regionConfig);

  // Today in the region's timezone — computed once per turn so the world
  // index can refresh at the actual day boundary the user experiences,
  // not at UTC midnight. todayShort feeds the per-winery `today:` hints
  // in the world index; todayLong feeds the `<today>` tag the system
  // prompt's hours rules reference.
  const todayShort = todayShortInTimezone(regionConfig.timezone);
  const todayLong = todayLongInTimezone(regionConfig.timezone);
  const worldIndex = getWorldIndex(regionId, context.wineries, todayShort);

  // 0. Resolve coreference.
  const resolveResult = await resolveCoreference(userMessage, {
    client,
    history,
  });
  const retrievalQuery = resolveResult.rewritten;

  // Log the rewriter call (it's a cheap mini model call — only happens
  // when there's history; otherwise resolveResult.usage is undefined).
  if (resolveResult.usage) {
    trace?.generation({
      name: "resolve-coreference",
      model: resolveResult.model,
      input: userMessage,
      output: retrievalQuery,
      usage: {
        input: resolveResult.usage.prompt_tokens,
        output: resolveResult.usage.completion_tokens,
        total:
          (resolveResult.usage.prompt_tokens ?? 0) +
          (resolveResult.usage.completion_tokens ?? 0),
      },
    });
  }

  // 1. Route.
  // `worldIndex` is intentionally NOT passed — the router is a structured
  // classifier and never needs to know the corpus contents. See the
  // header comment in router.ts for the cost rationale.
  const routeResult = await routeQuery(retrievalQuery, {
    client,
    region: regionConfig,
  });
  const decision = routeResult.decision;

  trace?.generation({
    name: "router-classify",
    model: routeResult.model,
    input: retrievalQuery,
    output: decision,
    usage: routeResult.usage
      ? {
          input: routeResult.usage.prompt_tokens,
          output: routeResult.usage.completion_tokens,
          total:
            (routeResult.usage.prompt_tokens ?? 0) +
            (routeResult.usage.completion_tokens ?? 0),
        }
      : undefined,
  });

  // 2. Parallel retrieval.
  // Single parent span for the whole retrieval fan-out so the dashboard
  // can show "how long did we spend hitting Voyage + Upstash + Firestore"
  // as one number, broken down by child span.
  //
  // Knowledge retrieval is intent-gated. We skip it for specific_winery,
  // feature, and out_of_scope turns — those don't benefit from editorial
  // prose chunks and the unconditional call was burning ~1K fresh-input
  // tokens + a Voyage embed + an Upstash query + a Firestore getAll on
  // every turn for nothing. Resolved to [] for gated turns so the
  // downstream formatter / Langfuse logging code paths are unchanged.
  const wantKnowledge = INTENTS_NEEDING_KNOWLEDGE.has(decision.intent);
  const wantWinerySources = INTENTS_NEEDING_WINERY_SOURCES.has(decision.intent);
  const retrievalSpan = trace?.span({
    name: "retrieval",
    input: { query: retrievalQuery, decision, wantKnowledge, wantWinerySources },
  });
  // Candidates + knowledge fire in parallel (independent of each other).
  // Tasting notes and winery sources are scoped to the candidate list,
  // so they have to wait for candidates to land — but they can run in
  // parallel with each other once candidates are in hand. Two-stage
  // fan-out keeps total retrieval latency to roughly the max of the
  // slowest leg in each stage.
  const [candidates, knowledgeChunks] = await Promise.all([
    retrieveCandidates(
      retrievalQuery,
      decision,
      context,
      userLocation,
      adjacencyMap
    ),
    wantKnowledge
      ? retrieveKnowledgeChunks(retrievalQuery, regionId)
      : Promise.resolve([] as KnowledgeChunk[]),
  ]);
  const candidateSlugs = candidates.map((c) => c.slug || c.id);
  const [tastingNotes, winerySources] = await Promise.all([
    retrieveTastingNotesForTurn(
      retrievalQuery,
      decision,
      candidates,
      regionId
    ),
    wantWinerySources && candidateSlugs.length > 0
      ? retrieveWinerySourcesForTurn(
          retrievalQuery,
          decision,
          candidateSlugs,
          regionId
        )
      : Promise.resolve([] as WinerySourceHit[]),
  ]);
  retrievalSpan?.end({
    output: {
      candidateCount: candidates.length,
      candidateSlugs,
      knowledgeChunkCount: knowledgeChunks.length,
      tastingNoteCount: tastingNotes.length,
      winerySourceCount: winerySources.length,
    },
  });

  // 3. Build per-turn payload.
  const contextBlock = renderDetailBlock(candidates);
  const tastingNotesBlock = formatTastingNotesForPrompt(tastingNotes);
  const knowledgeBlock = formatKnowledgeChunksForPrompt(
    knowledgeChunks,
    regionConfig.displayName
  );
  const sourceExcerptsBlock = formatWinerySourcesForPrompt(winerySources);

  // 4. Compose messages.
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildSystemPrompt(worldIndex, regionConfig, decision.intent),
    },
  ];
  for (const m of history) {
    messages.push({ role: m.role, content: m.content });
  }

  const locationForTurn = shouldUseUserLocation(retrievalQuery, decision)
    ? userLocation
    : null;

  const currentTurnContent = buildTurnContent(
    userMessage,
    contextBlock,
    tastingNotesBlock,
    knowledgeBlock,
    sourceExcerptsBlock,
    locationForTurn,
    regionConfig,
    centroids,
    todayLong
  );
  messages.push({ role: "user", content: currentTurnContent });

  // 5. Stream the response.
  // The response generation is opened BEFORE the stream so we capture
  // the start time, then closed with `.end()` after we have the final
  // text + usage. Langfuse computes latency from the open/close gap.
  //
  // Provider switch: `RESPONSE_PROVIDER` (env-controlled, default
  // "gemini") picks between the OpenAI and Gemini code paths below.
  // Both paths share the marker-filter closure so TRIP_PLAN /
  // WINERY_CARD suppression behaves identically regardless of provider.
  const maxTokens = maxTokensForIntent(decision.intent);
  const responseModel =
    RESPONSE_PROVIDER === "gemini" ? GEMINI_RESPONSE_MODEL : model;
  const responseGen = trace?.generation({
    name: "response",
    model: responseModel,
    input: messages,
    modelParameters: { maxTokens, provider: RESPONSE_PROVIDER },
  });

  // ── Shared marker filter ────────────────────────────────────────────
  // Holds a small lookahead buffer to detect <<TRIP_PLAN>> or
  // <<WINERY_CARD>> markers that may be split across stream chunks,
  // then suppresses everything from the marker onward (the parsers
  // pick those blocks off the rawReply later — the chat UI must never
  // see them stream in).
  const HOLD_LEN = Math.max(TRIP_PLAN_OPEN.length, WINERY_CARD_OPEN.length) - 1;
  let pending = "";
  let suppressing = false;

  const safeEmit = (text: string) => {
    if (!text) return;
    try {
      onDelta(text);
    } catch (err) {
      if (IS_DEV) {
        console.warn("[concierge] onDelta threw:", err);
      }
    }
  };

  const pushDelta = (delta: string) => {
    if (suppressing) return;
    pending += delta;

    const tripIdx = pending.indexOf(TRIP_PLAN_OPEN);
    const cardIdxStrict = pending.indexOf(WINERY_CARD_OPEN);
    const cardIdxFuzzy = pending.toLowerCase().indexOf(WINERY_CARD_PREFIX_LOWER);
    const cardIdx =
      cardIdxStrict !== -1 && cardIdxFuzzy !== -1 ? Math.min(cardIdxStrict, cardIdxFuzzy) :
      cardIdxStrict !== -1 ? cardIdxStrict :
      cardIdxFuzzy;
    const openIdx =
      tripIdx === -1 ? cardIdx :
      cardIdx === -1 ? tripIdx :
      Math.min(tripIdx, cardIdx);

    if (openIdx !== -1) {
      safeEmit(pending.slice(0, openIdx));
      pending = "";
      suppressing = true;
      return;
    }

    if (pending.length > HOLD_LEN) {
      const emitUpTo = pending.length - HOLD_LEN;
      safeEmit(pending.slice(0, emitUpTo));
      pending = pending.slice(emitUpTo);
    }
  };

  const flushPending = () => {
    if (!suppressing && pending.length > 0) {
      safeEmit(pending);
      pending = "";
    }
  };

  // ── Provider-specific streaming ─────────────────────────────────────
  let rawReply = "";
  let finishReason: string | null = null;
  let responseUsage: RawUsage | undefined;

  if (RESPONSE_PROVIDER === "openai") {
    const stream = client.beta.chat.completions.stream({
      model,
      max_completion_tokens: maxTokens,
      messages,
      // OpenAI streaming responses omit `usage` by default — the final chunk
      // doesn't carry token counts unless we explicitly opt in. Without this
      // both the in-app cost monitor and the Langfuse `response` generation
      // record zero tokens for the answer leg, which makes every cost number
      // look wrong and breaks per-model cost aggregation in the dashboard.
      stream_options: { include_usage: true },
    });

    stream.on("content", (delta: string) => pushDelta(delta));

    const finalMessage = await stream.finalChatCompletion();
    flushPending();

    rawReply = (finalMessage.choices[0]?.message?.content ?? "").trim();
    finishReason = finalMessage.choices[0]?.finish_reason ?? null;
    responseUsage = extractUsage(finalMessage.usage);
  } else {
    // Gemini path. Messages are mapped from OpenAI's shape to Gemini's
    // (systemInstruction + contents) inside streamGeminiResponse.
    // Content is always a plain string in our orchestrator — we never
    // build multipart content — so the simple narrow below is safe.
    const geminiMessages = messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: typeof m.content === "string" ? m.content : "",
    }));

    const result = await streamGeminiResponse({
      messages: geminiMessages,
      maxTokens,
      onDelta: pushDelta,
    });
    flushPending();

    rawReply = result.text.trim();
    finishReason = result.finishReason;
    responseUsage = result.usage;
  }

  const trimmedReply =
    finishReason === "length"
      ? trimToCompleteSentence(rawReply)
      : rawReply;

  const { cleaned: afterTrip, proposal } = parseTripProposal(trimmedReply);
  const { cleaned: reply, wineryCards } = parseWineryCards(afterTrip);

  // 7. Build updated history. The server stores nothing — we return the
  // trimmed history so the client can replace its local copy.
  const updatedHistory = [...history];
  updatedHistory.push({ role: "user", content: userMessage });
  updatedHistory.push({ role: "assistant", content: reply });
  const maxLen = MAX_HISTORY_TURNS * 2;
  const trimmedHistory =
    updatedHistory.length > maxLen
      ? updatedHistory.slice(-maxLen)
      : updatedHistory;

  // 8. Cost telemetry.
  const costEntries: Parameters<typeof buildTurnCost>[0] = [];
  if (resolveResult.usage) {
    costEntries.push({
      label: "Rewriter (resolve)",
      usage: resolveResult.usage,
      model: resolveResult.model,
    });
  }
  costEntries.push({
    label: "Router (classify)",
    usage: routeResult.usage,
    model: routeResult.model,
  });
  costEntries.push({
    label: "Response (reply)",
    usage: responseUsage,
    // Bill against the provider that actually answered this turn —
    // Gemini-2.5-flash on the default path, gpt-5.4-mini on rollback.
    // costTracker.ts has entries for both families.
    model: responseModel,
  });
  const cost = buildTurnCost(costEntries);

  // Close out the response generation with the final reply + usage.
  // responseUsage is in OpenAI RawUsage shape for both providers (the
  // Gemini wrapper normalises before returning), so Langfuse sees one
  // consistent usage shape regardless of which provider answered.
  responseGen?.end({
    output: reply,
    usage: responseUsage
      ? {
          input: responseUsage.prompt_tokens,
          output: responseUsage.completion_tokens,
          total:
            (responseUsage.prompt_tokens ?? 0) +
            (responseUsage.completion_tokens ?? 0),
        }
      : undefined,
  });

  // Finalize the top-level trace. Setting `output` on the trace itself
  // makes the dashboard's session view render the assistant reply as
  // the headline for this turn (instead of "<no output>"). Metadata
  // captures the headline numbers so they're filterable.
  trace?.update({
    output: reply,
    metadata: {
      regionId,
      historyTurns: history.length,
      hasUserLocation: !!userLocation,
      candidateCount: candidates.length,
      knowledgeChunkCount: knowledgeChunks.length,
      tastingNoteCount: tastingNotes.length,
      winerySourceCount: winerySources.length,
      intent: decision.intent,
      stopReason: finishReason,
      totalCostUsd: cost.total.usd.total,
      hasProposal: !!proposal,
      hasWineryCards: !!wineryCards,
    },
  });

  return {
    reply,
    // Same normalised RawUsage shape for both providers — see
    // geminiResponse.ts. The chat UI's CostMonitor reads this directly,
    // so consistency matters more than provider-specific richness.
    usage: responseUsage,
    stopReason: finishReason,
    routerDecision: decision,
    candidateCount: candidates.length,
    cost,
    proposal,
    wineryCards,
    history: trimmedHistory,
  };
  } catch (err) {
    // Record the failure on the trace so it shows up in the dashboard's
    // error filter, then re-throw so the HTTP layer can return the
    // `error` SSE event.
    trace?.update({
      output: null,
      metadata: {
        error: err instanceof Error ? err.message : String(err),
      },
      tags: ["error"],
    });
    throw err;
  } finally {
    // Always flush. Cloud Functions can be torn down between requests,
    // so we can't rely on Langfuse's interval flusher — we have to push
    // before returning. Best-effort: a Langfuse outage shouldn't break
    // the concierge.
    if (langfuse) {
      try {
        await langfuse.flushAsync();
        // Confirms the trace reached Langfuse — log unconditionally because
        // this is the line that tells you tracing is actually working in
        // production. If you ever wonder "did my last turn get sent?",
        // search the function log for this trace ID.
        if (trace?.id) {
          console.info(`[concierge] Langfuse trace flushed: ${trace.id}`);
        }
      } catch (flushErr) {
        // ALWAYS log — this is the one place tracing can silently die.
        console.warn("[concierge] Langfuse flush failed:", flushErr);
      }
    }
  }
}
