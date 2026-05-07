// scripts/check-explore-articles.js
// Diagnostic — prints contents of `explore_articles` in the Tasmania project.
const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

(async () => {
  console.log("Project:", serviceAccount.project_id);
  const snap = await db.collection("explore_articles").get();
  console.log(`Found ${snap.size} document(s) in explore_articles\n`);
  snap.forEach((doc) => {
    console.log("—", doc.id);
    console.log(JSON.stringify(doc.data(), null, 2));
    console.log();
  });
  process.exit(0);
})().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
