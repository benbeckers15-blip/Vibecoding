// scripts/fix-slugs.js
// Sets the slug field on any winery document that is missing it,
// using the Firestore document ID as the slug value.
//
// Usage: node scripts/fix-slugs.js

const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  const snapshot = await db.collection('wineries').get();

  const toFix = snapshot.docs.filter(doc => !doc.data().slug);

  if (toFix.length === 0) {
    console.log('\n✅ All wineries already have a slug field — nothing to do.');
    process.exit(0);
  }

  console.log(`\n🔧 Found ${toFix.length} wineries missing a slug field. Fixing...\n`);

  const batch = db.batch();
  for (const doc of toFix) {
    batch.update(doc.ref, { slug: doc.id });
    console.log(`   📝 ${doc.data().name || doc.id}  →  slug: "${doc.id}"`);
  }

  await batch.commit();
  console.log(`\n✅ Done — ${toFix.length} wineries updated.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
