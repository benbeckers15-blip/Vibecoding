// scripts/audit-winery-fields.js
// Checks every winery document for missing key fields and prints a report.
//
// Usage: node scripts/audit-winery-fields.js

const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const REQUIRED_FIELDS = ['phone', 'website', 'hours', 'images', 'description', 'latitude', 'longitude'];

async function main() {
  const snapshot = await db.collection('wineries').get();
  const wineries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  console.log(`\n🍷 Winery Field Audit — ${wineries.length} wineries\n`);
  console.log('─'.repeat(60));

  const fieldMissingCount = {};
  REQUIRED_FIELDS.forEach(f => fieldMissingCount[f] = 0);

  const incomplete = [];

  for (const winery of wineries.sort((a, b) => a.name.localeCompare(b.name))) {
    const missing = REQUIRED_FIELDS.filter(field => {
      const val = winery[field];
      return val === undefined || val === null || val === '' || val === 'N/A' ||
        (Array.isArray(val) && val.length === 0);
    });

    if (missing.length > 0) {
      incomplete.push({ name: winery.name, id: winery.id, missing });
      missing.forEach(f => fieldMissingCount[f]++);
    }
  }

  if (incomplete.length === 0) {
    console.log('✅ All wineries have all required fields populated!');
  } else {
    console.log(`⚠️  ${incomplete.length} of ${wineries.length} wineries have missing fields:\n`);
    for (const w of incomplete) {
      console.log(`   ${w.name}`);
      console.log(`   Missing: ${w.missing.join(', ')}\n`);
    }

    console.log('─'.repeat(60));
    console.log('\n📊 Summary — fields missing across all wineries:\n');
    for (const [field, count] of Object.entries(fieldMissingCount)) {
      if (count > 0) {
        const bar = '█'.repeat(count);
        console.log(`   ${field.padEnd(12)} ${bar} ${count}`);
      }
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
