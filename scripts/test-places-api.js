// scripts/test-places-api.js
// Fetches raw Places API response for the first winery that has a googlePlaceId
// so we can see exactly what fields Google is returning.
//
// Usage: GOOGLE_MAPS_API_KEY='your-key' node scripts/test-places-api.js

const admin = require('firebase-admin');
const fetch = require('node-fetch');
const serviceAccount = require('../service-account.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GOOGLE_MAPS_API_KEY) {
    console.error('❌ Set GOOGLE_MAPS_API_KEY first');
    process.exit(1);
  }

  // Grab the first winery with a googlePlaceId
  const snapshot = await db.collection('wineries').get();
  const winery = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .find(w => w.googlePlaceId);

  if (!winery) {
    console.error('No winery with googlePlaceId found');
    process.exit(1);
  }

  console.log(`\n🍷 Testing with: ${winery.name}`);
  console.log(`   Place ID: ${winery.googlePlaceId}\n`);

  const fields = ['formatted_phone_number', 'website', 'opening_hours', 'photos'].join(',');
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${winery.googlePlaceId}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();

  console.log('📡 API Status:', data.status);
  console.log('\n📦 Raw result:');
  console.log(JSON.stringify(data.result, null, 2));

  process.exit(0);
}

main().catch(console.error);
