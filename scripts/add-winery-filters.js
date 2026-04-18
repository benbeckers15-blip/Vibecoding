const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function run() {
  const snapshot = await db.collection("wineries").get();
  const wineries = snapshot.docs;

  console.log(`\n🍷 Found ${wineries.length} wineries. Adding filter fields...\n`);

  let updated = 0;
  let skipped = 0;

  for (const docSnap of wineries) {
    const data = docSnap.data();
    const name = data.name || docSnap.id;

    if (typeof data.dogFriendly !== "undefined") {
      console.log(`✓  Skipping — fields already exist: ${name}`);
      skipped++;
      continue;
    }

    await db.collection("wineries").doc(docSnap.id).update({
      dogFriendly: false,
      servesFood: false,
      walkInsWelcome: false,
      organicBiodynamic: false,
    });

    console.log(`✅ ${name}`);
    updated++;
  }

  console.log(`\n——————————————————————————`);
  console.log(`✅ Updated:  ${updated} wineries`);
  console.log(`✓  Skipped:  ${skipped} wineries`);
  console.log(`——————————————————————————\n`);
}

run().catch(console.error);