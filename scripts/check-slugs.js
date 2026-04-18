// scripts/check-slugs.js
// Checks every winery document for a mismatch between its Firestore document ID
// and its slug field, then prints a report.
//
// Usage: node scripts/check-slugs.js

const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  const snapshot = await db.collection('wineries').get();

  const ok = [];
  const missing = [];   // slug field is absent
  const mismatch = [];  // slug field exists but != document ID

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const docId = doc.id;
    const slug  = data.slug;

    if (!slug) {
      missing.push({ docId, name: data.name });
    } else if (slug !== docId) {
      mismatch.push({ docId, slug, name: data.name });
    } else {
      ok.push(docId);
    }
  }

  console.log(`\n✅ OK (slug matches doc ID): ${ok.length}`);

  if (missing.length) {
    console.log(`\n⚠️  Missing slug field (${missing.length}):`);
    missing.forEach(w => console.log(`   "${w.name}"  —  doc ID: ${w.docId}`));
  }

  if (mismatch.length) {
    console.log(`\n❌ Slug/ID mismatch (${mismatch.length}) — these will show "Winery not found":`);
    mismatch.forEach(w =>
      console.log(`   "${w.name}"\n     doc ID: ${w.docId}\n     slug:   ${w.slug}`)
    );
  }

  if (!missing.length && !mismatch.length) {
    console.log('\n🎉 All slugs match their document IDs — data looks clean!');
  } else {
    console.log('\n💡 Run fix-slugs.js to repair these automatically.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
