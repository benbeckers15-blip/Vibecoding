// add-featured-fields.js
// Adds featured fields to all winery documents, defaulting to false.
// After running, go to Firebase Console and set featured: true
// on whichever winery you want to spotlight.
//
// Usage: node add-featured-fields.js

const admin = require("firebase-admin");
const serviceAccount = require("../service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function run() {
  const snapshot = await db.collection("wineries").get();
  const wineries = snapshot.docs;

  console.log(`\n🍷 Found ${wineries.length} wineries. Adding featured fields...\n`);

  let updated = 0;
  let skipped = 0;

  for (const docSnap of wineries) {
    const data = docSnap.data();
    const name = data.name || docSnap.id;

    if (typeof data.featured !== "undefined") {
      console.log(`✓  Skipping — fields already exist: ${name}`);
      skipped++;
      continue;
    }

    await db.collection("wineries").doc(docSnap.id).update({
      featured: false,
      featuredLabel: "",
      featuredTier: null,
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
  1. Find the winery you want to spotlight
  2. Set  featured: true
  3. Set  featuredLabel: "This Week's Pick"  (or any label you want)
  4. Set  featuredTier: "hero"

That's it — the app will show it on the home screen instantly.\n`);
}

run().catch(console.error);