// merge-ratings.js
const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function run() {
  const latestDoc = await db.collection("googleRatings").doc("latest").get();

  if (!latestDoc.exists) {
    console.error("❌ Could not find googleRatings/latest document.");
    return;
  }

  const latestData = latestDoc.data();
  const slugs = Object.keys(latestData);

  console.log(`\n🍷 Found ${slugs.length} winery ratings. Merging...\n`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const slug of slugs) {
    const value = latestData[slug];
    const rating = value?.rating;
    const userRatingsTotal = value?.userRatingsTotal;

    if (!rating && !userRatingsTotal) {
      console.warn(`⚠️  No rating data for: ${slug}`);
      skipped++;
      continue;
    }

    try {
      await db.collection("wineries").doc(slug).update({
        rating: rating ?? null,
        userRatingsTotal: userRatingsTotal ?? null,
      });
      console.log(`✅ ${slug} — ⭐ ${rating} (${userRatingsTotal} reviews)`);
      updated++;
    } catch (err) {
      console.warn(`⚠️  Could not update winery: ${slug}`);
      failed++;
    }
  }

  console.log(`\n——————————————————————————`);
  console.log(`✅ Updated:  ${updated} wineries`);
  console.log(`✓  Skipped:  ${skipped}`);
  console.log(`⚠️  Failed:   ${failed}`);
  console.log(`——————————————————————————\n`);
}

run().catch(console.error);