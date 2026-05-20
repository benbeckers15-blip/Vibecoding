// functions/src/concierge/router.ts
// ─────────────────────────────────────────────────────────────────────────────
// The cheap classifier turn — a small model call that reads the user's
// question and emits a structured `RouteDecision` (intent + filters)
// the orchestrator uses to retrieve the right wineries.
//
// MULTI-REGION REFACTOR (Phase 2):
//   The list of valid `regions` (sub-region enum in the tool schema +
//   the post-call validator) now comes from the per-region RegionConfig
//   passed in by the caller. The router gracefully handles flat regions
//   by dropping the `regions` field from the tool schema entirely when
//   `subRegions` is empty.
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from "openai";
import type { RawUsage } from "./costTracker";
import { subRegionNames, type RegionConfig } from "./regionConfig";

const IS_DEV = process.env.NODE_ENV !== "production";

const ROUTER_MODEL =
  process.env.OPENAI_ROUTER_MODEL || "gpt-5.4-mini";

const ROUTER_MAX_TOKENS = 256;

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

export const DAYS_OF_WEEK = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export type RouteIntent =
  | "specific_winery"
  | "regional"
  | "feature"
  | "itinerary"
  | "general"
  | "out_of_scope";

export interface RouteRetrievalFlags {
  descriptions: boolean;
  tastingNotes: boolean;
}

export interface RouteDecision {
  intent: RouteIntent;
  regions: string[];
  tags: string[];
  nameKeywords: string[];
  dayOfWeek: string | null;
  retrieval: RouteRetrievalFlags;
  wineKeywords: string[];
  limit: number;
}

export interface RouteResult {
  decision: RouteDecision;
  usage: RawUsage | null;
  model: string;
}

const DEFAULT_DECISION: RouteDecision = {
  intent: "general",
  regions: [],
  tags: [],
  nameKeywords: [],
  dayOfWeek: null,
  retrieval: { descriptions: false, tastingNotes: false },
  wineKeywords: [],
  limit: 12,
};

/**
 * Build the tool schema for the router call. Per-region because the
 * `regions` field's enum (and required-ness) depends on whether the
 * active region has sub-regions.
 *
 * For a flat region (no sub-regions), the `regions` field is omitted
 * entirely — there's nothing for the model to populate, and including
 * it as an empty enum would just confuse the call.
 */
function buildRouteTool(region: RegionConfig) {
  const regionNames = subRegionNames(region);
  const hasSubRegions = regionNames.length > 0;

  const baseProperties: Record<string, unknown> = {
    intent: {
      type: "string",
      enum: [
        "specific_winery",
        "regional",
        "feature",
        "itinerary",
        "general",
        "out_of_scope",
      ],
      description:
        `Coarse intent. Use 'specific_winery' when the user names ` +
        `one or more wineries. Use 'itinerary' when they want a day ` +
        `or trip planned. Use 'out_of_scope' only for questions ` +
        `unrelated to ${region.displayName} wine tourism.`,
    },
  };

  if (hasSubRegions) {
    baseProperties.regions = {
      type: "array",
      items: {
        type: "string",
        enum: regionNames,
      },
      description:
        `${region.displayName} sub-regions the user mentioned or strongly ` +
        `implied. Empty array if no region was specified.`,
    };
  }

  const properties: Record<string, unknown> = {
    ...baseProperties,
    tags: {
      type: "array",
      items: {
        type: "string",
        enum: KNOWN_TAGS as unknown as string[],
      },
      description:
        "Feature tags the user cares about. 'dog-friendly' if they " +
        "mentioned dogs/pets; 'restaurant' for food/lunch/dinner; " +
        "'walk-ins' for spontaneous visits; 'organic' or " +
        "'biodynamic' if those are mentioned; 'award-winning' when " +
        "the user explicitly asks for award-winning / decorated / " +
        "Halliday-rated / show-winning producers; 'tours' when the " +
        "user wants a guided tour, vineyard walk, behind-the-scenes " +
        "experience, or anything beyond a tasting-only visit.",
    },
    nameKeywords: {
      type: "array",
      items: { type: "string" },
      description:
        "Lowercase fragments of winery names the user asked about. " +
        "Include only when the user actually mentioned a winery by " +
        "name. Single words or short phrases — e.g. ['tolpuddle'], " +
        "['domaine', 'a'] for Domaine A.",
    },
    dayOfWeek: {
      type: "string",
      enum: [...DAYS_OF_WEEK, "none"],
      description:
        "Three-letter day abbreviation if the user asked about a " +
        "specific day (e.g. 'Sun' for Sunday). 'none' otherwise.",
    },
    retrieveDescriptions: {
      type: "boolean",
      description:
        "Set TRUE when the user wants rich editorial prose about a " +
        "winery — vibe queries ('intimate', 'with a view', 'first-" +
        "date'), 'tell me about <winery>', anniversary / special-" +
        "occasion framing, or anything the structured tags can't " +
        "capture. Set FALSE for routine filter queries ('open " +
        "Tuesday', 'dog-friendly', 'Coal River Valley wineries') — " +
        "the world index + structured rows are enough.",
    },
    retrieveTastingNotes: {
      type: "boolean",
      description:
        "Set TRUE whenever the user mentions a specific wine, " +
        "varietal, vintage, or style — chardonnay, pinot, sparkling, " +
        "skin-contact, '2018', single-vineyard, etc. Also set TRUE " +
        "when the user asks what a winery's wines are actually like. " +
        "Set FALSE when no wine-specific terms are mentioned.",
    },
    wineKeywords: {
      type: "array",
      items: { type: "string" },
      description:
        "Lowercase fragments describing wines the user mentioned: " +
        "varietals, styles, vintages. Examples: ['chardonnay'], " +
        "['skin-contact', 'riesling'], ['2018'], ['sparkling']. " +
        "Empty array if no wine-specific terms appear. Only consulted " +
        "when retrieveTastingNotes is true.",
    },
  };

  const required: string[] = [
    "intent",
    ...(hasSubRegions ? ["regions"] : []),
    "tags",
    "nameKeywords",
    "dayOfWeek",
    "retrieveDescriptions",
    "retrieveTastingNotes",
    "wineKeywords",
  ];

  return {
    type: "function" as const,
    function: {
      name: "route_query",
      description:
        `Classify the user's wine-tourism question and extract filters ` +
        `that can be applied to a list of ${region.displayName} wineries. ` +
        `Always call this tool exactly once per turn.`,
      parameters: {
        type: "object" as const,
        properties,
        required,
      },
    },
  };
}

const ROUTER_SYSTEM_PROMPT = `You are the routing classifier for the
SipLocal Sommelier — an in-app concierge that helps users plan visits
to Tasmanian wineries. Your single job is to read the user's question
and call the \`route_query\` tool exactly once with a structured
classification of what they're asking for.

You never reply in prose. You never answer the question yourself. You
never call any tool other than route_query. You always emit exactly
one tool call.

## How to think about each field

### intent (the most important field)

Pick the intent that best matches what the user is actually asking
for. When in doubt between two, prefer the more specific one.

- "specific_winery": the user named one or more wineries by name and
  is asking about THOSE wineries. Examples: "Is Tolpuddle open
  Sunday?", "Tell me about Pooley", "Domaine A vs Stefano Lubiana —
  which would you pick for a date night?"
- "regional": the user named a sub-region and wants suggestions in
  that region. Examples: "What's good in the Tamar Valley?", "Coal
  River Valley pinot recs", "Anywhere near Launceston worth a stop?"
- "feature": the user is filtering by a feature/attribute, not a
  region. Examples: "Dog-friendly cellar doors", "Anywhere with a
  proper restaurant?", "Biodynamic places", "Walk-in welcome on a
  Sunday".
- "itinerary": the user is asking you to plan a day, weekend, or
  multi-stop visit. Examples: "Plan a Saturday from Hobart",
  "Three-day wine trip", "Where should we base ourselves for a
  long weekend?", "Itinerary for two cruise-ship hours in port".
- "general": open-ended discovery with no clear filter. Examples:
  "What's Tasmanian wine like?", "Anything good?", "We just got here
  — where do we start?"
- "out_of_scope": NOT about Tasmanian wine tourism. Examples:
  "Recommend a Margaret River winery", "What's the weather?", "Help
  me write an email." Use this sparingly — most wine-adjacent
  questions (food, accommodation near wineries, drive times) are IN
  scope and should be one of the wine intents above.

### regions

Only include regions the user EXPLICITLY mentioned or strongly
implied. Do NOT infer the region from a winery name (the retrieval
step handles that). If the user says "near Hobart" or "from
Launceston," map to the obvious sub-regions:

- "near Hobart" / "from Hobart" / "day from Hobart" → Coal River
  Valley + Derwent Valley + Huon Valley (the three day-trip
  regions from Hobart).
- "near Launceston" / "from Launceston" → Tamar Valley + Pipers
  River.
- "east coast" / "Freycinet" / "Bicheno" / "Swansea" → East Coast.
- Otherwise: empty array.

Be strict — when a user just says "Tasmania" with no sub-region
hint, leave this empty.

### tags

Map feature mentions to tags. Be tight, not generous — only include
a tag if the user clearly cares about that feature:

- "dog" / "pet" / "puppy" / "with our dog" → dog-friendly
- "food" / "lunch" / "dinner" / "restaurant" / "eat" / "kitchen" → restaurant
- "organic" → organic
- "biodynamic" / "natural wine making" → biodynamic
- "walk-in" / "no booking" / "spontaneous" / "without a reservation" → walk-ins
- "award-winning" / "awarded" / "decorated" / "Halliday" / "show winner" /
  "trophy" / "prize-winning" / "highly rated" (when it clearly means
  judged-rated, not user-rated) → award-winning
- "tour" / "tours" / "vineyard tour" / "winery tour" / "guided" /
  "behind the scenes" / "vineyard walk" / "show us around" → tours
  (only when they want a guided experience beyond a tasting — a plain
  "we want to taste some wine" is NOT a tours request)
- "best of" / "top" / "must-do" / "highlight" → featured (only when
  they explicitly want the marquee names; don't add this just
  because someone wants "good" wineries — every winery in the
  dataset is good)

Don't infer "restaurant" from "long lunch" if no food is mentioned —
"lunch" alone is enough to add restaurant. Don't add "featured"
just because someone asks for "recommendations."

### nameKeywords

Only populate when the user said a winery's name. Use lowercase
fragments — single words for one-word names, the distinctive part
of multi-word names. Examples:

- "Is Tolpuddle open?" → ["tolpuddle"]
- "Domaine A is great, anything similar?" → ["domaine", "a"]
- "Pooley vs Frogmore Creek" → ["pooley", "frogmore"]
- "What's Tasmania got?" → []  (no winery named)

Be strict. Do not invent winery names you're unsure about. If the
user describes a winery without naming it ("that biodynamic place
with the chickens"), leave nameKeywords empty and let the vector
search handle it.

### dayOfWeek

Three-letter abbreviation (Mon/Tue/Wed/Thu/Fri/Sat/Sun) if the user
asked about a specific day. "Today" or "tomorrow" or "this Sunday"
all map to the obvious day; if you cannot tell what day they mean
("on the weekend" — ambiguous between Sat and Sun), use "none".

Use "none" — NOT an empty string — when no day is mentioned.

### retrieveDescriptions

Editorial prose about a winery (atmosphere, the building, the
owners' story, what the room feels like) lives in a separate
retrieval path. Set this flag TRUE only when the user's question
requires that kind of texture to answer well.

TRUE when:
- The query is vibe-shaped: "somewhere intimate," "with a view,"
  "quiet," "romantic," "great for a first date / anniversary /
  birthday," "small producer feel."
- The user names a winery and wants to know what it's like:
  "Tell me about Stefano Lubiana," "What's Pooley's room like?",
  "Is Domaine A worth the drive?"
- The user asks for personality / character / story.

FALSE when:
- Pure filter query: "open Tuesday," "dog-friendly," "Coal River
  Valley wineries," "anywhere with a restaurant."
- Hours / factual / yes-no lookups: "Is Tolpuddle open Sunday?"
- Itinerary requests with no vibe modifier ("plan a Saturday in
  Tamar Valley") — set FALSE, the structured rows are enough.
- Out-of-scope.

### retrieveTastingNotes

Wine-level data (varietals each winery makes, specific bottles,
vintages, style notes) lives in a separate retrieval path. Set
this flag TRUE whenever the user mentions wine in any specific way.

TRUE when:
- Varietal is named: "chardonnay producers," "skin-contact
  riesling," "pinot day," "where's the best sparkling?"
- A vintage, style, or wine technique is mentioned: "2018s,"
  "natural wine," "single-vineyard," "oaked vs unoaked."
- The user asks what a winery's wines are actually like:
  "What's Frogmore's pinot like?", "Are Tolpuddle's chardonnays
  approachable?"

FALSE when:
- Wine isn't mentioned at all (just regions, features, hours).
- "Good wine" / "best wines" used generically with no varietal
  or style.

retrieveTastingNotes and retrieveDescriptions can BOTH be TRUE on
the same turn (e.g. "tell me about Frogmore's chardonnay" → both).

### wineKeywords

Only populate when retrieveTastingNotes is TRUE. Lowercase
fragments describing wines mentioned in the query.

Examples:
- "Chardonnay producers in Tasmania" → ["chardonnay"]
- "Skin-contact riesling" → ["skin-contact", "riesling"]
- "Best 2018 pinot" → ["2018", "pinot"]
- "Sparkling specialists" → ["sparkling"]
- "What's Frogmore's pinot like?" → ["pinot"]

Empty array if no wine-specific terms appear in the user's message.

## Examples (study these — they encode the rules above)

Notation: every example lists ALL eight fields. retrieveDescriptions
and retrieveTastingNotes default to false; wineKeywords defaults to [].

User: "Is Tolpuddle open Sunday?"
→ intent=specific_winery, regions=[], tags=[], nameKeywords=["tolpuddle"], dayOfWeek=Sun,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]
  (hours lookup — filter is enough)

User: "We're spending Saturday driving from Hobart, love pinot, want a proper lunch."
→ intent=itinerary, regions=["Coal River Valley","Derwent Valley","Huon Valley"], tags=["restaurant"], nameKeywords=[], dayOfWeek=Sat,
  retrieveDescriptions=false, retrieveTastingNotes=true, wineKeywords=["pinot"]
  (varietal mentioned → tasting notes; itinerary doesn't need descriptions)

User: "Dog-friendly cellar doors?"
→ intent=feature, regions=[], tags=["dog-friendly"], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "What's good in Coal River Valley?"
→ intent=regional, regions=["Coal River Valley"], tags=[], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "Biodynamic spots in the Tamar Valley with food?"
→ intent=regional, regions=["Tamar Valley"], tags=["biodynamic","restaurant"], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "Tell me about Stefano Lubiana"
→ intent=specific_winery, regions=[], tags=[], nameKeywords=["stefano","lubiana"], dayOfWeek=none,
  retrieveDescriptions=true, retrieveTastingNotes=false, wineKeywords=[]
  ("tell me about X" → descriptions on)

User: "What's Frogmore Creek's pinot like?"
→ intent=specific_winery, regions=[], tags=[], nameKeywords=["frogmore"], dayOfWeek=none,
  retrieveDescriptions=true, retrieveTastingNotes=true, wineKeywords=["pinot"]
  (both — describes the place AND the wine)

User: "Somewhere intimate for an anniversary"
→ intent=general, regions=[], tags=[], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=true, retrieveTastingNotes=false, wineKeywords=[]
  (pure vibe query — descriptions on)

User: "Who makes the best chardonnay in Tasmania?"
→ intent=general, regions=[], tags=[], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=true, wineKeywords=["chardonnay"]

User: "Find me a skin-contact riesling producer"
→ intent=feature, regions=[], tags=[], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=true, wineKeywords=["skin-contact","riesling"]

User: "We just got into Launceston, what should we do?"
→ intent=general, regions=["Tamar Valley","Pipers River"], tags=[], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "Plan a long weekend — Friday to Sunday, starting in Hobart, ending in Launceston."
→ intent=itinerary, regions=["Coal River Valley","Derwent Valley","Huon Valley","East Coast","Tamar Valley","Pipers River"], tags=[], nameKeywords=[], dayOfWeek=Fri,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "Where can we walk in on a Sunday without a booking?"
→ intent=feature, regions=[], tags=["walk-ins"], nameKeywords=[], dayOfWeek=Sun,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "Any award-winning wineries in the Tamar?"
→ intent=regional, regions=["Tamar Valley"], tags=["award-winning"], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "Which cellar doors run tours of the vineyard?"
→ intent=feature, regions=[], tags=["tours"], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "We want a guided tour, ideally somewhere that's won awards."
→ intent=feature, regions=[], tags=["tours","award-winning"], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "What's the weather in Hobart tomorrow?"
→ intent=out_of_scope, regions=[], tags=[], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "Anywhere good in Margaret River?"
→ intent=out_of_scope, regions=[], tags=[], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "Pooley vs Frogmore Creek — which kitchen is better?"
→ intent=specific_winery, regions=[], tags=["restaurant"], nameKeywords=["pooley","frogmore"], dayOfWeek=none,
  retrieveDescriptions=true, retrieveTastingNotes=false, wineKeywords=[]
  ("which kitchen is better" needs personality / texture → descriptions on)

User: "Sparkling specialists?"
→ intent=feature, regions=[], tags=[], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=true, wineKeywords=["sparkling"]

User: "Best places near Freycinet for a Wednesday lunch?"
→ intent=regional, regions=["East Coast"], tags=["restaurant"], nameKeywords=[], dayOfWeek=Wed,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "Cruise-ship-friendly recs — we have six hours in Hobart."
→ intent=itinerary, regions=["Coal River Valley"], tags=[], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "Just tell me your top three."
→ intent=general, regions=[], tags=["featured"], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "Anything cool, doesn't matter where."
→ intent=general, regions=[], tags=[], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=false, retrieveTastingNotes=false, wineKeywords=[]

User: "Somewhere with a view that takes walk-ins"
→ intent=feature, regions=[], tags=["walk-ins"], nameKeywords=[], dayOfWeek=none,
  retrieveDescriptions=true, retrieveTastingNotes=false, wineKeywords=[]
  (vibe modifier "with a view" → descriptions on)

Now classify the next user message. Emit exactly one route_query tool
call with the structured fields filled in per the rules above.`;

export interface RouteOptions {
  client: OpenAI;
  model?: string;
  worldIndex: string;
  /** Active region's config. The router's tool schema is built per-region
   *  (sub-region enum, description text) and the output is validated
   *  against this region's sub-region names. */
  region: RegionConfig;
}

export async function routeQuery(
  userMessage: string,
  opts: RouteOptions
): Promise<RouteResult> {
  const client = opts.client;
  const model = opts.model || ROUTER_MODEL;
  const routeTool = buildRouteTool(opts.region);

  try {
    const response = await client.chat.completions.create({
      model,
      max_completion_tokens: ROUTER_MAX_TOKENS,
      tool_choice: { type: "function", function: { name: "route_query" } },
      tools: [routeTool],
      messages: [
        {
          role: "system",
          content: `${ROUTER_SYSTEM_PROMPT}\n\n${opts.worldIndex}`,
        },
        { role: "user", content: userMessage },
      ],
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];

    const rawUsage = response.usage as
      | (typeof response.usage & {
          prompt_tokens_details?: { cached_tokens?: number };
        })
      | undefined;
    const usage: RawUsage | null = rawUsage
      ? {
          prompt_tokens: rawUsage.prompt_tokens,
          completion_tokens: rawUsage.completion_tokens,
          prompt_tokens_details: {
            cached_tokens: rawUsage.prompt_tokens_details?.cached_tokens,
          },
        }
      : null;

    if (!toolCall || toolCall.type !== "function") {
      return { decision: DEFAULT_DECISION, usage, model };
    }

    let args: Partial<{
      intent: RouteIntent;
      regions: string[];
      tags: string[];
      nameKeywords: string[];
      dayOfWeek: string;
      retrieveDescriptions: boolean;
      retrieveTastingNotes: boolean;
      wineKeywords: string[];
    }> = {};

    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch (parseErr) {
      if (IS_DEV) {
        console.warn(
          "[concierge] router emitted invalid JSON, using defaults:",
          parseErr
        );
      }
      return { decision: DEFAULT_DECISION, usage, model };
    }

    return { decision: normaliseDecision(args, opts.region), usage, model };
  } catch (err) {
    if (IS_DEV) {
      console.warn("[concierge] router fell back to default:", err);
    }
    return { decision: DEFAULT_DECISION, usage: null, model };
  }
}

function normaliseDecision(
  raw: Partial<{
    intent: RouteIntent;
    regions: string[];
    tags: string[];
    nameKeywords: string[];
    dayOfWeek: string;
    retrieveDescriptions: boolean;
    retrieveTastingNotes: boolean;
    wineKeywords: string[];
  }>,
  region: RegionConfig
): RouteDecision {
  const intent: RouteIntent = (raw.intent as RouteIntent) || "general";

  // Whitelist regions against THIS region's sub-region names — drops any
  // hallucinated sub-region the model might emit. For a flat region
  // (subRegions empty), the tool schema omits this field entirely, so
  // raw.regions should be undefined; the filter still works.
  const knownSubRegions = subRegionNames(region);
  const regions = (raw.regions || [])
    .map((r) => String(r).trim())
    .filter((r) => knownSubRegions.includes(r));

  const tags = (raw.tags || [])
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => (KNOWN_TAGS as readonly string[]).includes(t));

  const nameKeywords = (raw.nameKeywords || [])
    .map((n) => String(n).trim().toLowerCase())
    .filter((n) => n.length >= 2 && n.length <= 40);

  const day = String(raw.dayOfWeek || "none").trim();
  const dayOfWeek =
    day && day.toLowerCase() !== "none" && (DAYS_OF_WEEK as readonly string[]).includes(day)
      ? day
      : null;

  const retrieval: RouteRetrievalFlags = {
    descriptions: raw.retrieveDescriptions === true,
    tastingNotes: raw.retrieveTastingNotes === true,
  };

  const wineKeywords = (raw.wineKeywords || [])
    .map((w) => String(w).trim().toLowerCase())
    .filter((w) => w.length >= 2 && w.length <= 40);

  if (intent === "out_of_scope") {
    retrieval.descriptions = false;
    retrieval.tastingNotes = false;
  }

  return {
    intent,
    regions,
    tags,
    nameKeywords,
    dayOfWeek,
    retrieval,
    wineKeywords,
    limit: limitForIntent(intent, nameKeywords.length, regions.length),
  };
}

function limitForIntent(
  intent: RouteIntent,
  namedCount: number,
  regionCount: number
): number {
  switch (intent) {
    case "specific_winery":
      return Math.max(3, Math.min(5, namedCount + 2));
    case "feature":
      return 8;
    case "regional":
      return regionCount > 1 ? 12 : 8;
    case "itinerary":
      return 12;
    case "general":
      return 6;
    case "out_of_scope":
      return 0;
    default:
      return 6;
  }
}
