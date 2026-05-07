const admin = require("firebase-admin");
const path = require("path");
const serviceAccount = require(path.join("/sessions/confident-eager-keller/mnt/SipLocal", "service-account-tasmania.json"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "winery-tourism-tasmania.firebasestorage.app",
});
(async () => {
  const snap = await admin.firestore().collection("config").doc("homepage").get();
  console.log("Exists:", snap.exists);
  console.log("Data:", JSON.stringify(snap.data(), null, 2));
  // Also list hero-images/ in the bucket
  const [files] = await admin.storage().bucket().getFiles({ prefix: "hero-images/" });
  console.log("\nFiles in hero-images/:");
  for (const f of files) {
    const [meta] = await f.getMetadata();
    console.log(" -", f.name, "| size:", meta.size, "| updated:", meta.updated, "| contentType:", meta.contentType);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
