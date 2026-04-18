const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  const snapshot = await db.collection('wineries').get();
  const hasId = snapshot.docs.filter(d => d.data().googlePlaceId);
  const noId  = snapshot.docs.filter(d => !d.data().googlePlaceId);
  console.log(`\n✅ Has googlePlaceId: ${hasId.length}`);
  console.log(`❌ Missing googlePlaceId: ${noId.length}`);
  if (noId.length) {
    console.log('\nMissing:');
    noId.forEach(d => console.log(`  - ${d.data().name || d.id}`));
  }
  process.exit(0);
}
main().catch(console.error);
