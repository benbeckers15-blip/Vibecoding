// add-boost-field.js
// ────────────────────────────────────────────────────────────────────────────────
// Backfill a `boost` field (default 0) onto every winery doc in Firestore.
//
// The concierge's candidate sort is now:
//   boost DESC, rating DESC
// so every winery needs SOME value to read. This script adds boost: 0
// to any doc that's missing it. Existing values are left alone.
//
// After running, raise the boost on the winery you want to surface
// first in the AI concierge's recommendations:
//   Firebase Console → wineries → <doc> → boost: 10
//
// Boost is a number, not a flag — higher wins. There's no fixed scale;
// pick whatever range feels right for you (0–10 is plenty for the
// current corpus size). Rating breaks ties, so unboosted wineries
// still order sensibly.
//
// USAGE
//   node scripts/add-boost-field.js
// ────────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function run() {
  const snapshot = await db.collection("wineries").get();
  const wineries = snapshot.docs;

  console.log(`\n🍷 Found ${wineries.length} wineries. Backfilling boost field...\n`);

  let updated = 0;
  let skipped = 0;

  for (const docSnap of wineries) {
    const data = docSnap.data();
    const name = data.name || docSnap.id;

    if (typeof data.boost === "number") {
      console.log(`✓  Skipping — boost already set (${data.boost}): ${name}`);
      skipped++;
      continue;
    }

    await db.collection("wineries").doc(docSnap.id).update({
      boost: 0,
    });

    console.log(`✅ ${name}`);
    updated++;
  }

  console.log(`\n——————————————————————————`);
  console.log(`✅ Updated:  ${updated} wineries`);
  console.log(`✓  Skipped:  ${skipped} wineries`);
  console.log(`——————————————————————————`);
  console.log(`
Next steps in Firebase Console → wineries:
  1. Find a winery you want to surface first in the AI concierge.
  2. Set  boost: 10  (or any positive number — higher wins).
  3. The concierge will sort that winery to the top of its
     candidate slice on relevant turns.

Boost is the PRIMARY recommendation signal. Google rating is only
used as a tie-breaker for unboosted wineries.\n`);
}

run().catch(console.error);
