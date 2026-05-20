# Adding a new region

This is the operational guide for adding a new wine region to SipLocal. The multi-region refactor (see `multi-region-refactor-plan.md` for architectural context) means adding a region is a **data operation**, not a code change. You write a seed script, run it, tag the new region's wineries with a `regionId`, and the existing app + concierge serve the new region automatically.

If you can author one region in a weekend (the data work is the bottleneck — finding wineries, scraping hours, writing the primer), the technical scaffolding adds maybe 20 minutes on top.

---

## What you'll need before starting

- **Firebase admin SDK credentials.** The `service-account-tasmania.json` file at the repo root is what every script uses. The same file works for any region — the multi-region refactor stays inside one Firebase project (`winery-tourism-tasmania`). Don't create a second project per region; that adds operational cost without architectural benefit.
- **A name for the region.** Pick the `regionId` slug first and stick with it. Lowercase, kebab-case, durable. Examples: `tasmania`, `margaret-river`, `barossa-valley`, `napa-valley`. The slug appears in every Firestore document for that region, in the request body of every concierge call, and in AsyncStorage on every user's device. Renaming later is possible but painful.
- **Editorial content.** At minimum: a regional primer (~150 words of prose about the region), three suggested-prompt chips for the concierge empty state, a brand-voice sentence, and a sense of which sub-regions (if any) you want to expose.
- **A list of wineries.** Without wineries, the region is just a picker option — the app will load to an empty wineries list and the concierge will have nothing to talk about.

---

## The 30-second mental model

A region in SipLocal is a single Firestore document at `regions/{regionId}`. That document holds **everything the app and concierge need to behave as a guide to that region**: display name, regional primer, optional sub-regions, picker prompts, map bounds.

Every content document (`wineries/*`, `premade_trips/*`, `pour_articles/*`, `explore_articles/*`, `knowledge_chunks/*`) carries a `regionId` field that ties it to a region. When the user picks Margaret River, the app filters every Firestore query by `where("regionId", "==", "margaret-river")` and the concierge loads `regions/margaret-river` and reads from that region's winery corpus.

Sub-regions are an **optional** structure inside a region. Tasmania has six (Tamar Valley, Pipers River, etc.) and the prompt + UI lean on them — adjacency, centroids, itinerary-discipline rules. Other regions can be flat: one geographic area, no internal subdivision. Every code path that touches sub-regions short-circuits gracefully when there aren't any.

---

## Step 1 — Write the region seed script

Copy `scripts/seed-region-tasmania.js` to `scripts/seed-region-{your-region-id}.js`. Most of the file is template; the parts you need to author are noted below.

```js
// scripts/seed-region-margaret-river.js
const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const REGION_ID = "margaret-river";

const region = {
  regionId: REGION_ID,
  displayName: "Margaret River",
  displayNameUpper: "MARGARET RIVER",

  // One sentence — gets spliced into the system prompt's brand voice.
  // Structure: "the in-app concierge for SipLocal, an editorial wine-tourism
  //              guide to {region}."
  brandVoiceLine:
    "the in-app concierge for SipLocal, an editorial wine-tourism guide to Margaret River.",

  // Long-form markdown injected into the system prompt.
  // 100-200 words. Describe the region's character (climate, varietals,
  // hub towns, geography). If the region has sub-regions, describe them.
  // If it doesn't, describe the region holistically. Avoid trivia — the
  // primer is for grounding the model's general claims, not for fact-loading.
  regionalPrimer: [
    "## Regional primer",
    "",
    "Margaret River sits on a stretch of southwest Western Australia between",
    "two oceans. Most of the wineries cluster along Caves Road north of the",
    "town of Margaret River itself — a 20-minute corridor between Yallingup",
    "and Hamelin Bay.",
    "",
    "Cabernet sauvignon is the headline grape; chardonnay and semillon-",
    "sauvignon blanc blends are nearly as decorated. The maritime climate",
    "produces structured, ageworthy reds and citrus-driven whites. Cellar",
    "doors are clustered tightly enough that most visitors do 3-4 in a",
    "single day without long drives between them.",
    "",
    "Drive time from Perth: roughly 3 hours direct, or 4 with stops.",
  ].join("\n"),

  // Optional. Leave undefined / [] for a flat region.
  // For Tasmania this lists six sub-regions with centroids + adjacency.
  // For Margaret River, you might leave this empty — the whole region is
  // small enough that sub-region structure isn't useful.
  subRegions: [],

  // Three prompt chips shown in the concierge empty state. Match the
  // editorial voice of the rest of the app. Should sound like things a
  // visitor would actually ask.
  suggestedPrompts: [
    "Plan a Saturday in Margaret River — we love cabernet.",
    "Best lunch winery within driving distance of Dunsborough?",
    "Where should I taste chardonnay if I'm down for two days?",
  ],

  // Initial camera position for the wineries-screen map view. Pick a
  // centroid + deltas that contain the whole region with a little breathing
  // room. Get the bounds from Google Maps and round generously.
  mapBounds: {
    latitude: -33.95,
    longitude: 115.05,
    latitudeDelta: 0.7,
    longitudeDelta: 0.6,
  },

  // Optional. The system prompt has a hardcoded paragraph in HARD_RULES
  // about Tasmanian itinerary discipline (no >45-min cross-region days,
  // no cross-island routes). For a region where that wording doesn't fit,
  // override here. Three behaviours:
  //   undefined  → use the legacy Tasmanian wording (back-compat for v1).
  //   "<text>"   → use this text verbatim in place of the default.
  //   ""         → omit the rule entirely (small/flat regions).
  //
  // For a flat region like Margaret River, supply your own:
  // itineraryDisciplineRule:
  //   "Keep the day reasonable — two to four cellar doors in the Caves Road " +
  //   "corridor. Don't propose a route that requires more than an hour of " +
  //   "driving in either direction; most of the region is within 25 minutes " +
  //   "of itself.",

  homeHeadline: "An editorial guide to Margaret River wine.",
  schemaVersion: 1,
};

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Seeding regions/${REGION_ID}`);
  console.log(JSON.stringify(region, null, 2));
  if (dryRun) {
    console.log("--dry-run — nothing written.");
    process.exit(0);
  }
  await db.collection("regions").doc(REGION_ID).set(region);
  console.log(`Wrote regions/${REGION_ID}.`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
```

Dry-run first to eyeball the output, then write for real:

```sh
node scripts/seed-region-margaret-river.js --dry-run
node scripts/seed-region-margaret-river.js
```

---

## Step 2 — Set `regionId` on every content document for the new region

There are two paths depending on whether you're adding wineries fresh or migrating existing data.

### 2a. Adding wineries fresh

Whatever script you use to bulk-upload the new region's wineries, **set the `regionId` field at write time**. Don't rely on a backfill pass later — it's an extra step that's easy to forget and creates a window where the app shows the wrong data.

If you're modelling on `scripts/upload-tasmania-wineries.js`, the minimum addition is one line per winery:

```js
await db.collection("wineries").doc(slug).set({
  name,
  slug,
  // …existing fields…
  regionId: "margaret-river",  // ← add this
});
```

Same for `premade_trips`, `pour_articles`, `explore_articles`, and `knowledge_chunks`. Every content document needs a `regionId`. Without it, the region-filtered query returns nothing and the document is invisible to the app.

### 2b. Migrating existing data

If wineries for the new region already exist in Firestore without a `regionId`, write a one-off backfill modelled on `scripts/backfill-region-id.js`. The existing script tags everything as `tasmania`; for a migration you'd target a specific subset (by document IDs, by a `region` text field, by a Google Place ID range — whatever distinguishes the new region's docs).

```js
// scripts/backfill-region-id-margaret-river.js
// Tags only docs that match a filter — e.g. docs whose existing `region`
// field is one of the Margaret River sub-region labels.
const TARGET_REGION_ID = "margaret-river";
const MARGARET_RIVER_SUBREGIONS = new Set([
  "Yallingup", "Wilyabrup", "Treeton", "Margaret River",
  "Karridale", "Hamelin Bay",
]);

const snap = await db.collection("wineries").get();
for (const doc of snap.docs) {
  if (MARGARET_RIVER_SUBREGIONS.has(doc.data().region) && !doc.data().regionId) {
    await doc.ref.update({ regionId: TARGET_REGION_ID });
  }
}
```

---

## Step 3 — Verify Firestore is consistent

Before you tell anyone the new region is live, sanity-check that:

```sh
# In a Node REPL or as a quick script
const snap = await db.collection("wineries").where("regionId", "==", "margaret-river").get();
console.log(`${snap.size} wineries in margaret-river`);

const knowledge = await db.collection("knowledge_chunks").where("regionId", "==", "margaret-river").get();
console.log(`${knowledge.size} knowledge chunks`);
```

Expected counts: as many wineries as you uploaded, at least a handful of knowledge chunks (otherwise the concierge has nothing to draw on for the regional primer), at least one premade trip if you want the Trips tab to surface anything.

---

## Step 4 — Test the new region locally

You don't need to deploy anything. The active region is per-user, persisted in AsyncStorage. To preview the new region without touching production users:

1. Boot the app: `npx expo start`.
2. Wipe the AsyncStorage entry for the active region. Easiest way: uninstall and reinstall the app on simulator, or clear AsyncStorage with `await AsyncStorage.removeItem("active_region_id_v1")` from a debug shortcut.
3. Relaunch. With two regions now in `regions/`, the picker will appear on first launch. Pick the new region.
4. Walk through every tab — home, wineries, trips, profile, concierge. Confirm the new region's data renders correctly.

Things to specifically check:

- **Wineries list** is populated and uses the new region's display name in headers.
- **Map bounds** frame the region nicely (no empty ocean, no clipped markers).
- **Sub-region chip row** shows the right names (or is hidden, if you went flat).
- **Concierge empty state** shows the new suggested prompts.
- **Concierge replies** sound right for the new region — try "What's good around here?" and "Plan a Saturday." If the model mentions Tasmania or Tasmanian sub-regions, the `regionalPrimer` isn't pulling through or you missed setting `regionId` on the knowledge chunks.

---

## Step 5 — Ship

That's it. **No code deploy required.** The Cloud Function already reads from `regions/{regionId}` and filters wineries by `regionId`; once your seed script writes the new doc and your wineries have the `regionId` field set, the function serves them on the next request. The client already filters every query by the active region; once the picker shows the new option, users can switch to it.

Commit the new seed script and any backfill scripts you wrote so the migration is reproducible:

```sh
git add scripts/seed-region-margaret-river.js
git commit -m "Add Margaret River region seed"
git push
```

---

## Editorial considerations

A few notes on writing each field well:

**`brandVoiceLine`** is one sentence inside the system prompt's brand-voice block. The current template is `"You are the SipLocal Sommelier — {{BRAND_VOICE_LINE}} You speak the way…"`. So your line should read as a self-contained clause that follows "Sommelier — " grammatically. The Tasmanian version: `"the in-app concierge for SipLocal, an editorial wine-tourism guide to Tasmania."` — note the trailing period (it ends a sentence inside the larger paragraph).

**`regionalPrimer`** is the most consequential field. It's prose that gets injected into every concierge call, and the model reaches for it when grounding factual claims. Write it the way you'd brief a sommelier on their first day at a new job: where the region is, what it grows, how visitors typically move through it, what makes it distinctive. Aim for 100-200 words. Avoid trivia ("oldest winery established 1859") and listy bullet points unless the region genuinely has discrete sub-regions worth enumerating. Use second-person sparingly — the primer is for the model's internal grounding, not the user-facing voice.

**`suggestedPrompts`** is three chips shown to the user before they type anything. They should sound like real visitor questions, not marketing copy. The Tasmanian set: `"One day in Tasmania, pinot-focused — plan it."`, `"Best Sunday cellar door near Hobart?"`, `"Where should I base myself for a sparkling weekend?"` — note the editorial register, the specific varietal/day/intent, the period-not-question-mark in the planning one. Match that level of specificity for your region.

**`mapBounds`** is the initial camera position for the wineries-screen map. Get the bounding box from Google Maps and round generously — you want the whole region visible with a little breathing room, not a tight crop that puts markers on the edge of the viewport.

**`subRegions`** — leave empty unless the region genuinely has internal structure visitors think about. A region where wineries cluster in three or four distinct areas with named identities ("Coal River Valley", "Tamar Valley") gets sub-regions. A region where every cellar door is within a 20-minute drive of every other ("Margaret River") usually doesn't. If in doubt, ship flat first; sub-regions can be added later without breaking existing data.

---

## Sub-regions: when and how

Sub-regions unlock four features in the prompt + UI:

1. **Filter chips** on the wineries screen so users can narrow by sub-region.
2. **Router output** — the concierge classifier can extract sub-region names from user queries (e.g. "What's good in the Tamar Valley?") and filter the candidate slice.
3. **Neighbour expansion** in retrieval — when a user asks about a winery in sub-region X, the candidate slice can include wineries from adjacent sub-regions too.
4. **User-location anchoring** — the `<user_location>` prompt block names the nearest sub-region to the user's GPS coordinates instead of just naming the region as a whole.

The cost is editorial: you need accurate centroids and adjacency for each sub-region, and your wineries need to be tagged with their sub-region name in the existing `region` field (which is a sub-region label, not a region key — see the `wineries.region` callout in the refactor plan).

If you do add sub-regions, the schema per entry is:

```js
{
  name: "Yallingup",
  lat: -33.65,
  lon: 115.04,
  adjacent: ["Wilyabrup", "Margaret River"],  // sub-regions within ~45min drive
}
```

The `adjacent` field is what powers neighbour expansion. Be conservative — if two sub-regions are 50 minutes apart, they're not adjacent. If you list everything as adjacent to everything, you've effectively turned neighbour expansion off (every sub-region becomes a no-op filter).

---

## What you do NOT need to do

For the avoidance of doubt — the following are **not** part of adding a region:

- Editing any code in `functions/src/concierge/`. The orchestrator, router, retrieval, and system-prompt builder are all region-agnostic.
- Editing any client screen. They all use `useActiveRegionId()` / `useRegionConfig()` and read the active region from context.
- Deploying functions or running `firebase deploy --only functions`.
- Adding new TypeScript types. `RegionConfig` and `SubRegion` are already defined in `types/region.ts` and `functions/src/concierge/regionConfig.ts`.
- Touching `firestore.indexes.json` unless you're adding a new query pattern (the existing indexes cover all current region-filtered queries).
- Updating the picker UI to add a new card. The picker reads the available regions from Firestore on mount; adding a doc to the `regions/` collection automatically makes it appear.

If you find yourself doing any of those, stop and check whether you actually need to — the refactor was designed so adding a region is a data operation only.

---

## Common pitfalls

**Region picker shows for existing users.** It won't. Existing users have an `active_region_id_v1` key in AsyncStorage from before the new region existed, and the picker only renders when that key is missing or invalid. New users with fresh installs (and multiple regions in Firestore) see the picker on first launch.

**The new region's wineries don't appear in the wineries list.** Almost certainly a missing or wrong `regionId` field. Check directly in the Firestore console — every doc should have `regionId: "your-region-id"` exactly, lowercase, no whitespace.

**The concierge mentions Tasmania or Tasmanian sub-regions in replies for the new region.** Two possibilities:
- Your `regionalPrimer` doesn't pull through. Verify `regions/{regionId}.regionalPrimer` exists in Firestore and the Cloud Function logs show the right region being loaded (`firebase functions:log --only concierge`).
- The few-shot examples in the system prompt are still Tasmanian. They're tone calibration, not factual content — the model is supposed to ignore the specific place names. If the model is leaking them into Margaret River replies in practice, that's a known v1 limitation; the fix is templating the few-shot block per region (see plan §4e).

**Map view opens at wrong location.** Your `mapBounds` is off. Adjust latitude/longitude/deltas in the seed script and re-run. The map reads from the active region's config on every wineries-screen mount, so changes take effect on next app open.

**Two regions exist but the wineries list shows wineries from BOTH.** Check that `services/concierge/buildContext.ts` and every screen query has the `where("regionId", "==", regionId)` clause. Phase 3c added these to every relevant query, but if you've added a new screen or a new query without one, it'll leak across regions.

**Knowledge chunks return Tasmania-themed prose for the new region.** The current implementation does not yet filter Upstash vector retrieval by `regionId` (the Firestore copy is filtered, but the vector index is not). This is a known limitation — see the refactor plan, §6 "Upstash namespace vs metadata filter" — and is acceptable while only one region has knowledge chunks. The fix is in the plan if you reach a state where it matters.

---

## Checklist

A short version for the next time you add a region:

1. Pick a `regionId` slug. Stick with it.
2. Copy `scripts/seed-region-tasmania.js` → `scripts/seed-region-{slug}.js`. Author the contents.
3. Dry-run, then run for real: `node scripts/seed-region-{slug}.js`.
4. Upload the region's wineries with `regionId: "{slug}"` set on every document. Same for any other content documents you author (`premade_trips`, `pour_articles`, `explore_articles`, `knowledge_chunks`).
5. Verify counts in Firestore.
6. Clear AsyncStorage on a test device, relaunch, pick the new region from the picker, walk through every tab.
7. Commit the seed script. No code deploy required.
