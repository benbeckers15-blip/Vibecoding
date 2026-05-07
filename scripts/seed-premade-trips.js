// scripts/seed-premade-trips.js
// ─────────────────────────────────────────────────────────────────────────────
// Seeds the Firestore `premade_trips` collection with a starter set of curated
// itineraries. Run once after enabling the Trips feature:
//
//   node scripts/seed-premade-trips.js
//
// Notes:
//   • Uses firebase-admin and the service-account.json in the repo root —
//     same pattern as the other scripts in this folder.
//   • The `wineryIds` arrays below are PLACEHOLDER ids. Edit them to match
//     real document ids from your `wineries` collection before running.
//     You can grab those ids from the Firebase Console or by running
//     `extract_place_ids.js` and pulling the firestore ids out of there.
//   • Re-running this script will create duplicate documents — clear the
//     `premade_trips` collection in the console first if you re-seed.
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const serviceAccount = require("../service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ─── Curated trips ────────────────────────────────────────────────────────────
//
// Replace the wineryIds arrays with real document ids before running.
// The order in `wineryIds` is the *suggested* visit order — Google's
// optimiser will re-order on Start Trip based on the user's location.
//
const trips = [
  {
    title: "Half-Day Classic",
    blurb:
      "A relaxed half-day through three of the region’s most-loved cellar doors — long lunch optional.",
    heroImage:
      "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200&q=80",
    durationHours: 4,
    wineryIds: [
      // ⚠ REPLACE with real wineries collection doc ids
      "pooley-wines",
      "pressing-matters-cellar-door",
      "tolpuddle-vineyard",
    ],
    region: "Coal River Valley",
    order: 1,
  },
  {
    title: "Riesling Tour",
    blurb:
      "Producers farming with the rhythms of the land. Low intervention, high reward.",
    heroImage:
      "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=1200&q=80",
    durationHours: 6,
    wineryIds: [
      "pressing-matters-cellar-door",
      "pooley-wines",
      "tolpuddle-vineyard",
      "stargazer-wine",
    ],
    region: "Coal River Valley",
    order: 2,
  },
  {
    title: "Family-Friendly Loop",
    blurb:
      "Dog-welcoming gardens, walk-in tastings, and a cellar door with a kids' playground.",
    heroImage:
      "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80",
    durationHours: 5,
    wineryIds: [
      "sisu-wines",
      "sinapius-wines",
      "tolpuddle-vineyard",
    ],
    region: "Coal River Valley",
    order: 3,
  },
  {
    title: "Long-Lunch Edition",
    blurb:
      "Three estates that take their cellar-door restaurants as seriously as their wine.",
    heroImage:
      "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80",
    durationHours: 6,
    wineryIds: [
      "tolpuddle-vineyard",
      "sisu-wines",
      "sinapius-wines",
    ],
    region: "Coal River Valley",
    order: 4,
  },
];

async function run() {
  console.log("\n🍷 Seeding premade_trips collection...\n");
  for (const trip of trips) {
    const ref = await db.collection("premade_trips").add(trip);
    console.log(`✅ Added: "${trip.title}" (id: ${ref.id})`);
  }
  console.log(
    "\n✅ Done! Edit wineryIds in this script before running, then update " +
      "the docs in the Firebase Console as needed.\n"
  );
}

run().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
