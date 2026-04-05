const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = require('./service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const COLLECTION = 'wineries';
const PLACE_ID_FIELD = 'googlePlaceId';
const OUTPUT_FILE = 'place_ids.txt';

async function extractPlaceIds() {
  const snapshot = await db.collection(COLLECTION).get();

  if (snapshot.empty) {
    console.log('❌ No documents found in collection.');
    return;
  }

  const placeIds = [];
  const missing = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    const placeId = data[PLACE_ID_FIELD];

    if (placeId) {
      placeIds.push(placeId);
    } else {
      missing.push(doc.id);
    }
  });

  // Print to console
  console.log(placeIds.join('\n'));

  // Save to file — one place ID per line
  fs.writeFileSync(OUTPUT_FILE, placeIds.join('\n'), 'utf8');

  console.log(`\n✅ ${placeIds.length} place IDs saved to ${OUTPUT_FILE}`);

  if (missing.length > 0) {
    console.log(`\n⚠️  ${missing.length} winer${missing.length === 1 ? 'y' : 'ies'} missing a googlePlaceId:`);
    missing.forEach(id => console.log(`   - ${id}`));
  }
}

extractPlaceIds().catch(console.error);