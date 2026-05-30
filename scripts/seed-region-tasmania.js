// scripts/seed-region-tasmania.js
// ─────────────────────────────────────────────────────────────────────────────
// Seeds the `regions/tasmania` Firestore document — the per-region config
// the multi-region architecture reads at runtime (RegionContext on the
// client, the concierge orchestrator on the server).
//
// Every value here is lifted VERBATIM from the constants currently hardcoded
// in the codebase, so when the app and concierge start reading this doc
// instead of those constants, behaviour will be byte-identical.
//
// Source-of-truth for each field is documented inline. If you change one of
// those source constants in the future, re-run this script to mirror the
// change into Firestore — or, better, delete the source constant once the
// reads have flipped over.
//
// Usage:
//   node scripts/seed-region-tasmania.js              # write
//   node scripts/seed-region-tasmania.js --dry-run    # print, don't write
//
// Idempotent — uses set() with merge:false so re-running cleanly overwrites
// the doc. (Not merge:true because we want to drop removed fields, not
// accumulate them.)
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ─── Tasmania region document ────────────────────────────────────────────────

const REGION_ID = "tasmania";

const tasmania = {
  regionId: REGION_ID,

  // Display strings — source: constants/region.ts (REGION_NAME defaults
  // to "Tasmania" when EXPO_PUBLIC_REGION_NAME is unset).
  displayName: "Tasmania",
  displayNameUpper: "TASMANIA",

  // Source: functions/src/concierge/systemPrompt.ts BRAND_VOICE
  // (lines 15–22). The current constant hardcodes the literal sentence
  // about Tasmania; this is that sentence extracted as a standalone clause
  // so the per-region prompt builder can splice it in.
  brandVoiceLine:
    "the in-app concierge for SipLocal, an editorial wine-tourism guide to Tasmania.",

  // Source: functions/src/concierge/systemPrompt.ts REGIONAL_PRIMER
  // (lines 305–316). VERBATIM — do not edit casually; the wording is
  // tuned against the model's behaviour.
  regionalPrimer: [
    "## Regional primer",
    "",
    "- Tamar Valley (north, near Launceston): cool-climate sparkling, pinot, riesling, chardonnay. Easy to do as a day from Launceston.",
    "- Pipers River (northeast of Launceston): premium sparkling country (Jansz, House of Arras).",
    "- East Coast (Bicheno, Swansea, Freycinet): scenic, often paired with Freycinet National Park; pinot and pinot gris dominate.",
    "- Coal River Valley (~25 min east of Hobart): warmest sub-region; chardonnay, pinot, riesling, cab franc.",
    "- Derwent Valley (~30-45 min northwest of Hobart): cool, elegant pinot and chardonnay; smaller cellar doors.",
    "- Huon Valley (~45 min south of Hobart): cool, often pinot and aromatic whites; Channel views.",
    "",
    "Typical drive times: Hobart↔Launceston is ~2.5 hours direct. Hobart↔Coal River 25 min. Launceston↔Pipers River 35 min. Launceston↔Tamar Valley cellar doors 20-45 min.",
    "",
    "Cruise-ship traffic lands in Hobart — Coal River Valley is the realistic option for a ship-day visit (under 6 hours round-trip).",
  ].join("\n"),

  // Sub-regions — merged from THREE current sources:
  //   • Names: functions/src/concierge/buildContext.ts TASMANIA_REGIONS
  //   • Centroids: functions/src/concierge/orchestrator.ts REGION_CENTROIDS
  //   • Adjacency: functions/src/concierge/orchestrator.ts ADJACENT_REGIONS
  //
  // NB: TASMANIA_REGIONS includes "Huon Valley and Channel" as a separate
  // entry from "Huon Valley" — both kept because some Firestore wineries
  // are tagged with the longer label. They share the Huon Valley centroid
  // and are mutually adjacent. "North West" appears in TASMANIA_REGIONS
  // and REGION_CENTROIDS but had no entry in ADJACENT_REGIONS (treated
  // as isolated) — preserving that here.
  subRegions: [
    {
      name: "Tamar Valley",
      lat: -41.4,
      lon: 147.1,
      adjacent: ["Pipers River"],
    },
    {
      name: "Pipers River",
      lat: -41.1,
      lon: 147.3,
      adjacent: ["Tamar Valley"],
    },
    {
      name: "East Coast",
      lat: -42.2,
      lon: 148.0,
      adjacent: [],
    },
    {
      name: "Coal River Valley",
      lat: -42.7,
      lon: 147.5,
      adjacent: ["Derwent Valley", "Huon Valley", "Huon Valley and Channel"],
    },
    {
      name: "Derwent Valley",
      lat: -42.6,
      lon: 147.0,
      adjacent: ["Coal River Valley", "Huon Valley", "Huon Valley and Channel"],
    },
    {
      name: "Huon Valley",
      // Centroid from REGION_CENTROIDS.
      lat: -43.0,
      lon: 146.9,
      adjacent: ["Coal River Valley", "Derwent Valley", "Huon Valley and Channel"],
    },
    {
      name: "Huon Valley and Channel",
      // No dedicated centroid in REGION_CENTROIDS — share with Huon Valley.
      lat: -43.0,
      lon: 146.9,
      adjacent: ["Coal River Valley", "Derwent Valley", "Huon Valley"],
    },
    {
      name: "North West",
      lat: -41.3,
      lon: 146.0,
      // Isolated in current ADJACENT_REGIONS map.
      adjacent: [],
    },
  ],

  // Source: components/ConciergeChat.tsx SUGGESTIONS (around line 66).
  suggestedPrompts: [
    "One day in Tasmania, pinot-focused — plan it.",
    "Best Sunday cellar door near Hobart?",
    "Where should I base myself for a sparkling weekend?",
  ],

  // Source: app/(tabs)/wineries/index.tsx TASMANIA_REGION (lines 116–121).
  mapBounds: {
    latitude: -42.2,
    longitude: 146.8,
    latitudeDelta: 5.0,
    longitudeDelta: 4.5,
  },

  // Tasmania keeps the legacy itinerary-discipline wording from HARD_RULES
  // (the paragraph about not combining sub-regions >45 min apart, no
  // cross-island days). Leaving this undefined means buildSystemPrompt()
  // falls back to the current hardcoded text — back-compat for the seed
  // region. Flat regions added later will set their own value here.
  // itineraryDisciplineRule: undefined,

  // Per-region splices for the cheap Tier 2 prompt blocks
  // (TASK_AND_SCOPE, HARD_RULES easy mentions, STYLE_NOTES). The seed
  // values reproduce the legacy hardcoded Tasmanian wording exactly:
  //   "Tasmanian wine", "Tasmanian food", "real Tasmanian producer",
  //   "Tasmanian travel concierge", "the island's history", "opposite
  //   side of the island". Once Margaret River (or any second region)
  //   is added, it sets its own values here and the same code path
  //   renders the region-correct wording without any prompt-file edits.
  regionAdjective: "Tasmanian",
  geographyNoun: "island",

  // Curated sub-region list for STYLE_NOTES' "Refer to regions by their
  // proper names" bullet. Matches the legacy hardcoded list exactly —
  // intentionally excludes "Huon Valley and Channel" (an alias of Huon
  // Valley used on some winery docs) and "North West" (one isolated
  // sub-region not surfaced in the Sommelier's conversational vocabulary).
  promptSubRegions: [
    "Tamar Valley",
    "Pipers River",
    "East Coast",
    "Coal River Valley",
    "Derwent Valley",
    "Huon Valley",
  ],

  // Optional editorial flourish for the home screen / picker. Tasmania
  // can use a region-tuned line; omit and the UI falls back to a generic.
  homeHeadline: "An editorial guide to Tasmanian wine.",

  // IANA timezone for Tasmania. The concierge uses this to compute
  // "today" for the user — both in the cached world index ("today:open"
  // hints per winery) and in the per-turn <today> tag in the system
  // prompt. Server `new Date()` runs in UTC, which is 10–11 hours
  // behind Tasmania; without this field, every morning ~10 hours of
  // hours/day questions get answered for the wrong weekday.
  timezone: "Australia/Hobart",

  schemaVersion: 1,
};

// ─── Run ─────────────────────────────────────────────────────────────────────

async function run() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(`\n🌿  Seeding regions/${REGION_ID}\n`);
  console.log("Document preview:");
  console.log(JSON.stringify(tasmania, null, 2));
  console.log("");

  if (dryRun) {
    console.log("--dry-run — nothing written.");
    process.exit(0);
  }

  await db.collection("regions").doc(REGION_ID).set(tasmania);
  console.log(`✅  Wrote regions/${REGION_ID}.`);
  process.exit(0);
}

run().catch((err) => {
  console.error("❌  Failed to seed Tasmania region:", err);
  process.exit(1);
});
