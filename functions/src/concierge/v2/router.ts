// functions/src/concierge/v2/router.ts
// ─────────────────────────────────────────────────────────────────────────────
// ONE LLM call per turn. Folds in today's resolveCoreference call (which was
// a separate gpt-5.4-nano round-trip). Folds in the heuristic
// findFuzzyWineryMatches fallback (which was a substring match against
// winery names done AFTER the router emitted nameKeywords — three layers
// patching one extraction problem). The new shape is:
//
//   1. LLM call:
//        • rewrites the user's message into a self-contained query
//          (coref resolved inline using the last 4 history messages)
//        • classifies intent into one of 5 V2Intent enum values
//        • extracts structured filters: regions, tags, wineWords, dayOfWeek
//        • optionally surfaces a single clarifying question per stipulation #12
//      All as one structured tool call. No prose output.
//
//   2. Deterministic anchor resolution:
//        • nameIndex.lookupWinery(selfContainedQuery) → winery slug or null
//        • nameIndex.lookupWine(selfContainedQuery) → wine record or null
//        • Stipulation #1: winery hit wins over wine hit when both fire.
//        • Stipulation #2: a wine hit implicitly anchors on its winery.
//      The LLM never gets to pick the slug; that's what created today's
//      Tolpuddle/Abel-Tasman misses.
//
//   3. Reconciliation:
//        • If LLM says WINERY_FOCUS but no anchor resolved → keep the
//          intent (orchestrator branches to the off-corpus deflection
//          path per stipulation #4).
//        • If LLM says OUT_OF_SCOPE → force clarifyingQuestion to null.
//        • clarifyingQuestion is only allowed on TRIP / DISCOVERY (§3.3).
//
// Spec reference: §3 (router contract) in docs/concierge-rewrite-spec.md.
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from "openai";

import type { NameIndex } from "./nameIndex";
import type { RawUsage } from "../costTracker";
import { subRegionNames, type RegionConfig } from "../regionConfig";

const IS_DEV = process.env.NODE_ENV !== "production";

// One model for both jobs. The mini tier handles routing-shape problems
// fine and was already what the v1 router used; folding in the
// resolver's text-rewrite work doesn't push it harder than that.
// Override per-deploy via OPENAI_ROUTER_MODEL.
const ROUTER_MODEL = process.env.OPENAI_ROUTER_MODEL || "gpt-5.4-mini";

// Output budget. Tool-call args are tight (selfContainedQuery is the
// only field that could grow), and the clarifying question is one
// sentence when present. 350 is comfortable headroom.
const ROUTER_MAX_TOKENS = 350;

// How many trailing history messages to surface to the resolver part
// of this call. Matches today's resolveCoreference behaviour (4
// messages = 2 user/assistant pairs) so coref resolution stays
// behaviourally equivalent across the v1→v2 cutover.
const HISTORY_CONTEXT_TURNS = 4;

// ─── Public types ──────────────────────────────────────────────────────────

export type V2Intent =
  | "WINERY_FOCUS"
  | "DISCOVERY"
  | "TRIP"
  | "KNOWLEDGE"
  | "OUT_OF_SCOPE";

export const V2_INTENTS: readonly V2Intent[] = [
  "WINERY_FOCUS",
  "DISCOVERY",
  "TRIP",
  "KNOWLEDGE",
  "OUT_OF_SCOPE",
];

export const DAYS_OF_WEEK = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export const KNOWN_TAGS = [
  "dog-friendly",
  "restaurant",
  "organic",
  "biodynamic",
  "walk-ins",
  "award-winning",
  "tours",
  "featured",
] as const;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface V2RouteDecision {
  /** User message with coreference resolved inline. */
  selfContainedQuery: string;
  /** The branch the orchestrator runs. Exactly one. */
  intent: V2Intent;
  /**
   * The winery the turn anchors on. Set deterministically by the
   * post-LLM nameIndex lookup, NOT by the LLM. null when no anchor
   * resolved (either no name in the query, or a name that's not in
   * the corpus — orchestrator picks the right deflection path).
   */
  anchorWinerySlug: string | null;
  /**
   * Set ONLY when the anchor was resolved via a wine-name hit (not a
   * winery-name hit). The orchestrator uses this for the
   * stipulation-#5 fallback: when a user names a specific wine but it
   * isn't actually in the tasting-notes namespace, we still know
   * which wine they meant and can talk about its winery's style.
   */
  anchorWineId: string | null;
  regions: string[];
  tags: string[];
  wineWords: string[];
  dayOfWeek: string | null;
  /** One focused question, or null. Only ever populated for TRIP /
   *  DISCOVERY turns where the LLM judged it couldn't make a sensible
   *  recommendation with the given info (stipulation #12, narrowed). */
  clarifyingQuestion: string | null;
}

export interface V2RouteResult {
  decision: V2RouteDecision;
  usage: RawUsage | null;
  model: string;
  /**
   * Side-channel data the eval harness logs but the orchestrator
   * ignores. Tracks where each field came from (LLM vs. nameIndex) so
   * a misclassification can be traced back to the right layer.
   */
  diagnostics: {
    /** What the LLM raw-emitted before reconciliation. */
    llmIntent: V2Intent;
    /** Raw nameIndex result before the winery-wins tie-break. */
    nameIndexLookup: {
      winery: { slug: string; matchedTokens: string[] } | null;
      wine: { wineId: string; wineryId: string; name: string; matchedTokens: string[] } | null;
    };
    /** Set when the LLM said WINERY_FOCUS but the deterministic
     *  lookup found nothing — orchestrator routes to the off-corpus
     *  deflection path (stipulation #4). */
    offCorpusWineryNamed: boolean;
  };
}

const DEFAULT_DECISION: V2RouteDecision = {
  selfContainedQuery: "",
  intent: "DISCOVERY",
  anchorWinerySlug: null,
  anchorWineId: null,
  regions: [],
  tags: [],
  wineWords: [],
  dayOfWeek: null,
  clarifyingQuestion: null,
};

// ─── Tool schema (per region for the sub-region enum) ─────────────────────

function buildRouteTool(region: RegionConfig) {
  const subRegions = subRegionNames(region);
  const hasSubRegions = subRegions.length > 0;

  const properties: Record<string, unknown> = {
    selfContainedQuery: {
      type: "string",
      description:
        "The user's message rewritten so it stands alone. If their " +
        "message refers back to the conversation history (e.g. 'tell " +
        "me more', 'the first one', 'what about Saturday instead'), " +
        "resolve the references inline. If the message is already " +
        "self-contained, output it VERBATIM — do not paraphrase, " +
        "expand, or 'improve' it.",
    },
    intent: {
      type: "string",
      enum: V2_INTENTS as unknown as string[],
      description:
        "Exactly ONE of: " +
        "WINERY_FOCUS (user named a specific winery or wine and is " +
        "asking about it — includes 'tell me about X' and hours " +
        "lookups); " +
        "DISCOVERY (user wants recommendations without naming a " +
        "winery — by region, feature, varietal, or just 'what's " +
        "good'); " +
        "TRIP (user has clearly asked for a multi-stop itinerary — " +
        "'plan a day', a date plus context, etc.); " +
        "KNOWLEDGE (general question about wine, region, history, " +
        "etiquette, seasons — not about a specific winery); " +
        "OUT_OF_SCOPE (not about " + region.displayName + " wine " +
        "tourism at all).",
    },
  };

  if (hasSubRegions) {
    properties.regions = {
      type: "array",
      items: { type: "string", enum: subRegions },
      description:
        region.displayName +
        " sub-regions the user explicitly mentioned or strongly " +
        "implied. Empty array if none. Map shortcuts: 'near Hobart' " +
        "→ Coal River Valley + Derwent Valley + Huon Valley; 'near " +
        "Launceston' → Tamar Valley + Pipers River; 'east coast' / " +
        "'Freycinet' → East Coast.",
    };
  }

  properties.tags = {
    type: "array",
    items: { type: "string", enum: KNOWN_TAGS as unknown as string[] },
    description:
      "Feature tags the user explicitly cares about. " +
      "'dog' / 'pet' → dog-friendly; " +
      "'food' / 'lunch' / 'dinner' / 'restaurant' / 'kitchen' → restaurant; " +
      "'organic' → organic; " +
      "'biodynamic' → biodynamic; " +
      "'walk-in' / 'no booking' → walk-ins; " +
      "'award-winning' / 'Halliday' / 'decorated' / 'trophy' → award-winning; " +
      "'tour' / 'guided' / 'behind the scenes' → tours; " +
      "'best of' / 'top' / 'highlight' → featured (only when they " +
      "explicitly want marquee names).",
  };
  properties.wineWords = {
    type: "array",
    items: { type: "string" },
    description:
      "Lowercase fragments describing wines mentioned: varietals, " +
      "styles, vintages. Examples: ['chardonnay'], ['skin-contact', " +
      "'riesling'], ['2018', 'pinot'], ['sparkling']. Empty array if " +
      "no wine-specific terms appear.",
  };
  properties.dayOfWeek = {
    type: "string",
    enum: [...DAYS_OF_WEEK, "none"],
    description:
      "Three-letter weekday abbreviation if a specific day was " +
      "mentioned. 'today' / 'tomorrow' / 'this Sunday' map to the " +
      "obvious day. 'weekend' alone (ambiguous between Sat and Sun) " +
      "→ 'none'. 'none' when no day is mentioned.",
  };
  properties.clarifyingQuestion = {
    type: "string",
    description:
      "Exactly ONE focused question OR the string 'none'. Populate " +
      "ONLY when ALL of: " +
      "(a) intent is TRIP or DISCOVERY, " +
      "(b) the user has clearly asked for a recommendation or plan, " +
      "(c) there is not enough information to make a confident " +
      "recommendation (no region, no day, no party/occasion, no " +
      "varietal preference, no vibe modifier — NOTHING to anchor on). " +
      "If the user gave ANY of those signals, output 'none' and let " +
      "the recommender run. Curiosity questions, focused factual " +
      "questions, and questions with at least one constraint always " +
      "get 'none' — they don't need clarification.",
  };

  const required: string[] = [
    "selfContainedQuery",
    "intent",
    ...(hasSubRegions ? ["regions"] : []),
    "tags",
    "wineWords",
    "dayOfWeek",
    "clarifyingQuestion",
  ];

  return {
    type: "function" as const,
    function: {
      name: "route_query",
      description:
        "Classify the user's " + region.displayName + " wine-tourism " +
        "question and rewrite it to stand on its own. Always call " +
        "exactly once per turn. Never reply in prose.",
      parameters: {
        type: "object" as const,
        properties,
        required,
      },
    },
  };
}

// ─── System prompt ────────────────────────────────────────────────────────

function buildRouterSystemPrompt(region: RegionConfig): string {
  return `You are the routing classifier for the SipLocal Sommelier — the in-app
concierge for ${region.displayName} wine tourism. Your single job is to read
the user's question (with any conversation history) and emit ONE tool
call (\`route_query\`) with a structured classification.

You NEVER reply in prose. You NEVER answer the question yourself. You
ALWAYS emit exactly one tool call.

## selfContainedQuery — rewrite the message if needed

Apply the FRESH-READER TEST: would someone reading ONLY the new user
message — no history — be able to interpret it unambiguously? If yes,
output VERBATIM (no paraphrasing). If no, rewrite so a fresh reader
would understand both WHAT the user wants AND the relevant context
they're operating in.

The fresh-reader test catches more than pronouns. It also catches:
- Contrastive openings ("actually X", "no — Y", "wait, Z", "instead
  let's"). These declare a REPLACEMENT for something the fresh reader
  can't see. The rewrite must encode what the user is replacing AND
  the part of the previous context that should still hold.
- Definite articles referring to something not yet in the message
  ("the first", "the second one", "the plan").
- Implicit constraints from the previous turn ("what about Saturday
  instead?" carries the prior trip plan into Saturday).

Examples (these encode the rule — do not extend by adding more examples
to match new edge cases; instead apply the fresh-reader test consistently):

History:
  ASSISTANT: For sparkling, Bellebonne is the marquee pick. If you want,
    I can compare it with House of Arras and Jansz as benchmarks.
USER: yes do that
selfContainedQuery: "Compare Bellebonne with House of Arras and Jansz as
sparkling benchmarks."

History:
  ASSISTANT: I'd start at Tolpuddle, then head to Pooley for lunch.
USER: what about Saturday instead?
selfContainedQuery: "Would the Tolpuddle then Pooley plan still work on
Saturday?"

History:
  ASSISTANT: Three options near Hobart: Stefano Lubiana, Frogmore Creek,
    or Pooley.
USER: the first
selfContainedQuery: "Tell me more about Stefano Lubiana."

History:
  ASSISTANT: A pinot day in the Coal River Valley: Pooley, Pressing
    Matters, Frogmore Creek for lunch.
USER: actually let's do sparkling
selfContainedQuery: "Plan a sparkling-focused day in the Coal River
Valley instead of pinot."
(Contrastive opening "actually" — the rewrite carries forward the
region ("Coal River Valley") and trip framing ("day") from the prior
turn, AND encodes the replacement ("sparkling instead of pinot").)

## intent — pick exactly one

- **WINERY_FOCUS** — user named a specific winery (e.g. "Tolpuddle",
  "Pooley", "Frogmore Creek") OR named a specific wine (e.g. "Abel
  Tasman Pinot Noir", "1830 Chardonnay"). Includes hours lookups,
  "tell me about X", "is X open Sunday", "what's X's pinot like".
  Also includes off-corpus producers ("tell me about House of Arras")
  — they're still WINERY_FOCUS; the downstream code decides what to do.

- **DISCOVERY** — user wants RECOMMENDATIONS without anchoring on a
  specific winery. Sub-region queries ("what's good in Tamar Valley"),
  feature filters ("dog-friendly", "biodynamic with a kitchen"),
  varietal classes ("chardonnay producers", "skin-contact riesling"),
  generic "what's good?".

- **TRIP** — user has clearly asked for a multi-stop itinerary. Real
  signals: "plan a day", "where should I go", a date or day-of-week
  PLUS context ("Saturday with my partner"), "two-day trip", "weekend
  in Tasmania", "where should we base ourselves". A casual "what's
  good for a Saturday" without trip framing is DISCOVERY, not TRIP.

- **KNOWLEDGE** — general wine / regional / history / etiquette /
  seasons question with no specific winery referenced. "Why is
  Tasmania good for sparkling?", "When's harvest?", "What's the
  difference between Tamar and Pipers River?", "What's pinot noir?".
  If they ALSO name a winery, use WINERY_FOCUS — the winery anchor
  wins.

- **OUT_OF_SCOPE** — not about ${region.displayName} wine tourism.
  Weather, email writing, restaurants in other cities, software help,
  etc. Use sparingly — most wine-adjacent topics (food near wineries,
  drive times, seasons, local produce) are IN scope.

Tie-breakers when signals overlap:
- Named winery + recommendation request → WINERY_FOCUS.
- Named winery + planning intent → TRIP (the trip is the active intent;
  the winery is treated as the anchor by downstream code).
- Named varietal/wine + no specific winery → DISCOVERY.

## regions

Only the sub-regions the user EXPLICITLY mentioned or strongly implied.
Do NOT infer the region from a winery name — let downstream retrieval
handle that.

## tags

Only feature flags the user actually said they care about. Don't add
"featured" just because someone asked for "good wineries" — every
winery here is good.

## wineWords

Lowercase varietals / styles / vintages the user mentioned. Empty
array if they didn't say anything wine-specific.

## dayOfWeek

3-letter abbreviation if a specific day was named. "today" / "tomorrow"
/ "this Sunday" all map to a specific day. "weekend" alone is
ambiguous — use "none".

## clarifyingQuestion — narrow contract, default 'none'

Output a question ONLY when ALL THREE hold:
1. Intent is TRIP or DISCOVERY.
2. User has clearly asked for a recommendation or plan.
3. There is genuinely not enough info to make a confident
   recommendation — no region, no day, no party/occasion, no
   varietal preference, no vibe modifier.

Otherwise output the string "none". Curiosity questions, focused
factual questions, hours lookups, named-winery questions, KNOWLEDGE
turns, and ANY question with at least one constraint always get "none".

When you DO ask, make it ONE focused question that would unblock the
recommendation. The HIGHEST-VALUE thing to ask is almost always
WHERE THE USER IS (their starting point or base) — drive times and
sub-region choice depend on it, and it's the one piece of info that
makes the recommendation actionable. Default to that question.

- "Plan a day" with no day, no region, no preferences → "When are you
  thinking, and where in Tasmania are you based or starting from?"
- "What's good?" / "Where should I go?" with no other context → "Where
  in Tasmania are you based or starting from?"
- Don't ask about style preferences (pinot vs chardonnay, etc.) unless
  the user has otherwise signalled they want a wine-specific
  recommendation. Most users want a "good day" experience, not a
  varietal-anchored one.

NOTE: When the user already has a GPS location available, the
orchestrator MAY override your clarifying question and use the
location instead. Your job is still to emit a clarifying question
when the rules above apply; the orchestrator decides whether to use
it. Don't second-guess.

## Examples

Notation: every example lists ALL emitted fields. ${
    subRegionNames(region).length > 0 ? "" : "(No regions field for flat regions.)"
  }

User: "Is Tolpuddle open Sunday?"
selfContainedQuery="Is Tolpuddle open Sunday?", intent=WINERY_FOCUS,
${subRegionNames(region).length > 0 ? "regions=[], " : ""}tags=[], wineWords=[], dayOfWeek=Sun, clarifyingQuestion=none

User: "wine recommendations from bangor vineyard shed"
selfContainedQuery="wine recommendations from bangor vineyard shed",
intent=WINERY_FOCUS, ${subRegionNames(region).length > 0 ? "regions=[], " : ""}tags=[], wineWords=[], dayOfWeek=none,
clarifyingQuestion=none

User: "abel tasman pinot noir"
selfContainedQuery="abel tasman pinot noir", intent=WINERY_FOCUS,
${subRegionNames(region).length > 0 ? "regions=[], " : ""}tags=[], wineWords=["pinot","noir"], dayOfWeek=none,
clarifyingQuestion=none
(Wine name detected → WINERY_FOCUS, downstream finds the owning winery.)

User: "Tell me about House of Arras"
selfContainedQuery="Tell me about House of Arras",
intent=WINERY_FOCUS, ${subRegionNames(region).length > 0 ? "regions=[], " : ""}tags=[], wineWords=[],
dayOfWeek=none, clarifyingQuestion=none
(Off-corpus producer named — still WINERY_FOCUS; deflection path runs.)

User: "Dog-friendly cellar doors with a restaurant"
intent=DISCOVERY, ${subRegionNames(region).length > 0 ? "regions=[], " : ""}tags=["dog-friendly","restaurant"],
wineWords=[], dayOfWeek=none, clarifyingQuestion=none

User: "What's good in Coal River Valley?"
intent=DISCOVERY, ${subRegionNames(region).length > 0 ? `regions=["Coal River Valley"], ` : ""}tags=[],
wineWords=[], dayOfWeek=none, clarifyingQuestion=none

User: "skin-contact riesling producers in Tasmania"
intent=DISCOVERY, ${subRegionNames(region).length > 0 ? "regions=[], " : ""}tags=[],
wineWords=["skin-contact","riesling"], dayOfWeek=none,
clarifyingQuestion=none

User: "Plan a Saturday from Hobart, partner and I, love pinot"
intent=TRIP, ${subRegionNames(region).length > 0 ? `regions=["Coal River Valley","Derwent Valley","Huon Valley"], ` : ""}tags=[],
wineWords=["pinot"], dayOfWeek=Sat, clarifyingQuestion=none

User: "Plan a day"
intent=TRIP, ${subRegionNames(region).length > 0 ? "regions=[], " : ""}tags=[], wineWords=[], dayOfWeek=none,
clarifyingQuestion="When are you thinking, and where in Tasmania are you based or starting from?"
(All three clarifying conditions met — no day, no region, no preferences.)

User: "What's good?"
intent=DISCOVERY, ${subRegionNames(region).length > 0 ? "regions=[], " : ""}tags=[], wineWords=[], dayOfWeek=none,
clarifyingQuestion="Where in Tasmania are you based or starting from?"
(No region, no tags, no varietal — but the orchestrator may override
this clarifying question if it has a GPS location for the user.
Ask anyway; let the orchestrator decide.)

User: "Why is Tasmania so good for sparkling?"
intent=KNOWLEDGE, ${subRegionNames(region).length > 0 ? "regions=[], " : ""}tags=[], wineWords=["sparkling"],
dayOfWeek=none, clarifyingQuestion=none

User: "What's the weather in Hobart tomorrow?"
intent=OUT_OF_SCOPE, ${subRegionNames(region).length > 0 ? "regions=[], " : ""}tags=[], wineWords=[],
dayOfWeek=none, clarifyingQuestion=none

Now classify the next user message and emit exactly one route_query
tool call.`;
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface V2RouteOptions {
  client: OpenAI;
  region: RegionConfig;
  history: ChatMessage[];
  nameIndex: NameIndex;
  model?: string;
}

/**
 * Route a single concierge turn.
 *
 * Fail-soft: any LLM / parse error returns a sensible default
 * (DISCOVERY intent, empty filters, the original message echoed as
 * selfContainedQuery). The orchestrator's discovery branch is a safe
 * fallback — it won't crash on bad routing, just produce a less
 * targeted answer.
 */
export async function routeV2(
  userMessage: string,
  opts: V2RouteOptions
): Promise<V2RouteResult> {
  const client = opts.client;
  const region = opts.region;
  const model = opts.model || ROUTER_MODEL;
  const tool = buildRouteTool(region);
  const systemPrompt = buildRouterSystemPrompt(region);

  // Build the messages array. History is surfaced inline as a
  // conversation transcript inside the user turn rather than as
  // OpenAI-shaped role messages, so the model treats the whole thing
  // as a routing input rather than trying to continue the chat.
  const recentHistory = opts.history.slice(-HISTORY_CONTEXT_TURNS);
  const userTurnContent = recentHistory.length > 0
    ? `History:\n${recentHistory
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n")}\n\nUSER: ${userMessage}`
    : userMessage;

  let llmResult: {
    args: Partial<RouterArgs>;
    usage: RawUsage | null;
  };
  try {
    llmResult = await callRouter({
      client,
      model,
      tool,
      systemPrompt,
      userTurnContent,
    });
  } catch (err) {
    if (IS_DEV) {
      console.warn("[concierge:router] LLM call failed; using default:", err);
    }
    return makeFallbackResult(userMessage, model, opts.nameIndex);
  }

  // Normalise the LLM output against the region whitelist + enums.
  const normalised = normaliseDecision(llmResult.args, userMessage, region);

  // Deterministic anchor resolution against the corpus.
  const wineryHit = opts.nameIndex.lookupWinery(normalised.selfContainedQuery);
  const wineHit = opts.nameIndex.lookupWine(normalised.selfContainedQuery);

  let anchorWinerySlug: string | null = null;
  let anchorWineId: string | null = null;
  if (wineryHit) {
    // Stipulation #1: winery wins.
    anchorWinerySlug = wineryHit.slug;
  } else if (wineHit) {
    // Stipulation #2: wine implicitly anchors on its winery.
    anchorWinerySlug = wineHit.wineryId;
    anchorWineId = wineHit.wineId;
  }

  // Reconciliation rules:
  //   • OUT_OF_SCOPE turns never carry a clarifyingQuestion.
  //   • KNOWLEDGE turns also never clarify (factual/curiosity).
  //   • clarifyingQuestion is only allowed on TRIP / DISCOVERY (§3.3).
  let clarifyingQuestion = normalised.clarifyingQuestion;
  if (
    normalised.intent !== "TRIP" &&
    normalised.intent !== "DISCOVERY"
  ) {
    clarifyingQuestion = null;
  }

  // Diagnostics — used by the eval harness, ignored by the orchestrator.
  const offCorpusWineryNamed =
    normalised.intent === "WINERY_FOCUS" && anchorWinerySlug === null;

  const decision: V2RouteDecision = {
    selfContainedQuery: normalised.selfContainedQuery,
    intent: normalised.intent,
    anchorWinerySlug,
    anchorWineId,
    regions: normalised.regions,
    tags: normalised.tags,
    wineWords: normalised.wineWords,
    dayOfWeek: normalised.dayOfWeek,
    clarifyingQuestion,
  };

  return {
    decision,
    usage: llmResult.usage,
    model,
    diagnostics: {
      llmIntent: normalised.intent,
      nameIndexLookup: {
        winery: wineryHit
          ? { slug: wineryHit.slug, matchedTokens: wineryHit.matchedTokens }
          : null,
        wine: wineHit
          ? {
              wineId: wineHit.wineId,
              wineryId: wineHit.wineryId,
              name: wineHit.name,
              matchedTokens: wineHit.matchedTokens,
            }
          : null,
      },
      offCorpusWineryNamed,
    },
  };
}

// ─── Internals ────────────────────────────────────────────────────────────

interface RouterArgs {
  selfContainedQuery: string;
  intent: V2Intent;
  regions: string[];
  tags: string[];
  wineWords: string[];
  dayOfWeek: string;
  clarifyingQuestion: string;
}

async function callRouter(args: {
  client: OpenAI;
  model: string;
  tool: ReturnType<typeof buildRouteTool>;
  systemPrompt: string;
  userTurnContent: string;
}): Promise<{ args: Partial<RouterArgs>; usage: RawUsage | null }> {
  const response = await args.client.chat.completions.create({
    model: args.model,
    max_completion_tokens: ROUTER_MAX_TOKENS,
    tool_choice: { type: "function", function: { name: "route_query" } },
    tools: [args.tool],
    messages: [
      { role: "system", content: args.systemPrompt },
      { role: "user", content: args.userTurnContent },
    ],
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  const usage = extractUsage(response.usage);

  if (!toolCall || toolCall.type !== "function") {
    return { args: {}, usage };
  }

  let parsed: Partial<RouterArgs> = {};
  try {
    parsed = JSON.parse(toolCall.function.arguments || "{}");
  } catch (err) {
    if (IS_DEV) {
      console.warn("[concierge:router] tool args were not valid JSON:", err);
    }
  }
  return { args: parsed, usage };
}

function normaliseDecision(
  raw: Partial<RouterArgs>,
  originalMessage: string,
  region: RegionConfig
): {
  selfContainedQuery: string;
  intent: V2Intent;
  regions: string[];
  tags: string[];
  wineWords: string[];
  dayOfWeek: string | null;
  clarifyingQuestion: string | null;
} {
  // selfContainedQuery — fall through to original if the LLM emitted
  // an empty rewrite. Better to lose coref than lose the query entirely.
  const selfContainedQuery =
    typeof raw.selfContainedQuery === "string" &&
    raw.selfContainedQuery.trim().length > 0
      ? raw.selfContainedQuery.trim()
      : originalMessage;

  // intent — whitelist against the enum; default to DISCOVERY (safe
  // fallback branch) on anything unrecognised.
  const intent: V2Intent = (V2_INTENTS as readonly string[]).includes(
    raw.intent as string
  )
    ? (raw.intent as V2Intent)
    : "DISCOVERY";

  // regions — drop anything not in the active region's sub-region list.
  // For flat regions, knownSubRegions is empty and everything gets
  // dropped — the tool schema also omits the field, so raw.regions is
  // usually undefined here.
  const knownSubRegions = subRegionNames(region);
  const regions = Array.isArray(raw.regions)
    ? raw.regions
        .map((r) => String(r).trim())
        .filter((r) => knownSubRegions.includes(r))
    : [];

  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((t) => String(t).trim().toLowerCase())
        .filter((t) => (KNOWN_TAGS as readonly string[]).includes(t))
    : [];

  const wineWords = Array.isArray(raw.wineWords)
    ? raw.wineWords
        .map((w) => String(w).trim().toLowerCase())
        .filter((w) => w.length >= 2 && w.length <= 40)
    : [];

  // dayOfWeek — accept the enum strings, normalise "none"/"" to null.
  const dayRaw = String(raw.dayOfWeek ?? "none").trim();
  const dayOfWeek =
    dayRaw &&
    dayRaw.toLowerCase() !== "none" &&
    (DAYS_OF_WEEK as readonly string[]).includes(dayRaw)
      ? dayRaw
      : null;

  // clarifyingQuestion — treat 'none' / '' / null as no question.
  const qRaw = String(raw.clarifyingQuestion ?? "none").trim();
  const clarifyingQuestion =
    qRaw && qRaw.toLowerCase() !== "none" ? qRaw : null;

  return {
    selfContainedQuery,
    intent,
    regions,
    tags,
    wineWords,
    dayOfWeek,
    clarifyingQuestion,
  };
}

function makeFallbackResult(
  userMessage: string,
  model: string,
  nameIndex: NameIndex
): V2RouteResult {
  // Even on LLM failure, try the deterministic lookup against the
  // original message — if the user did name a winery, downstream
  // retrieval can still anchor correctly. Worst case, we end up in
  // the DISCOVERY branch with no anchor, which is a safe no-op.
  const wineryHit = nameIndex.lookupWinery(userMessage);
  const wineHit = nameIndex.lookupWine(userMessage);

  let anchorWinerySlug: string | null = null;
  let anchorWineId: string | null = null;
  if (wineryHit) {
    anchorWinerySlug = wineryHit.slug;
  } else if (wineHit) {
    anchorWinerySlug = wineHit.wineryId;
    anchorWineId = wineHit.wineId;
  }

  const intent: V2Intent = anchorWinerySlug ? "WINERY_FOCUS" : "DISCOVERY";

  return {
    decision: {
      ...DEFAULT_DECISION,
      selfContainedQuery: userMessage,
      intent,
      anchorWinerySlug,
      anchorWineId,
    },
    usage: null,
    model,
    diagnostics: {
      llmIntent: intent,
      nameIndexLookup: {
        winery: wineryHit
          ? { slug: wineryHit.slug, matchedTokens: wineryHit.matchedTokens }
          : null,
        wine: wineHit
          ? {
              wineId: wineHit.wineId,
              wineryId: wineHit.wineryId,
              name: wineHit.name,
              matchedTokens: wineHit.matchedTokens,
            }
          : null,
      },
      offCorpusWineryNamed:
        intent === "WINERY_FOCUS" && anchorWinerySlug === null,
    },
  };
}

function extractUsage(
  rawUsage: OpenAI.Completions.CompletionUsage | undefined
): RawUsage | null {
  if (!rawUsage) return null;
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
