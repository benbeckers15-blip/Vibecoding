const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = require('./service-account.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const COLLECTION = 'wineries';
const DATA_FILE = './winery_classifications_all.json';

async function main() {
  const classifications = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  // Remove duplicates — keep first occurrence of each firestore_doc_id
  const seen = new Set();
  const unique = classifications.filter(w => {
    if (!w.firestore_doc_id || seen.has(w.firestore_doc_id)) return false;
    seen.add(w.firestore_doc_id);
    return true;
  });

  console.log(`\n📋 Preparing to update ${unique.length} wineries...\n`);

  const batch = db.batch();

  for (const w of unique) {
    // Skip Lamont's — deleted from Firestore
    if (w.firestore_doc_id === "lamont's" || w.firestore_doc_id === 'lamonts') {
      console.log(`  ⏭️  Skipping Lamont's (not in Firestore)`);
      continue;
    }

    const ref = db.collection(COLLECTION).doc(w.firestore_doc_id);

    batch.update(ref, {
      // ── Delete old fields ──────────────────────────
      organicBiodynamic:  admin.firestore.FieldValue.delete(),
      servesFood:         admin.firestore.FieldValue.delete(),
      walkinswelcome:     admin.firestore.FieldValue.delete(),

      // ── Add new fields ─────────────────────────────
      dogFriendly:        w.dog_friendly,
      isOrganic:          w.organic,
      isBiodynamic:       w.biodynamic,
      hasWifi:            w.wifi,
      hasRestaurant:      w.has_restaurant,
    });

    console.log(`  📝 ${w.title}`);
    console.log(`     🐶 dogFriendly: ${w.dog_friendly} (${w.dog_friendly_confidence})`);
    console.log(`     🌿 isOrganic: ${w.organic} (${w.organic_confidence})`);
    console.log(`     🍇 isBiodynamic: ${w.biodynamic} (${w.biodynamic_confidence})`);
    console.log(`     📶 hasWifi: ${w.wifi} (${w.wifi_confidence})`);
    console.log(`     🍽️  hasRestaurant: ${w.has_restaurant} (${w.has_restaurant_confidence})\n`);
  }

  console.log('⏳ Committing to Firestore...\n');
  await batch.commit();
  console.log('🎉 All wineries updated successfully!');
}

main().catch(console.error);