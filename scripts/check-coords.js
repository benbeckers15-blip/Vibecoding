const admin = require("firebase-admin");
const serviceAccount = require("/sessions/sleepy-bold-wright/mnt/SipLocal/service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function checkWineries() {
  const targets = ["westella-vineyard", "devils-corner-cellar-door", "swinging-gate-vineyard"];
  // Also try searching by name in case slugs differ
  const snapshot = await db.collection("wineries").get();
  
  const results = [];
  snapshot.forEach(doc => {
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
  results.forEach(r => {
    const latOk = typeof r.latitude === "number" && r.latitude >= -90 && r.latitude <= 90;
    const lngOk = typeof r.longitude === "number" && r.longitude >= -180 && r.longitude <= 180;
    const inWA = r.latitude < -30 && r.latitude > -36 && r.longitude > 113 && r.longitude < 120;
    
    console.log(`Winery: ${r.name} (${r.id})`);
    console.log(`  latitude:  ${r.latitude} (type: ${r.latType}) — valid range: ${latOk ? "✅" : "❌"} — in WA region: ${inWA ? "✅" : "❌"}`);
    console.log(`  longitude: ${r.longitude} (type: ${r.lngType}) — valid range: ${lngOk ? "✅" : "❌"}`);
    if (!latOk || !lngOk) {
      console.log(`  ⚠️  PROBLEM DETECTED — coordinates are missing or out of range`);
    }
    if (!inWA && latOk && lngOk) {
      console.log(`  ⚠️  PROBLEM DETECTED — coordinates are valid numbers but NOT in Western Australia`);
    }
    console.log();
  });
}

checkWineries().catch(console.error).finally(() => process.exit(0));
