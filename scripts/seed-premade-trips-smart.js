// scripts/seed-premade-trips-smart.js
// ─────────────────────────────────────────────────────────────────────────────
// Auto-seeds the `premade_trips` collection by querying the live `wineries`
// collection and picking real doc IDs based on attributes.
//
//   node scripts/seed-premade-trips-smart.js
//
// Safe to re-run — clears the collection first.
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pick `n` random items from an array (no duplicates). */
function pick(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/** Pick `n` items from arr, fill remainder from fallback if needed. */
function pickWithFallback(arr, n, fallback) {
  const primary = pick(arr, Math.min(arr.length, n));
  if (primary.length >= n) return primary;
  const usedIds = new Set(primary.map((w) => w.id));
  const extras = fallback
    .filter((w) => !usedIds.has(w.id))
    .sort(() => Math.random() - 0.5)
    .slice(0, n - primary.length);
  return [...primary, ...extras];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n🍷 Fetching wineries from Firestore...");

  const snap = await db.collection("wineries").get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  console.log(`   Found ${all.length} wineries.\n`);

  // Attribute buckets
  const organic     = all.filter((w) => w.isOrganic);
  const biodynamic  = all.filter((w) => w.isBiodynamic);
  const orgOrBio    = all.filter((w) => w.isOrganic || w.isBiodynamic);
  const restaurant  = all.filter((w) => w.hasRestaurant);
  const dogFriendly = all.filter((w) => w.dogFriendly);
  const walkin      = all.filter((w) => w.walkinWelcome);
  const topRated    = all
    .filter((w) => w.rating >= 4.3)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

  console.log("Buckets:");
  console.log(`  organic/biodynamic : ${orgOrBio.length}`);
  console.log(`  has restaurant     : ${restaurant.length}`);
  console.log(`  dog friendly       : ${dogFriendly.length}`);
  console.log(`  walk-in welcome    : ${walkin.length}`);
  console.log(`  rated 4.3+         : ${topRated.length}`);
  console.log();

  // ── Trip definitions ────────────────────────────────────────────────────────
  //
  // Each trip picks a curated mix from the attribute buckets.
  // We use the top-rated pool as a fallback if a bucket is too small.

  const halfDayWineries     = pickWithFallback(topRated, 3, all);
  const naturalWineries     = pickWithFallback(orgOrBio, 4, topRated);
  const familyWineries      = pickWithFallback(
    dogFriendly.filter((w) => w.walkinWelcome),
    3,
    dogFriendly.length ? dogFriendly : walkin
  );
  const longLunchWineries   = pickWithFallback(restaurant, 3, topRated);

  const trips = [
    {
      title: "Half-Day Classic",
      blurb:
        "A relaxed half-day through three of the region's most-loved cellar doors — long lunch optional.",
      heroImage:
        "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200&q=80",
      durationHours: 4,
      wineryIds: halfDayWineries.map((w) => w.id),
      region: "Margaret River",
      order: 1,
    },
    {
      title: "Biodynamic & Organic",
      blurb:
        "Producers farming with the rhythms of the land. Low intervention, high reward.",
      heroImage:
        "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=1200&q=80",
      durationHours: 6,
      wineryIds: naturalWineries.map((w) => w.id),
      region: "Margaret River",
      order: 2,
    },
    {
      title: "Family-Friendly Loop",
      blurb:
        "Dog-welcoming gardens, walk-in tastings, and a relaxed afternoon at your own pace.",
      heroImage:
        "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80",
      durationHours: 5,
      wineryIds: familyWineries.map((w) => w.id),
      region: "Margaret River",
      order: 3,
    },
    {
      title: "Long-Lunch Edition",
      blurb:
        "Three estates that take their cellar-door restaurants as seriously as their wine.",
      heroImage:
        "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80",
      durationHours: 6,
      wineryIds: longLunchWineries.map((w) => w.id),
      region: "Margaret River",
      order: 4,
    },
  ];

  // ── Preview ─────────────────────────────────────────────────────────────────

  console.log("Trips to seed:");
  trips.forEach((t) => {
    console.log(`\n  "${t.title}"`);
    t.wineryIds.forEach((id) => {
      const w = all.find((x) => x.id === id);
      console.log(`    • ${w?.name ?? id} (${id})`);
    });
  });

  // ── Clear existing premade_trips ────────────────────────────────────────────

  console.log("\n🗑  Clearing existing premade_trips...");
  const existing = await db.collection("premade_trips").get();
  const deletes = existing.docs.map((d) => d.ref.delete());
  await Promise.all(deletes);
  console.log(`   Deleted ${deletes.length} existing docs.`);

  // ── Seed ────────────────────────────────────────────────────────────────────

  console.log("\n✍️  Seeding...");
  for (const trip of trips) {
    const ref = await db.collection("premade_trips").add(trip);
    console.log(`   ✅ "${trip.title}" → ${ref.id}`);
  }

  console.log("\n✅ Done!\n");
  process.exit(0);
}

run().catch((err) => {
  console.error("\n❌ Seed failed:", err.message);
  process.exit(1);
});
