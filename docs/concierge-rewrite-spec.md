# Concierge Rewrite — Architecture Spec

**Status:** Draft for review. No code changes until this is signed off.

**Author note (Claude):** This is the design we agreed on before any
rewriting. Each section answers a specific question raised in the audit.
Push back inline (or in a follow-up note) on anything that reads wrong;
once you sign off I'll start the implementation in a new
`functions/src/concierge/v2/` folder so the live concierge stays
untouched until the rewrite passes its verification gate.

---

## 1. Goal

Replace the current orchestrator (1,500 lines, six conditional retrieval
gates, three LLM calls per turn, ~5K-token system prompt) with a
**switch over five intents** where each branch owns its own retrieval and
the system prompt is intent-agnostic. Stipulations (#1–#19, signed off
2026-05-28) are the behavioural contract this spec must satisfy.

Non-goals:

- Changing the public interface that `ConciergeChat.tsx` binds to.
  `init`, `askStream`, `getWinery`, `setIdentity`, `setUserLocation`,
  `reset`, and the `AskResult { reply, proposal, wineryCards, history,
  cost }` shape all stay identical.
- Replacing Voyage embeddings, Upstash, the rerank model, or the
  Firestore corpus shape. Indexes do not get re-built.
- Migrating off Gemini for the response leg (stipulation #15).

---

## 2. Five intents, one switch

The router classifies every turn into exactly one of these. Each branch
is ~30–50 lines, owns its own retrieval, and consumes the same system
prompt.

| Intent | Trigger | Anchor winery? |
|---|---|---|
| `WINERY_FOCUS` | User named a winery, or named a wine that maps to a corpus winery | Yes — exactly one |
| `DISCOVERY` | Recommendation/filter/vibe query without an anchor (regional, feature, varietal-class) | No |
| `TRIP` | Explicit trip-planning intent (dates, "plan a day", "where should I go") | Optional |
| `KNOWLEDGE` | General wine/region question that doesn't reference any specific winery ("why is Tasmania good for sparkling", "what's pinot noir") | No |
| `OUT_OF_SCOPE` | Not Tasmanian wine tourism at all | n/a |

This collapses today's six intents (`specific_winery` / `regional` /
`feature` / `itinerary` / `general` / `out_of_scope`) into five by
folding `regional` + `feature` into a single `DISCOVERY` branch. They
share retrieval shape and prompt context, so splitting them just makes
the orchestrator re-litigate the same decisions.

### 2.1 Branch retrieval contracts (one row per branch, no global gating)

| Branch | Winery row filter | Tasting notes | Knowledge base | Winery sources |
|---|---|---|---|---|
| `WINERY_FOCUS` | anchor only | anchor only | off | anchor only |
| `DISCOVERY` | by region/tags | whole namespace (no wineryId filter), only if wine words mentioned | on if no wine words present and query is broad/regional | off |
| `TRIP` | by region/tags + drive-time sort | only if wine words mentioned | off | off |
| `KNOWLEDGE` | none | off | on | off |
| `OUT_OF_SCOPE` | none | off | off | off |

This table is the new orchestrator. The current orchestrator's
`INTENTS_NEEDING_KNOWLEDGE` / `INTENTS_NEEDING_WINERY_SOURCES` sets,
the `retrieveDescriptions` / `retrieveTastingNotes` router flags, the
neighbour-expansion pass, and the forced-protection cap all disappear —
the table makes them moot.

### 2.2 Key behavioural consequences

**The Bangor-Vineyard-Shed bug.** "Wines from Bangor" lands in
`WINERY_FOCUS` with `anchor = bangor-vineyard-shed`. Tasting-notes
retrieval is scoped to that wineryId only. No neighbour can leak in.

**The Abel-Tasman-Pinot-Noir bug.** "Abel Tasman Pinot Noir" hits the
deterministic wine-name lookup (§3.2), maps to
`bangor-vineyard-shed`, lands in `WINERY_FOCUS`. The wine is in the
notes scoped to Bangor; the model returns it.

**"Skin-contact riesling producers"** lands in `DISCOVERY`. Tasting
notes retrieval runs against the *whole* wines namespace (no
wineryId filter), reranker picks the most relevant bottles, the
wineries those bottles belong to load into context.

---

## 3. The router (one LLM call, replaces today's resolver + router)

### 3.1 Contract

One tool call. Returns:

```
{
  selfContainedQuery: string,    // coreference resolved inline; folds in today's separate resolver call
  intent: "WINERY_FOCUS" | "DISCOVERY" | "TRIP" | "KNOWLEDGE" | "OUT_OF_SCOPE",
  anchorWinerySlug: string | null,  // see §3.2 — typically NULL from the LLM, populated by deterministic lookup after
  regions: string[],             // sub-region names from the active region's config; [] = no preference
  tags: string[],                // dog-friendly | restaurant | organic | biodynamic | walk-ins | award-winning | tours | featured
  wineWords: string[],           // varietals/styles/vintages mentioned ("pinot", "skin-contact", "2018")
  wineryWords: string[],         // candidate winery-name words the LLM thinks might be a winery name (validated against corpus next)
  dayOfWeek: "Mon"|...|"Sun"|null,
  clarifyingQuestion: string | null  // populated only when stipulation #12 fires (trip/discovery with insufficient info)
}
```

Folding the resolver into this call saves one LLM round-trip per turn
(stipulation #10).

### 3.2 Deterministic anchor resolution

`anchorWinerySlug` is set by deterministic post-processing, not by the
LLM. Today's `nameKeywords` extraction is unreliable — see the Tolpuddle
and Abel-Tasman misses in the audit. The new pipeline:

1. **Winery-name lookup.** A startup-time index over corpus winery names
   (every distinctive word ≥4 chars, stopword-filtered) is matched
   against the message word-set. Single highest-confidence hit wins.
2. **Wine-name lookup** (the new piece, stipulation #2). Same shape but
   against the 171-row wine list. "Abel Tasman" → owning winery
   `bangor-vineyard-shed`. Single highest-confidence hit wins.
3. If both fire, **the winery hit wins** (stipulation #1: named winery
   anchors).
4. If neither fires but `intent === WINERY_FOCUS`, the LLM either
   hallucinated or pointed at an off-corpus winery — branch falls
   through to the deflection path in §6 (stipulation #4).

Both indexes are built once per region at module-scope cache load,
cost nothing per turn, and never miss the way the LLM does.

### 3.3 Clarifying-question contract

`clarifyingQuestion` is populated **only** when:

- intent is `TRIP` or `DISCOVERY`, AND
- the user has clearly asked for a recommendation/plan, AND
- the LLM judges it can't make a sensible one with the given info (no
  region, no day, no party, no occasion, no varietal preference at all).

Curiosity questions (intent `KNOWLEDGE`, or `DISCOVERY` with at least
one filter signal) always get answered, never clarified. This is the
narrowed version of stipulation #12.

When `clarifyingQuestion` is populated, the orchestrator short-circuits
all retrieval and the response model receives only the question + system
prompt + a tag telling it to ask exactly the clarifying question and
nothing else.

---

## 4. System prompt (cache-stable, intent-agnostic)

One prompt for every turn. Same prefix every time means a clean cache
hit on every turn after the first (vs. today's six prefix variants per
region).

### 4.1 Sections, in order

1. **Voice** — sommelier behind a bar, plain prose, no markdown.
   (Today's BRAND_VOICE + the no-markdown rule.)
2. **Scope** — wine tourism in {region}, generous adjacent topics
   (food, seasons, history, etiquette), warm deflection on truly
   off-topic. (Today's TASK_AND_SCOPE, slightly trimmed.)
3. **Three absolute rules** (stipulations #17–19, kept verbatim):
   - By-appointment wineries → mention ring-ahead.
   - Hours come from the dataset only, mention only the relevant day.
   - Never claim to take bookings or invent phone numbers/hours.
4. **Grounding rule, collapsed** — "Concrete facts come from the data
   blocks below or from the world index. If a fact about a SipLocal
   corpus winery isn't there, say you don't have it and point at the
   cellar door's website. **Famous Tasmanian producers not in the
   corpus** (House of Arras, Jansz, Apogee, etc.) get encyclopedic
   answers from general wine knowledge with one short line noting
   they're not one of the cellar doors SipLocal sends visitors to.
   **Unknown / invented producers** get 'I don't know that one — where
   did you hear of it?'." (Stipulations #3 and #4, collapsed.)
5. **Wine-specific fallback rule** — "If the user names a wine: if
   it's in `<tasting_notes>`, use the notes. If not but the winery is
   in the corpus, say 'I don't have notes for that bottle, here's
   what I can say about [winery]'s style' and speak to style.
   If neither, speak about the varietal generically without
   pretending to know the bottle." (Stipulation #5.)
6. **Length discipline** — ~100 words, half for factual lookups, two
   short paragraphs max for itineraries. Land the plane. (Today's
   LENGTH_DISCIPLINE, kept.)
7. **Hours format reminder** — the per-day format and translation
   into plain speech.
8. **Trip-plan protocol** (10 lines, not the 700-token block):
   ```
   When the user has asked for a multi-stop day, append at the end:
   <<TRIP_PLAN>>{"name":"<2-5 word label>","slugs":["a","b",...]}<<END_TRIP_PLAN>>
   Use slugs from <relevant_wineries>. 2–6 slugs. >4 stops → also
   write a one-line "I'd split this over two days" note in the
   prose. Never speak the markers; never emit on non-trip turns.
   ```
9. **Winery-card protocol** (5 lines):
   ```
   Whenever your reply names a specific corpus winery, append at the end:
   <<WINERY_CARD>>{"slugs":["a","b","c"]}<<END_WINERY_CARD>>
   No upper cap; include every corpus winery you actually recommend.
   ```
10. **Regional primer** — from the region doc.
11. **World index** — the cached corpus listing (stipulation #16).

### 4.2 What's gone

- The 100-line "GROUNDING DISCIPLINE" rule with two named failure
  modes. Reduced to one paragraph in §4.1.3 above. The fewer-shot count
  collapses the same behaviour into half the tokens.
- The full trip-plan / winery-card protocols (~700 tokens each) and
  their per-intent stubs. The protocols are short enough now that the
  full versions can always be in the prompt — no per-intent splitting,
  no cache fragmentation.
- The 6 few-shot examples in `FEW_SHOT`. The behaviour they encode is
  load-bearing; the format is not. Reduced to **three** examples:
  - One showing encyclopedic Arras-style answer (rule §4.1.4).
  - One showing the wine-not-in-notes fallback (rule §4.1.5).
  - One showing a clean trip plan with the multi-day note (rule §4.1.8).
  Lost: the 2 grounding-discipline examples (rule is simpler) and the
  hedged-numbers example (the new rule says "use what's there with the
  source's hedging" in one line and trusts the model).
- The `retrieveDescriptions` flag in the router, plus all the disabled
  hydration code in `retrieve.ts`. Dead since the descriptions index
  doesn't store text.
- Per-intent prompt stubs. Always-on protocols replace them.

---

## 5. Per-turn user message envelope

Built in this order. Each block omitted when empty so the model never
sees a placeholder.

```
<today>Wednesday</today>
<user_location>User is currently near the Coal River Valley area of Tasmania.</user_location>
<relevant_wineries>
  <full-detail rows for ≤5 wineries, OR compact pipe-rows for >5>
</relevant_wineries>
<tasting_notes>
  <pipe-delimited rows>
</tasting_notes>
<knowledge_base>
  <chunk index="1" source="..." section="...">prose</chunk>
  ...
</knowledge_base>
<source_excerpts>
  === Winery (Region) — Section ===
  prose
  ...
</source_excerpts>

<user message verbatim>
```

Same envelope shape as today. The change is that branches in §2.1
decide which blocks are *populated*, and the system prompt no longer
has different "this block may or may not appear" rules per intent —
because each branch's contract is deterministic.

---

## 6. Branch implementations (sketch)

Each branch is one function in the new orchestrator. Sketches below;
real implementation gets full error handling.

### `handleWineryFocus(message, anchor)`

```
candidates = [loadWineryFromCorpus(anchor)]    // just the one
tastingNotes = retrieveTastingNotes(message, { wineryIds: [anchor], topK: 8 })
sourceChunks = retrieveWinerySources(message, { wineryIds: [anchor], topK: 5 })
// no knowledge base, no neighbour expansion
return buildEnvelopeAndStream(candidates, tastingNotes, [], sourceChunks)
```

### `handleDiscovery(message, regions, tags, wineWords)`

```
candidates = filterCorpus(regions, tags)         // in-memory pass
candidates = sortByBoostThenRating(candidates)
if (userLocation && nearbyRequest) candidates = sortByDriveTime(candidates)
candidates = candidates.slice(0, 8)

if (wineWords.length > 0) {
  tastingNotes = retrieveTastingNotes(message, { topK: 4 })  // NO wineryId filter
  // Add the wineries those notes belong to (if not already in candidates)
  candidates = mergeWineriesByWine(candidates, tastingNotes)
}

if (wineWords.length === 0 && isBroadRegional(regions, tags)) {
  knowledge = retrieveKnowledge(message, { topK: 3 })
}

return buildEnvelopeAndStream(candidates, tastingNotes ?? [], knowledge ?? [], [])
```

### `handleTrip(message, regions, tags, day, wineWords)`

```
candidates = filterCorpus(regions, tags, day)
candidates = sortByBoostThenRating(candidates)
if (userLocation) candidates = sortByDriveTime(candidates)
candidates = candidates.slice(0, 12)

if (wineWords.length > 0) {
  tastingNotes = retrieveTastingNotes(message, { wineryIds: candidates.slugs, topK: 4 })
}

return buildEnvelopeAndStream(candidates, tastingNotes ?? [], [], [])
// trip-plan marker emitted by the model (system prompt rule §4.1.8)
```

### `handleKnowledge(message)`

```
knowledge = retrieveKnowledge(message, { topK: 3 })
return buildEnvelopeAndStream([], [], knowledge, [])
// no winery rows at all — the model talks generally
```

### `handleOutOfScope(message)`

```
// no retrieval; system prompt has the deflection voice
return streamShortReply(message)
```

### Deflection sub-paths

- `intent === WINERY_FOCUS` but no anchor resolved → small sentinel
  block `<unknown_winery>{user's quoted reference}</unknown_winery>`
  added to envelope; system prompt rule §4.1.4 handles the response
  (encyclopedic vs deflect).
- Wine named but not in DB (in `WINERY_FOCUS` or `DISCOVERY`) — same
  shape, prompt rule §4.1.5 handles the response.

---

## 7. New module layout

```
functions/src/concierge/
├── v2/                                      ← new code lives here
│   ├── orchestrator.ts                      ← ~300 lines (was 1,500)
│   ├── router.ts                            ← ~150 lines (was 700; folds in resolver)
│   ├── systemPrompt.ts                      ← ~250 lines (was 1,400)
│   ├── envelope.ts                          ← builds per-turn user message
│   ├── nameIndex.ts                         ← NEW: winery + wine deterministic lookup
│   ├── retrievers/
│   │   ├── wineries.ts                      ← in-memory filter pass
│   │   ├── tastingNotes.ts                  ← existing logic, simpler wineryId handling
│   │   ├── knowledge.ts                     ← existing logic, kept
│   │   ├── winerySources.ts                 ← existing logic, kept
│   │   └── shared.ts                        ← Voyage embed + rerank helpers
│   ├── parsers.ts                           ← copy of today's parsers.ts (no change)
│   ├── stream.ts                            ← marker-filter from today's orchestrator
│   ├── costTracker.ts                       ← unchanged
│   ├── geminiResponse.ts                    ← unchanged
│   ├── buildContext.ts                      ← unchanged (corpus load + world index)
│   ├── regionConfig.ts                      ← unchanged
│   ├── driveTimes.ts                        ← unchanged
│   └── rerank.ts                            ← unchanged
└── (existing files stay live until v2 ships)
```

The unchanged files get re-exported from `v2/` so v2 is self-contained.
That way the rollback (§9) is a one-line import flip in `index.ts`.

---

## 8. Files / code that get deleted (when v2 ships)

- `functions/src/concierge/resolveCoreference.ts` (folded into router).
- `functions/src/concierge/retrieve.ts` (dead since the descriptions
  index doesn't store text).
- ~1,200 lines of orchestrator: neighbour-expansion, forced-protection
  cap, fuzzy-name fallback, `INTENTS_NEEDING_*` sets, `retrieveDescriptions`
  flag handling, per-intent token-cap table, per-intent stub vs full
  protocol switching.
- The two stub blocks (`TRIP_PROPOSAL_STUB`, `WINERY_CARD_STUB`) and the
  intent-conditional `tripProposalBlock` / `wineryCardBlock` selectors.
- The `findFuzzyWineryMatches` + `FUZZY_MATCH_STOPWORDS` block — replaced
  by `nameIndex.ts`'s deterministic lookup.

Client-side dead code (`services/concierge/{router,retrieve,knowledgeRetrieve,
tastingNotes,resolveCoreference,driveTimes,systemPrompt,costTracker}.ts`)
also gets deleted in this pass — the comment at the top of
`services/concierge/concierge.ts` flags it as dead since the server
rewrite shipped.

---

## 9. Migration plan

1. **Build v2 in parallel.** New code lives under `functions/src/concierge/v2/`.
   The existing concierge keeps serving traffic. No deploys.
2. **Wire a flag.** `functions/src/index.ts` imports either v1's or v2's
   `orchestrateTurn` based on `CONCIERGE_USE_V2` env var. Default off.
3. **Deploy with flag off.** v2 is in the bundle but never called.
   Production traffic is untouched.
4. **Run verification (§10) against v2** locally and with the emulator.
5. **Flip the flag.** One env-var change → all traffic to v2.
6. **One-week soak.** If anything breaks, flip the flag back. Old code
   is still in the bundle; rollback is one redeploy with the env var
   removed.
7. **Delete v1.** After the soak, v1's orchestrator + the now-dead
   client-side concierge files come out in one cleanup PR.

The public interface (`AskResult` shape, SSE event names, history
trimming behaviour) stays bit-for-bit identical through all six steps.
`ConciergeChat.tsx` doesn't notice the switch.

---

## 10. Verification

Before flipping the flag, v2 must pass a fixed query set covering every
branch + every behavioural stipulation. Each case has an expected
behaviour, not an expected exact response — the model varies turn to
turn, but the *shape* should be right.

### Query set (run against v2 locally with the emulator)

| # | Query | Branch | Expected behaviour |
|---|---|---|---|
| 1 | "Wines from Bangor Vineyard Shed" | `WINERY_FOCUS` | Returns Bangor's wines only (1830 Chardonnay, Abel Tasman Pinot Noir). **No neighbour wine.** Winery card for `bangor-vineyard-shed` only. |
| 2 | "abel tasman pinot noir" | `WINERY_FOCUS` (anchor via wine lookup) | Returns the Abel Tasman pinot with notes. Winery card for Bangor. |
| 3 | "abel tasman pinot noir bangor vineyard shed" | `WINERY_FOCUS` | Same answer as #2 — winery anchor wins, no change. |
| 4 | "Is Tolpuddle open Sunday?" | `WINERY_FOCUS` | Answers from hours. No fabrication. Card for Tolpuddle. |
| 5 | "Tell me about House of Arras" | `WINERY_FOCUS` deflection path | Encyclopedic answer, soft "not a SipLocal cellar door" note. No card. |
| 6 | "Tell me about Velvet & Willow Riesling" (invented bottle + winery) | `WINERY_FOCUS` deflection path | Speaks to Tasmanian Riesling style generically. No fake winery card. |
| 7 | "Dog-friendly cellar doors with a restaurant" | `DISCOVERY` | Filtered list. Cards for every named winery. No tasting notes block. |
| 8 | "Skin-contact riesling producers in Tasmania" | `DISCOVERY` + wine words | Tasting-notes search across whole namespace, returns matching wines, their wineries get cards. |
| 9 | "Who makes the best Tasmanian chardonnay?" | `DISCOVERY` + wine words | Top chardonnays surface from notes, wineries get cards. |
| 10 | "Why is Tasmania so good for sparkling?" | `KNOWLEDGE` | Knowledge-base prose answer, soft door open. No winery cards unless a corpus winery is named. |
| 11 | "Plan a Saturday from Hobart, partner and I, love pinot" | `TRIP` | 3-4 stop itinerary in Coal River / Derwent / Huon, drive-time ordered. `<<TRIP_PLAN>>` block emitted with valid slugs. |
| 12 | "Plan a 3-day Tasmania wine trip" | `TRIP` | 5-6 stops with a "I'd split this over two days" / "across three days" note in prose. Single `<<TRIP_PLAN>>` block. |
| 13 | "Plan a day from Hobart" (no other info) | `TRIP` with clarifying | Asks one focused follow-up before recommending. No retrieval. No cards. |
| 14 | "What's good?" | `DISCOVERY` (broad) | Answers, no clarifying question (stipulation #12 narrowed). |
| 15 | "Help me write an email" | `OUT_OF_SCOPE` | Warm deflection. No cards, no plan. |
| 16 | (turn 1) "Suggest a Coal River pinot day" → (turn 2) "actually let's do sparkling" | `TRIP` × 2 | Turn 2's `selfContainedQuery` from the router rewrites to "Plan a sparkling-focused Coal River day instead of pinot" — coreference fold works. |

A test harness runs each query, prints the routed intent + retrieval
counts + final reply + emitted markers, and a human reads the output.
This is not automated assertion — these are too prose-shaped for that —
but a structured eval pass that one developer can run in 15 minutes
before the flag flip.

### Smoke-test scripts to add

- `scripts/concierge/eval-v2.js` — runs the 16 queries above against a
  configurable concierge endpoint (local emulator or deployed function),
  outputs a tabular summary plus full transcripts. New file.

---

## 11. Estimated work

- **Architecture doc** — done (this file).
- **`nameIndex.ts` + `router.ts` rewrite** — ~1 day. Most subtle part
  of the rewrite. Includes the deterministic lookup, the structured
  router contract, and the clarifying-question logic.
- **`orchestrator.ts` rewrite (5 branches)** — ~1 day.
- **`systemPrompt.ts` rewrite + 3 few-shot rebuild** — ~0.5 day.
- **`envelope.ts` + retriever wrappers** — ~0.5 day. Mostly re-exposing
  existing retrievers under a cleaner interface.
- **`eval-v2.js` harness + manual run** — ~0.5 day.
- **Migration env-var + index.ts flag** — ~0.5 day.

**Total: ~4 days of focused work, end-to-end, before the soak period.**
A week from sign-off to a flag flip is realistic if no surprises surface
in the eval.

---

## 12. Open questions — resolved 2026-05-28

A. **Eval responsibility.** Claude runs the eval set, writes up a
   summary, and the user reviews both the summary and the raw
   transcripts. `eval-v2.js` must emit raw outputs as a JSON file
   alongside the summary so the user can read every routed intent,
   retrieval count, and final reply themselves.

B. **`functions/src/concierge/v2/` + flag.** New code under `v2/`,
   `CONCIERGE_USE_V2` env var picks v1 or v2 at request time, soak
   period before v1 deletion. As described in §9.

---

*Spec signed off. Implementation starts with `nameIndex.ts` (the
deterministic winery/wine lookup), then router, then per-branch
orchestrator, then prompt, then eval harness.*
