// geocode-wineries.js
const admin = require("firebase-admin");
const fetch = require("node-fetch");

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const serviceAccount = require("./service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function getCoordinatesFromPlaceId(placeId, name) {
  const trimmedId = placeId.trim();
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${trimmedId}&fields=geometry&key=${GOOGLE_MAPS_API_KEY}`;

  console.log(`\n🔍 DEBUG — ${name}`);
  console.log(`   Place ID: "${trimmedId}" (length: ${trimmedId.length})`);
  console.log(`   URL: ${url}\n`);

  const response = await fetch(url);
  const data = await response.json();

  if (
    data.status === "OK" &&
    data.result &&
    data.result.geometry &&
    data.result.geometry.location
  ) {
    const { lat, lng } = data.result.geometry.location;
    return { latitude: lat, longitude: lng };
  }

  console.warn(`⚠️  Failed: "${trimmedId}" (status: ${data.status})`);
  return null;
}

async function run() {
  const snapshot = await db.collection("wineries").get();
  const wineries = snapshot.docs;

  console.log(`\n🍷 Found ${wineries.length} wineries. Starting geocoding...\n`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const docSnap of wineries) {
    const data = docSnap.data();
    const name = data.name || docSnap.id;
    const placeId = data.googlePlaceId;

    if (data.latitude && data.longitude) {
      console.log(`✓  Skipping — already has coordinates: ${name}`);
      skipped++;
      continue;
    }

    if (!placeId) {
      console.warn(`⚠️  No googlePlaceId found for: ${name}`);
      failed++;
      continue;
    }

    const coords = await getCoordinatesFromPlaceId(placeId, name);

    if (coords) {
      await db.collection("wineries").doc(docSnap.id).update({
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      console.log(`✅ ${name} → ${coords.latitude}, ${coords.longitude}\n`);
      success++;
    } else {
      failed++;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  console.log(`\n——————————————————————————`);
  console.log(`✅ Updated:  ${success}`);
  console.log(`✓  Skipped:  ${skipped}`);
  console.log(`⚠️  Failed:   ${failed}`);
  console.log(`——————————————————————————\n`);
}

run().catch(console.error);