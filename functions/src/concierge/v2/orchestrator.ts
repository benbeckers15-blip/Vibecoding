// functions/src/concierge/v2/orchestrator.ts
// ─────────────────────────────────────────────────────────────────────────────
// v2 orchestrator. One LLM router call (folds in resolver), a five-way
// switch over intents (spec §2.1), and one LLM response call. No global
// gating, no neighbour expansion, no forced-protection cap.
//
// Public AskResult shape is identical to v1 so ConciergeChat.tsx and
// services/concierge/concierge.ts don't need a single line changed.
//
// Module-scope caches (corpus, name index, world index) mirror v1's
// invalidation semantics: TTL-bounded so Firestore edits propagate
// within ~15 minutes without a redeploy.
//
// Spec reference: §6 (branch implementations) in
// docs/concierge-rewrite-spec.md.
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from "openai";
import { Langfuse } from "langfuse";

import {
  loadContext,
  renderWorldIndex,
  type WineryDoc,
} from "../buildContext";
import {
  buildTurnCost,
  type RawUsage,
  type TurnCost,
} from "../costTracker";
import { sortByDriveTime } from "../driveTimes";
import {
  streamGeminiResponse,
  GEMINI_RESPONSE_MODEL,
} from "../geminiResponse";
import {
  TRIP_PLAN_OPEN,
  WINERY_CARD_OPEN,
  WINERY_CARD_PREFIX_LOWER,
  parseTripProposal,
  parseWineryCards,
  trimToCompleteSentence,
  type TripProposal,
  type WineryCardSuggestion,
} from "../parsers";
import {
  buildCentroidList,
  getRegionConfig,
  type RegionConfig,
} from "../regionConfig";

import { buildEnvelope } from "./envelope";
import { buildNameIndex, type NameIndex } from "./nameIndex";
import {
  formatKnowledgeV2,
  formatTastingNotesV2,
  formatWinerySourcesV2,
  retrieveKnowledgeV2,
  retrieveTastingNotesV2,
  retrieveWinerySourcesV2,
  winerySourcesDefaults,
  type KnowledgeChunk,
  type TastingNoteHit,
} from "./retrievers";
import {
  routeV2,
  type V2Intent,
  type V2RouteDecision,
  type V2RouteResult,
} from "./router";
import { buildSystemPromptV2 } from "./systemPrompt";
import { filterCandidates } from "./wineriesFilter";
import { loadWinesForRegion } from "./winesLoader";

const IS_DEV = process.env.NODE_ENV !== "production";

// Provider switch — same as v1. Default Gemini per stipulation #15.
type ResponseProvider = "openai" | "gemini";
const RESPONSE_PROVIDER: ResponseProvider =
  (process.env.LLM_PROVIDER || "gemini").toLowerCase() === "openai"
    ? "openai"
    : "gemini";

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

// Per-branch output budget. Tighter than v1's broad caps because the
// new prompt is leaner and each branch has a narrower job. TRIP is
// the exception — it carries the longest prose (multi-stop itinerary
// + lunch context + designated-driver nudge) AND must leave headroom
// for the trip-plan + winery-card tail markers. The 800 was tuned
// after case-16-turn-2 showed Gemini hard-truncating mid-word
// ("…is Upland") at 650 before any marker could emit.
const MAX_TOKENS_BY_BRANCH: Record<V2Intent, number> = {
  WINERY_FOCUS: 400,
  DISCOVERY: 400,
  TRIP: 800,
  KNOWLEDGE: 350,
  OUT_OF_SCOPE: 100,
};
const CLARIFYING_MAX_TOKENS = 100;

const MAX_HISTORY_TURNS = 4;

// ─── Public types (matches v1's AskResult shape) ──────────────────────────

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface AskResult {
  reply: string;
  usage?: unknown;
  stopReason?: string | null;
  routerDecision?: V2RouteDecision;
  candidateCount?: number;
  cost: TurnCost;
  proposal?: TripProposal | null;
  wineryCards?: WineryCardSuggestion | null;
  history: ChatMessage[];
}

export interface OrchestrateOptions {
  model?: string;
}

// ─── Module-scope caches ──────────────────────────────────────────────────

interface ConciergeContext {
  wineries: WineryDoc[];
  nameIndex: NameIndex;
}

interface CachedContext {
  promise: Promise<ConciergeContext>;
  loadedAt: number;
}

const _contextByRegion = new Map<string, CachedContext>();
const _worldIndexByKey = new Map<string, string>();
let _openai: OpenAI | null = null;

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_TTL_MS =
  Number(process.env.CONCIERGE_CACHE_TTL_MS) || DEFAULT_CACHE_TTL_MS;

async function getContext(regionId: string): Promise<ConciergeContext> {
  const now = Date.now();
  const entry = _contextByRegion.get(regionId);
  if (entry && now - entry.loadedAt < CACHE_TTL_MS) {
    return entry.promise;
  }

  // Drop derived world-index entries for this region — they were
  // built from the old corpus.
  for (const key of _worldIndexByKey.keys()) {
    if (key.startsWith(`${regionId}:`)) _worldIndexByKey.delete(key);
  }

  const promise = (async () => {
    const [{ wineries }, wines] = await Promise.all([
      loadContext(regionId),
      loadWinesForRegion(regionId),
    ]);
    const nameIndex = buildNameIndex(wineries, wines);
    if (IS_DEV) {
      console.log(
        "[v2:context] loaded region",
        regionId,
        "nameIndex.stats =",
        nameIndex.stats()
      );
    }
    return { wineries, nameIndex };
  })();

  _contextByRegion.set(regionId, { promise, loadedAt: now });

  promise.catch(() => {
    const current = _contextByRegion.get(regionId);
    if (current?.promise === promise) {
      _contextByRegion.delete(regionId);
    }
  });

  return promise;
}

function getWorldIndex(
  regionId: string,
  wineries: WineryDoc[],
  todayShort: string
): string {
  const key = `${regionId}:${todayShort}`;
  const cached = _worldIndexByKey.get(key);
  if (cached !== undefined) return cached;
  const s = renderWorldIndex(wineries, todayShort);
  _worldIndexByKey.set(key, s);
  return s;
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

// ─── Langfuse (lazy, optional) ────────────────────────────────────────────
// Same fail-soft pattern as v1: if LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY
// aren't bound to this function, every trace call short-circuits via
// optional chaining and the concierge keeps serving turns with zero
// overhead. Lets local dev / new environments run without Langfuse.
//
// v2 traces carry a `version:v2` tag so the dashboard can filter v2
// vs v1 traffic during the soak period. Once v1 is deleted, the tag
// can stay or be dropped — harmless either way.

let _langfuse: Langfuse | null = null;
let _langfuseChecked = false;

function getLangfuse(): Langfuse | null {
  if (_langfuseChecked) return _langfuse;
  _langfuseChecked = true;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    console.warn(
      "[v2] LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set — tracing disabled."
    );
    return null;
  }
  // Default to EU host (the SDK default). Override to https://us.cloud.langfuse.com
  // via LANGFUSE_BASEURL if your project is on US Cloud or self-hosted.
  const baseUrl = process.env.LANGFUSE_BASEURL || "https://cloud.langfuse.com";
  console.info(
    `[v2] Langfuse initialized → ${baseUrl} (pk: ${publicKey.slice(0, 10)}…)`
  );
  _langfuse = new Langfuse({
    publicKey,
    secretKey,
    baseUrl,
    flushAt: 1,
    flushInterval: 1000,
    // Cloud Run injects K_REVISION on every container — tagging the
    // release with it makes a regression after deploy traceable to the
    // exact revision that introduced it. Override via LANGFUSE_RELEASE
    // if you'd rather tag by git SHA / semver.
    release: process.env.LANGFUSE_RELEASE || process.env.K_REVISION || undefined,
  });
  // Surface SDK-level errors (e.g. auth failures from key/project
  // mismatch) that flushAsync() otherwise swallows.
  _langfuse.on("error", (err) => {
    console.error("[v2] Langfuse SDK error event:", err);
  });
  return _langfuse;
}

// ─── Timezone-aware "today" helpers (lifted from v1) ──────────────────────

function todayShortInTimezone(timezone: string | undefined): string {
  const tz = timezone || "UTC";
  if (!timezone) {
    console.warn(
      "[v2] region timezone not configured — falling back to UTC."
    );
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: tz,
    }).format(new Date());
  } catch {
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

// ─── Location helpers ─────────────────────────────────────────────────────

const NEARBY_REQUEST_RE =
  /\b(?:nearby|near\s+(?:me|us|here)|close\s+(?:to\s+(?:me|us)|by)|closest|nearest|around\s+(?:here|me|us)|in\s+my\s+(?:area|vicinity)|from\s+(?:here|my\s+(?:current\s+)?location|where\s+(?:i|we)['’]?\s*(?:m|re|am|are)))\b/i;

function shouldUseUserLocation(
  userMessage: string,
  decision: V2RouteDecision
): boolean {
  if (decision.intent === "TRIP") return true;
  if (NEARBY_REQUEST_RE.test(userMessage)) return true;
  return false;
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best.name;
}

function buildLocationDescription(
  userLocation: { latitude: number; longitude: number } | null,
  decision: V2RouteDecision,
  region: RegionConfig,
  centroids: { name: string; lat: number; lon: number }[],
  userMessage: string
): string | undefined {
  if (!userLocation) return undefined;
  if (!shouldUseUserLocation(userMessage, decision)) return undefined;
  const sub = nearestRegion(
    userLocation.latitude,
    userLocation.longitude,
    centroids
  );
  return sub
    ? `User is currently near the ${sub} area of ${region.displayName}.`
    : `User is currently in ${region.displayName}.`;
}

// ─── Marker-filter streaming ──────────────────────────────────────────────
// Same shape as v1's filter. Holds a small lookahead so a marker
// split across stream chunks (e.g. "<<TR" arriving in one chunk,
// "IP_PLAN>>" in the next) is still caught before any of it reaches
// the UI.

function makeStreamingFilter(onDelta: (text: string) => void) {
  const HOLD_LEN =
    Math.max(TRIP_PLAN_OPEN.length, WINERY_CARD_OPEN.length) - 1;
  let pending = "";
  let suppressing = false;

  const safeEmit = (text: string) => {
    if (!text) return;
    try {
      onDelta(text);
    } catch (err) {
      if (IS_DEV) console.warn("[v2] onDelta threw:", err);
    }
  };

  const pushDelta = (delta: string) => {
    if (suppressing) return;
    pending += delta;

    const tripIdx = pending.indexOf(TRIP_PLAN_OPEN);
    const cardIdxStrict = pending.indexOf(WINERY_CARD_OPEN);
    const cardIdxFuzzy = pending
      .toLowerCase()
      .indexOf(WINERY_CARD_PREFIX_LOWER);
    const cardIdx =
      cardIdxStrict !== -1 && cardIdxFuzzy !== -1
        ? Math.min(cardIdxStrict, cardIdxFuzzy)
        : cardIdxStrict !== -1
        ? cardIdxStrict
        : cardIdxFuzzy;
    const openIdx =
      tripIdx === -1
        ? cardIdx
        : cardIdx === -1
        ? tripIdx
        : Math.min(tripIdx, cardIdx);

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

  return { pushDelta, flushPending };
}

// ─── Response streaming ───────────────────────────────────────────────────

async function streamResponse(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  maxTokens: number,
  onDelta: (text: string) => void
): Promise<{ rawReply: string; finishReason: string | null; usage?: RawUsage }> {
  const { pushDelta, flushPending } = makeStreamingFilter(onDelta);

  let rawReply = "";
  let finishReason: string | null = null;
  let usage: RawUsage | undefined;

  if (RESPONSE_PROVIDER === "openai") {
    const stream = client.beta.chat.completions.stream({
      model,
      max_completion_tokens: maxTokens,
      messages,
      stream_options: { include_usage: true },
    });
    stream.on("content", (delta: string) => pushDelta(delta));
    const finalMessage = await stream.finalChatCompletion();
    flushPending();
    rawReply = (finalMessage.choices[0]?.message?.content ?? "").trim();
    finishReason = finalMessage.choices[0]?.finish_reason ?? null;
    if (finalMessage.usage) {
      usage = {
        prompt_tokens: finalMessage.usage.prompt_tokens,
        completion_tokens: finalMessage.usage.completion_tokens,
        prompt_tokens_details: {
          cached_tokens:
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (finalMessage.usage as any).prompt_tokens_details?.cached_tokens,
        },
      };
    }
  } else {
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
    usage = result.usage;
  }

  return { rawReply, finishReason, usage };
}

// ─── Branch helpers ───────────────────────────────────────────────────────

/**
 * Look up the anchored winery in the corpus. Used by WINERY_FOCUS.
 * Returns undefined if the slug isn't in the corpus — that's a
 * router/nameIndex disagreement and the orchestrator falls through
 * to the unrecognised-winery deflection.
 */
function findInCorpus(
  wineries: WineryDoc[],
  slug: string
): WineryDoc | undefined {
  return wineries.find((w) => (w.slug ?? w.id) === slug);
}

/**
 * Check whether the anchored wine was returned in the tasting-notes
 * result. Used by WINERY_FOCUS when `anchorWineId` is set — if the
 * wine is missing, the wine_not_in_notes sentinel fires.
 */
function tastingNotesIncludeWine(
  notes: TastingNoteHit[],
  wineId: string
): boolean {
  return notes.some((n) => n.wineId === wineId);
}

// ─── Branch implementations ───────────────────────────────────────────────

interface BranchInputs {
  decision: V2RouteDecision;
  context: ConciergeContext;
  userMessage: string;
  userLocation: { latitude: number; longitude: number } | null;
  regionConfig: RegionConfig;
  regionId: string;
  todayLong: string;
  centroids: { name: string; lat: number; lon: number }[];
}

interface BranchOutput {
  envelopeContent: string;
  candidateCount: number;
  maxTokens: number;
}

async function buildWineryFocusEnvelope(
  inputs: BranchInputs
): Promise<BranchOutput> {
  const { decision, context, userMessage, regionConfig, regionId, todayLong } =
    inputs;
  const locationDesc = buildLocationDescription(
    inputs.userLocation,
    decision,
    regionConfig,
    inputs.centroids,
    userMessage
  );

  const anchorSlug = decision.anchorWinerySlug;
  const anchorWineId = decision.anchorWineId;

  // Case 1: WINERY_FOCUS but no anchor in the corpus (router said the
  // user named a winery; nameIndex didn't match it). Surface the
  // unrecognised_winery sentinel and let the system prompt's
  // three-bucket rule handle the response.
  if (!anchorSlug) {
    const envelopeContent = buildEnvelope({
      todayLong,
      userLocationDescription: locationDesc,
      wineries: [],
      unrecognisedWinery: decision.selfContainedQuery,
      userMessage,
    });
    return {
      envelopeContent,
      candidateCount: 0,
      maxTokens: MAX_TOKENS_BY_BRANCH.WINERY_FOCUS,
    };
  }

  const anchorWinery = findInCorpus(context.wineries, anchorSlug);

  if (!anchorWinery) {
    // Defensive: the nameIndex matched a slug but the corpus doesn't
    // have it. Could happen if the indexes drift. Fall back to the
    // unrecognised-winery path so the model still answers gracefully.
    const envelopeContent = buildEnvelope({
      todayLong,
      userLocationDescription: locationDesc,
      wineries: [],
      unrecognisedWinery: decision.selfContainedQuery,
      userMessage,
    });
    return {
      envelopeContent,
      candidateCount: 0,
      maxTokens: MAX_TOKENS_BY_BRANCH.WINERY_FOCUS,
    };
  }

  // Case 2: Anchor in corpus. Retrieve tasting notes and source
  // chunks scoped to this winery only. No neighbour expansion.
  const tastingNotes = await retrieveTastingNotesV2(
    decision.selfContainedQuery,
    {
      regionId,
      wineryIds: [anchorSlug],
      topK: 8,
    }
  );
  const sourceDefaults = winerySourcesDefaults("WINERY_FOCUS");
  const sourceChunks = await retrieveWinerySourcesV2(
    decision.selfContainedQuery,
    {
      regionId,
      wineryIds: [anchorSlug],
      topK: sourceDefaults.topK,
      maxPerWinery: sourceDefaults.maxPerWinery,
    }
  );

  // Stipulation #5 tier B: user named a specific wine that anchors
  // on this winery, but the wine isn't in the returned notes. Surface
  // the wine_not_in_notes sentinel so the model speaks to style
  // without inventing tasting notes.
  let wineNotInNotes: string | undefined;
  if (anchorWineId && !tastingNotesIncludeWine(tastingNotes, anchorWineId)) {
    // Best-effort: try to find the wine in the loaded name index for a
    // readable description. The orchestrator doesn't have direct
    // access to wines metadata here; nameIndex captured the wine's
    // name during lookup, but we'd need to re-look-up to get it.
    // Simplest: re-derive from the matched wine via context.
    const wineHit = context.nameIndex.lookupWine(decision.selfContainedQuery);
    const wineDescription = wineHit
      ? `"${wineHit.name}" by ${anchorWinery.name ?? "this winery"}`
      : `the specific wine you asked about by ${anchorWinery.name ?? "this winery"}`;
    wineNotInNotes = wineDescription;
  }

  const envelopeContent = buildEnvelope({
    todayLong,
    userLocationDescription: locationDesc,
    wineries: [anchorWinery],
    tastingNotesBlock: formatTastingNotesV2(tastingNotes),
    sourceExcerptsBlock: formatWinerySourcesV2(sourceChunks),
    wineNotInNotes,
    userMessage,
  });
  return {
    envelopeContent,
    candidateCount: 1,
    maxTokens: MAX_TOKENS_BY_BRANCH.WINERY_FOCUS,
  };
}

async function buildDiscoveryEnvelope(
  inputs: BranchInputs
): Promise<BranchOutput> {
  const { decision, context, userMessage, regionConfig, regionId, todayLong } =
    inputs;
  const locationDesc = buildLocationDescription(
    inputs.userLocation,
    decision,
    regionConfig,
    inputs.centroids,
    userMessage
  );

  // Filter corpus by region + tags + day.
  let candidates = filterCandidates(context.wineries, {
    regions: decision.regions,
    tags: decision.tags,
    dayOfWeek: decision.dayOfWeek,
    limit: 8,
  });

  // Nearby request → drive-time sort.
  if (
    inputs.userLocation &&
    shouldUseUserLocation(userMessage, decision) &&
    candidates.length > 1
  ) {
    candidates = await sortByDriveTime(inputs.userLocation, candidates);
  }

  // Wine words present → whole-namespace tasting-notes retrieval
  // (NO wineryId filter). The reranker handles precision; the
  // wineries those wines belong to get folded into the candidate
  // set below so the model has their structured rows.
  let tastingNotes: TastingNoteHit[] = [];
  if (decision.wineWords.length > 0) {
    const query = [decision.selfContainedQuery, ...decision.wineWords].join(
      " "
    );
    tastingNotes = await retrieveTastingNotesV2(query, {
      regionId,
      wineryIds: undefined,
      topK: 4,
    });

    // Merge the tasting-notes' owning wineries into candidates so the
    // model can describe them.
    if (tastingNotes.length > 0) {
      const have = new Set(candidates.map((c) => c.slug ?? c.id));
      for (const note of tastingNotes) {
        if (!note.wineryId || have.has(note.wineryId)) continue;
        const w = findInCorpus(context.wineries, note.wineryId);
        if (w) {
          candidates.push(w);
          have.add(note.wineryId);
        }
      }
    }
  }

  // Knowledge base — only when the question is broad (no wine words,
  // any region/tag set, OR no constraints at all). The §2.1 table
  // says "on if no wine words present and query is broad/regional".
  let knowledgeBlock = "";
  if (decision.wineWords.length === 0) {
    const knowledge = await retrieveKnowledgeV2(
      decision.selfContainedQuery,
      { regionId, regions: decision.regions, topK: 3 }
    );
    knowledgeBlock = formatKnowledgeV2(knowledge, regionConfig.displayName);
  }

  const envelopeContent = buildEnvelope({
    todayLong,
    userLocationDescription: locationDesc,
    wineries: candidates,
    tastingNotesBlock: formatTastingNotesV2(tastingNotes),
    knowledgeBlock,
    userMessage,
  });
  return {
    envelopeContent,
    candidateCount: candidates.length,
    maxTokens: MAX_TOKENS_BY_BRANCH.DISCOVERY,
  };
}

async function buildTripEnvelope(
  inputs: BranchInputs
): Promise<BranchOutput> {
  const { decision, context, userMessage, regionConfig, regionId, todayLong } =
    inputs;
  const locationDesc = buildLocationDescription(
    inputs.userLocation,
    decision,
    regionConfig,
    inputs.centroids,
    userMessage
  );

  let candidates = filterCandidates(context.wineries, {
    regions: decision.regions,
    tags: decision.tags,
    dayOfWeek: decision.dayOfWeek,
    limit: 12,
  });

  if (inputs.userLocation && candidates.length > 1) {
    candidates = await sortByDriveTime(inputs.userLocation, candidates);
  }

  let tastingNotes: TastingNoteHit[] = [];
  if (decision.wineWords.length > 0) {
    const query = [decision.selfContainedQuery, ...decision.wineWords].join(
      " "
    );
    tastingNotes = await retrieveTastingNotesV2(query, {
      regionId,
      wineryIds: candidates.map((c) => c.slug ?? c.id),
      topK: 4,
    });
  }

  const envelopeContent = buildEnvelope({
    todayLong,
    userLocationDescription: locationDesc,
    wineries: candidates,
    tastingNotesBlock: formatTastingNotesV2(tastingNotes),
    userMessage,
  });
  return {
    envelopeContent,
    candidateCount: candidates.length,
    maxTokens: MAX_TOKENS_BY_BRANCH.TRIP,
  };
}

async function buildKnowledgeEnvelope(
  inputs: BranchInputs
): Promise<BranchOutput> {
  const { decision, userMessage, regionConfig, regionId, todayLong } = inputs;

  const knowledge: KnowledgeChunk[] = await retrieveKnowledgeV2(
    decision.selfContainedQuery,
    { regionId, regions: decision.regions, topK: 3 }
  );

  const envelopeContent = buildEnvelope({
    todayLong,
    wineries: [],
    knowledgeBlock: formatKnowledgeV2(knowledge, regionConfig.displayName),
    userMessage,
  });
  return {
    envelopeContent,
    candidateCount: 0,
    maxTokens: MAX_TOKENS_BY_BRANCH.KNOWLEDGE,
  };
}

function buildOutOfScopeEnvelope(inputs: BranchInputs): BranchOutput {
  const envelopeContent = buildEnvelope({
    todayLong: inputs.todayLong,
    wineries: [],
    userMessage: inputs.userMessage,
  });
  return {
    envelopeContent,
    candidateCount: 0,
    maxTokens: MAX_TOKENS_BY_BRANCH.OUT_OF_SCOPE,
  };
}

function buildClarifyingEnvelope(
  inputs: BranchInputs,
  clarifyingQuestion: string
): BranchOutput {
  const envelopeContent = buildEnvelope({
    todayLong: inputs.todayLong,
    wineries: [],
    clarifyingQuestion,
    userMessage: inputs.userMessage,
  });
  return {
    envelopeContent,
    candidateCount: 0,
    maxTokens: CLARIFYING_MAX_TOKENS,
  };
}

async function dispatchBranch(inputs: BranchInputs): Promise<BranchOutput> {
  // Clarifying-question short-circuit. The router only sets this on
  // TRIP / DISCOVERY (router gates it), so we trust the field and
  // skip all retrieval.
  if (inputs.decision.clarifyingQuestion) {
    return buildClarifyingEnvelope(inputs, inputs.decision.clarifyingQuestion);
  }

  switch (inputs.decision.intent) {
    case "WINERY_FOCUS":
      return buildWineryFocusEnvelope(inputs);
    case "DISCOVERY":
      return buildDiscoveryEnvelope(inputs);
    case "TRIP":
      return buildTripEnvelope(inputs);
    case "KNOWLEDGE":
      return buildKnowledgeEnvelope(inputs);
    case "OUT_OF_SCOPE":
    default:
      return buildOutOfScopeEnvelope(inputs);
  }
}

// ─── Public entry point ───────────────────────────────────────────────────

export async function orchestrateTurnV2(
  userMessage: string,
  history: ChatMessage[],
  userLocation: { latitude: number; longitude: number } | null,
  regionId: string,
  onDelta: (delta: string) => void,
  identity: { sessionId?: string; userId?: string } = {},
  opts: OrchestrateOptions = {}
): Promise<AskResult> {
  // ─── Langfuse trace ─────────────────────────────────────────────────
  // One trace per concierge turn. Every sub-step (router, retrieval,
  // response) is attached as a child generation / span. Tags drive
  // dashboard filtering: `version:v2` differentiates v2 traces from v1
  // during the soak window so we can diff intent distributions, latency,
  // and error rates side-by-side. `branch:<intent>` gets appended once
  // the router has classified, so the dashboard can filter by which v2
  // branch served the turn.
  //
  // If LANGFUSE_* env vars aren't set, `langfuse` is null and every
  // trace call below short-circuits via optional chaining. The
  // concierge keeps working with zero tracing overhead.
  const langfuse = getLangfuse();
  const envTag =
    process.env.NODE_ENV === "production"
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
    tags: [
      "feature:concierge",
      envTag,
      `region:${regionId}`,
      "version:v2",
      identity.userId ? "signed-in" : "anonymous",
    ],
  });

  try {
  const client = getOpenAI();
  const model = opts.model || DEFAULT_MODEL;

  const [regionConfig, context] = await Promise.all([
    getRegionConfig(regionId),
    getContext(regionId),
  ]);
  const centroids = buildCentroidList(regionConfig);
  const todayShort = todayShortInTimezone(regionConfig.timezone);
  const todayLong = todayLongInTimezone(regionConfig.timezone);
  const worldIndex = getWorldIndex(regionId, context.wineries, todayShort);

  // 1. Route (one LLM call — folds in coref resolution).
  const routeResult: V2RouteResult = await routeV2(userMessage, {
    client,
    region: regionConfig,
    history,
    nameIndex: context.nameIndex,
  });
  const decision = routeResult.decision;

  // Log the router call. One generation per turn (vs v1's two: separate
  // router + resolver). Carries the full structured decision as output
  // so the dashboard shows what the router emitted.
  trace?.generation({
    name: "router-classify-and-resolve",
    model: routeResult.model,
    input: userMessage,
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
    metadata: {
      anchorWinerySlug: decision.anchorWinerySlug,
      anchorWineId: decision.anchorWineId,
      offCorpusWineryNamed: routeResult.diagnostics.offCorpusWineryNamed,
      clarifyingFired: !!decision.clarifyingQuestion,
    },
  });

  // Stipulation #12 — location-aware DISCOVERY override.
  //
  // When the router emits a clarifying question on a DISCOVERY turn
  // that has no other constraints (no region, tags, wineWords, day),
  // it's almost always asking "where are you based?". If the user
  // already has GPS location available we can answer the question
  // ourselves and skip the clarifying — use the nearest sub-region
  // as the recommendation anchor instead.
  //
  // We deliberately keep this narrow:
  //   • DISCOVERY only (TRIP without a day still genuinely needs to
  //     ask — a date-aware itinerary can't be built from location
  //     alone). The fallback default for "Plan a day" stays the
  //     clarifying question.
  //   • No other constraints — if the user has named a region, tag,
  //     or varietal, we should respect those rather than overriding
  //     to a location-anchored slice.
  //   • Flat regions (no sub-regions / centroids) → no override; the
  //     clarifying still runs because there's no sub-region to anchor
  //     to.
  if (
    decision.intent === "DISCOVERY" &&
    decision.clarifyingQuestion &&
    decision.regions.length === 0 &&
    decision.tags.length === 0 &&
    decision.wineWords.length === 0 &&
    userLocation &&
    centroids.length > 0
  ) {
    const nearestSub = nearestRegion(
      userLocation.latitude,
      userLocation.longitude,
      centroids
    );
    if (nearestSub) {
      if (IS_DEV) {
        console.log(
          "[v2:route] location-aware override → using nearest sub-region",
          nearestSub,
          "in place of clarifying question"
        );
      }
      decision.regions = [nearestSub];
      decision.clarifyingQuestion = null;
    }
  }

  if (IS_DEV) {
    console.log("[v2:route]", {
      intent: decision.intent,
      anchorWinerySlug: decision.anchorWinerySlug,
      anchorWineId: decision.anchorWineId,
      clarifying: !!decision.clarifyingQuestion,
      offCorpus: routeResult.diagnostics.offCorpusWineryNamed,
    });
  }

  // 2. Dispatch to branch — builds the envelope, fires the right
  // retrievals. No global gating.
  //
  // Single parent span for retrieval so the dashboard shows the
  // branch's full retrieval cost as one number. v1 used to split this
  // into child spans per retrieval call; v2 keeps it at one level
  // because the branch table makes the per-branch fan-out obvious
  // and we don't want to add granularity that the design has already
  // simplified away. If you ever need per-retrieval timing, the
  // branch fan-outs in dispatchBranch() are the natural place to
  // attach child spans.
  const retrievalSpan = trace?.span({
    name: "retrieval",
    input: {
      branch: decision.intent,
      anchorWinerySlug: decision.anchorWinerySlug,
      regions: decision.regions,
      tags: decision.tags,
      wineWords: decision.wineWords,
      clarifying: !!decision.clarifyingQuestion,
    },
  });
  const branchOutput = await dispatchBranch({
    decision,
    context,
    userMessage,
    userLocation,
    regionConfig,
    regionId,
    todayLong,
    centroids,
  });
  retrievalSpan?.end({
    output: {
      candidateCount: branchOutput.candidateCount,
      maxTokens: branchOutput.maxTokens,
    },
  });

  // 3. Compose messages.
  const systemPrompt = buildSystemPromptV2(worldIndex, regionConfig);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];
  for (const m of history) {
    messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: "user", content: branchOutput.envelopeContent });

  // 4. Stream the response.
  // Open the response generation BEFORE the stream starts so Langfuse
  // captures the open-time as the call start. Close with the final
  // text + usage once streamResponse resolves.
  const responseModel =
    RESPONSE_PROVIDER === "gemini" ? GEMINI_RESPONSE_MODEL : model;
  const responseGen = trace?.generation({
    name: "response",
    model: responseModel,
    input: messages,
    modelParameters: {
      maxTokens: branchOutput.maxTokens,
      provider: RESPONSE_PROVIDER,
    },
  });
  const { rawReply, finishReason, usage: responseUsage } = await streamResponse(
    client,
    model,
    messages,
    branchOutput.maxTokens,
    onDelta
  );

  // 5. Trim, parse tail markers.
  const trimmedReply =
    finishReason === "length" ? trimToCompleteSentence(rawReply) : rawReply;
  const { cleaned: afterTrip, proposal } = parseTripProposal(trimmedReply);
  const { cleaned: reply, wineryCards } = parseWineryCards(afterTrip);

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

  // 6. Trim history. Stateless — return the updated history; orchestrator
  // never persists it (client replaces its local copy from the result).
  const updatedHistory: ChatMessage[] = [
    ...history,
    { role: "user", content: userMessage },
    { role: "assistant", content: reply },
  ];
  const maxLen = MAX_HISTORY_TURNS * 2;
  const trimmedHistory =
    updatedHistory.length > maxLen
      ? updatedHistory.slice(-maxLen)
      : updatedHistory;

  // 7. Cost telemetry. Only TWO LLM calls in v2 (router + response).
  const cost = buildTurnCost([
    {
      label: "Router (classify + resolve)",
      usage: routeResult.usage ?? undefined,
      model: routeResult.model,
    },
    {
      label: "Response (reply)",
      usage: responseUsage,
      model: responseModel,
    },
  ]);

  // Finalize the top-level trace. Setting `output` on the trace makes
  // the dashboard's session view show the assistant reply as the
  // headline for this turn (instead of "<no output>"). The complete
  // tag list (including `branch:<intent>`) is set here, replacing the
  // initial set — the SDK's update REPLACES tags rather than appending.
  trace?.update({
    output: reply,
    metadata: {
      regionId,
      historyTurns: history.length,
      hasUserLocation: !!userLocation,
      intent: decision.intent,
      anchorWinerySlug: decision.anchorWinerySlug,
      anchorWineId: decision.anchorWineId,
      offCorpusWineryNamed: routeResult.diagnostics.offCorpusWineryNamed,
      clarifyingFired: !!decision.clarifyingQuestion,
      candidateCount: branchOutput.candidateCount,
      stopReason: finishReason,
      totalCostUsd: cost.total.usd.total,
      hasProposal: !!proposal,
      hasWineryCards: !!wineryCards,
    },
    tags: [
      "feature:concierge",
      envTag,
      `region:${regionId}`,
      "version:v2",
      `branch:${decision.intent}`,
      identity.userId ? "signed-in" : "anonymous",
    ],
  });

  return {
    reply,
    usage: responseUsage,
    stopReason: finishReason,
    routerDecision: decision,
    candidateCount: branchOutput.candidateCount,
    cost,
    proposal,
    wineryCards,
    history: trimmedHistory,
  };
  } catch (err) {
    // Tag the trace with the error so the dashboard's error filter
    // surfaces it. Re-throw so the HTTP layer in index.ts emits the
    // SSE `error` event the client expects.
    trace?.update({
      output: null,
      metadata: {
        error: err instanceof Error ? err.message : String(err),
      },
      tags: [
        "feature:concierge",
        envTag,
        `region:${regionId}`,
        "version:v2",
        "error",
        identity.userId ? "signed-in" : "anonymous",
      ],
    });
    throw err;
  } finally {
    // Flush Langfuse with a HARD TIMEOUT.
    //
    // Why this matters: the SDK's flushAsync() awaits a network round-
    // trip to Langfuse Cloud. When Langfuse is slow, unreachable, or
    // mid-incident, the SDK's internal retry loop will await for a
    // long time — observed up to 5 minutes in production logs. A bare
    // `await langfuse.flushAsync()` in finally means the orchestrator
    // never returns, the SSE stream never sends `done`, and Cloud Run
    // eventually truncates the response with a 120s timeout. The
    // client sees "stream ended without a `done` event" and the user's
    // chat hangs.
    //
    // Trade-off: when the timeout wins, we may lose this turn's trace
    // (the events are still in the SDK's internal queue and MAY land
    // on the next flush if the container is reused, but we can't
    // count on it). Losing telemetry is strictly better than losing
    // turns. The SDK's flushAt:1 + flushInterval:1000 settings also
    // mean events get a chance to land in the background even when
    // we don't await them.
    if (langfuse) {
      const FLUSH_TIMEOUT_MS = 3000;
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), FLUSH_TIMEOUT_MS)
      );
      try {
        const result = await Promise.race([
          langfuse.flushAsync().then(() => "ok" as const),
          timeoutPromise,
        ]);
        if (result === "timeout") {
          console.warn(
            `[v2] Langfuse flush exceeded ${FLUSH_TIMEOUT_MS}ms — abandoning for this turn` +
              (trace?.id ? ` (trace ${trace.id})` : "")
          );
        } else if (trace?.id) {
          console.info(`[v2] Langfuse trace flushed: ${trace.id}`);
        }
      } catch (flushErr) {
        console.warn("[v2] Langfuse flush failed:", flushErr);
      }
    }
  }
}
