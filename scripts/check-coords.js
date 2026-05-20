// scripts/check-coords.js
// Sanity-check a small set of winery documents — verify that latitude /
// longitude exist, are numbers, are in a plausible range, and fall inside
// Tasmania's geographic bounds.

const path = require("path");
const admin = require("firebase-admin");
const serviceAccount = require(path.resolve(
  __dirname,
  "..",
  "service-account-tasmania.json"
));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Tasmania bounding box (approximate, generous):
//   latitude:  -43.7 .. -40.5
//   longitude: 144.5 .. 148.5
function inTasmania(lat, lng) {
  return lat <= -40.5 && lat >= -43.7 && lng >= 144.5 && lng <= 148.5;
}

async function checkWineries() {
  const targets = [
    "westella-vineyard",
    "devils-corner-cellar-door",
    "swinging-gate-vineyard",
  ];

  const snapshot = await db.collection("wineries").get();

  const results = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    const name = (data.name || "").toLowerCase();
    if (
      name.includes("westella") ||
      name.includes("devils corner") ||
      name.includes("swinging gate")
    ) {
      results.push({
        id: doc.id,
        name: data.name,
        latitude: data.latitude,
        longitude: data.longitude,
        latType: typeof data.latitude,
        lngType: typeof data.longitude,
      });
    }
  });

  if (results.length === 0) {
    console.log("No matching wineries found by name. Trying by slug...");
    for (const slug of targets) {
      const doc = await db.collection("wineries").doc(slug).get();
      if (doc.exists) {
        const data = doc.data();
        results.push({
          id: doc.id,
          name: data.name,
          latitude: data.latitude,
          longitude: data.longitude,
          latType: typeof data.latitude,
          lngType: typeof data.longitude,
        });
      } else {
        console.log(`Doc not found for slug: ${slug}`);
      }
    }
  }

  console.log("\n=== COORDINATE CHECK ===\n");
  results.forEach((r) => {
    const latOk =
      typeof r.latitude === "number" && r.latitude >= -90 && r.latitude <= 90;
    const lngOk =
      typeof r.longitude === "number" && r.longitude >= -180 && r.longitude <= 180;
    const inTas = latOk && lngOk && inTasmania(r.latitude, r.longitude);

    console.log(`Winery: ${r.name} (${r.id})`);
    console.log(
      `  latitude:  ${r.latitude} (type: ${r.latType}) — valid range: ${
        latOk ? "ok" : "FAIL"
      } — in Tasmania: ${inTas ? "ok" : "NO"}`
    );
    console.log(
      `  longitude: ${r.longitude} (type: ${r.lngType}) — valid range: ${
        lngOk ? "ok" : "FAIL"
      }`
    );
    if (!latOk || !lngOk) {
      console.log("  PROBLEM — coordinates are missing or out of range");
    }
    if (latOk && lngOk && !inTas) {
      console.log("  PROBLEM — coordinates are valid numbers but NOT in Tasmania");
    }
    console.log();
  });
}

checkWineries()
  .catch(console.error)
  .finally(() => process.exit(0));
