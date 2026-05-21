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
import { hydrateDescriptions } from "./retrieve";
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
import { resolveCoreference } from "./resolveCoreference";
import { routeQuery, type RouteDecision } from "./router";
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
const MAX_TOKENS = 550;
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
// Multi-region: the context cache is now keyed by regionId. A warm
// container that has served Tasmania once won't pay the Firestore
// round-trip on subsequent Tasmania requests; if it later serves a
// different region, that region's corpus loads on first request and
// then stays warm too.

interface ConciergeContext {
  wineries: WineryDoc[];
  bySlug: Map<string, WineryDoc>;
  worldIndex: string;
}

const _contextByRegion = new Map<string, Promise<ConciergeContext>>();
let _openai: OpenAI | null = null;

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
  // Memoise the IN-FLIGHT promise (not just the result) so two concurrent
  // requests on a cold container share a single Firestore round-trip.
  let p = _contextByRegion.get(regionId);
  if (!p) {
    p = (async () => {
      const { wineries } = await loadContext(regionId);
      const bySlug = new Map<string, WineryDoc>();
      for (const w of wineries) {
        bySlug.set(w.slug || w.id, w);
      }
      const worldIndex = renderWorldIndex(wineries);
      return { wineries, bySlug, worldIndex };
    })();
    // If the load fails, clear the cache so the next request can retry.
    p.catch(() => {
      _contextByRegion.delete(regionId);
    });
    _contextByRegion.set(regionId, p);
  }
  return p;
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

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function buildTurnContent(
  userMessage: string,
  wineryBlock: string,
  tastingNotesBlock: string,
  knowledgeBlock: string,
  userLocation: { latitude: number; longitude: number } | null,
  regionConfig: RegionConfig,
  centroids: { name: string; lat: number; lon: number }[]
): string {
  const today = DAY_NAMES[new Date().getDay()];
  const parts: string[] = [];
  parts.push(`<today>${today}</today>`);
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
  parts.push(userMessage);
  return parts.join("\n\n");
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

  // 2. Force-include named wineries.
  if (decision.nameKeywords.length > 0) {
    const have = new Set(candidates.map((c) => c.slug || c.id));
    const forced: WineryDoc[] = [];
    for (const w of wineries) {
      const id = w.slug || w.id;
      if (have.has(id)) continue;
      const name = (w.name || "").toLowerCase();
      const slug = (w.slug || w.id || "").toLowerCase();
      for (const kw of decision.nameKeywords) {
        if (name.includes(kw) || slug.includes(kw)) {
          forced.push(w);
          have.add(id);
          break;
        }
      }
    }
    if (forced.length > 0) {
      candidates = [...forced, ...candidates];
    }
  }

  // 3. Neighbour expansion for itinerary / specific-winery turns.
  if (
    (decision.intent === "itinerary" ||
      decision.intent === "specific_winery") &&
    decision.nameKeywords.length > 0
  ) {
    const matchedRegions = new Set<string>();
    for (const c of candidates) {
      const name = (c.name || "").toLowerCase();
      const slug = (c.slug || c.id || "").toLowerCase();
      for (const kw of decision.nameKeywords) {
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

  // 4. Owner-controlled sort.
  candidates.sort((a, b) =>
    (b.boost ?? 0) - (a.boost ?? 0) ||
    (b.rating ?? 0) - (a.rating ?? 0)
  );

  // 5. Drive-time sort.
  if (
    userLocation &&
    shouldUseUserLocation(userMessage, decision) &&
    decision.regions.length === 0 &&
    candidates.length > 1
  ) {
    candidates = await sortByDriveTime(userLocation, candidates);
  }

  // 6. Cap.
  candidates = candidates.slice(0, decision.limit);

  // 7. Description hydration.
  if (decision.retrieval.descriptions && candidates.length > 0) {
    try {
      const slugs = candidates.map((c) => c.slug || c.id);
      const hits = await hydrateDescriptions(userMessage, slugs);
      const bySlug = new Map<string, string>();
      for (const h of hits) {
        if (h.text) bySlug.set(h.slug, h.text);
      }
      if (bySlug.size > 0) {
        candidates = candidates.map((c) => {
          const chunk = bySlug.get(c.slug || c.id);
          return chunk ? { ...c, descriptionChunk: chunk } : c;
        });
      }
    } catch (err) {
      if (IS_DEV) {
        console.warn(
          "[concierge] description hydration failed (continuing without prose):",
          err
        );
      }
    }
  }

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
  const routeResult = await routeQuery(retrievalQuery, {
    client,
    worldIndex: context.worldIndex,
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
  const retrievalSpan = trace?.span({
    name: "retrieval",
    input: { query: retrievalQuery, decision },
  });
  const [candidates, knowledgeChunks] = await Promise.all([
    retrieveCandidates(
      retrievalQuery,
      decision,
      context,
      userLocation,
      adjacencyMap
    ),
    retrieveKnowledgeChunks(retrievalQuery, regionId),
  ]);
  const tastingNotes = await retrieveTastingNotesForTurn(
    retrievalQuery,
    decision,
    candidates,
    regionId
  );
  retrievalSpan?.end({
    output: {
      candidateCount: candidates.length,
      candidateSlugs: candidates.map((c) => c.slug || c.id),
      knowledgeChunkCount: knowledgeChunks.length,
      tastingNoteCount: tastingNotes.length,
    },
  });

  // 3. Build per-turn payload.
  const contextBlock = renderDetailBlock(candidates);
  const tastingNotesBlock = formatTastingNotesForPrompt(tastingNotes);
  const knowledgeBlock = formatKnowledgeChunksForPrompt(
    knowledgeChunks,
    regionConfig.displayName
  );

  // 4. Compose messages.
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildSystemPrompt(context.worldIndex, regionConfig),
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
    locationForTurn,
    regionConfig,
    centroids
  );
  messages.push({ role: "user", content: currentTurnContent });

  // 5. Stream the response.
  // The response generation is opened BEFORE the stream so we capture
  // the start time, then closed with `.end()` after we have the final
  // text + usage. Langfuse computes latency from the open/close gap.
  const responseGen = trace?.generation({
    name: "response",
    model,
    input: messages,
    modelParameters: { maxTokens: MAX_TOKENS },
  });
  const stream = client.beta.chat.completions.stream({
    model,
    max_completion_tokens: MAX_TOKENS,
    messages,
    // OpenAI streaming responses omit `usage` by default — the final chunk
    // doesn't carry token counts unless we explicitly opt in. Without this
    // both the in-app cost monitor and the Langfuse `response` generation
    // record zero tokens for the answer leg, which makes every cost number
    // look wrong and breaks per-model cost aggregation in the dashboard.
    stream_options: { include_usage: true },
  });

  // ── Streaming filter: hide TRIP_PLAN / WINERY_CARD blocks ──────────
  // Same lookahead-buffer logic as the client. Holds back enough chars
  // to detect either opening marker split across deltas, then suppresses
  // everything from the marker onward.
  let pending = "";
  let suppressing = false;
  const HOLD_LEN = Math.max(TRIP_PLAN_OPEN.length, WINERY_CARD_OPEN.length) - 1;

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

  stream.on("content", (delta: string) => {
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
  });

  const finalMessage = await stream.finalChatCompletion();

  // Flush whatever the lookahead buffer is still holding when the stream ends.
  if (!suppressing && pending.length > 0) {
    safeEmit(pending);
    pending = "";
  }

  // 6. Post-process.
  const rawReply = (finalMessage.choices[0]?.message?.content ?? "").trim();
  const finishReason = finalMessage.choices[0]?.finish_reason ?? null;

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
    usage: extractUsage(finalMessage.usage),
    model,
  });
  const cost = buildTurnCost(costEntries);

  // Close out the response generation with the final reply + usage.
  responseGen?.end({
    output: reply,
    usage: finalMessage.usage
      ? {
          input: finalMessage.usage.prompt_tokens,
          output: finalMessage.usage.completion_tokens,
          total: finalMessage.usage.total_tokens,
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
      intent: decision.intent,
      stopReason: finishReason,
      totalCostUsd: cost.total.usd.total,
      hasProposal: !!proposal,
      hasWineryCards: !!wineryCards,
    },
  });

  return {
    reply,
    usage: finalMessage.usage,
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
