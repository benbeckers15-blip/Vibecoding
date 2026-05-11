// scripts/add-award-region-fields.js
// Adds `awardWinning` (boolean) and `region` (string) fields to all winery documents.
//
// Behaviour:
//   - awardWinning: always set to false (update manually in Firestore for winners)
//   - region:       only written if the field is missing — existing values are preserved
//
// Run: node scripts/add-award-region-fields.js

const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function run() {
  const snapshot = await db.collection("wineries").get();
  const docs = snapshot.docs;

  console.log(`\n🍷 Found ${docs.length} wineries. Processing...\n`);

  let updated = 0;
  let skipped = 0;

  for (const docSnap of docs) {
    const data = docSnap.data();
    const name = data.name || docSnap.id;

    const alreadyHasAward = typeof data.awardWinning !== "undefined";
    const alreadyHasRegion = typeof data.region !== "undefined";

    if (alreadyHasAward && alreadyHasRegion) {
      console.log(`✓  Skipping — both fields exist: ${name}`);
      skipped++;
      continue;
    }

    const updates = {};

    // Always reset awardWinning to false if missing
    if (!alreadyHasAward) {
      updates.awardWinning = false;
    }

    // Only add region if it's completely missing (preserve existing values)
    if (!alreadyHasRegion) {
      updates.region = "";
    }

    await db.collection("wineries").doc(docSnap.id).update(updates);

    const fieldsSummary = Object.keys(updates).join(", ");
    console.log(`✅ Updated [${fieldsSummary}]: ${name}`);
    updated++;
  }

  console.log(`\n——————————————————————————`);
  console.log(`✅ Updated:  ${updated} wineries`);
  console.log(`✓  Skipped:  ${skipped} wineries (fields already present)`);
  console.log(`——————————————————————————\n`);
}

run().catch(console.error);
