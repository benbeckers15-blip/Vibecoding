#!/usr/bin/env node
/**
 * List all winery document IDs from the Tasmania Firestore project.
 *
 * Usage:
 *   node scripts/list-winery-ids.js
 *
 * Writes:
 *   ./winery-ids.txt    one doc-ID per line
 *   ./winery-ids.json   [{ id, name, slug }] sorted by id
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccountPath = path.join(
  __dirname,
  '..',
  'service-account-tasmania.json'
);

if (!fs.existsSync(serviceAccountPath)) {
  console.error('service-account-tasmania.json not found in project root');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

const db = admin.firestore();

async function main() {
  const snap = await db.collection('wineries').get();
  const rows = snap.docs.map((d) => {
    const data = d.data() || {};
    return { id: d.id, name: data.name || '', slug: data.slug || '' };
  });
  rows.sort((a, b) => a.id.localeCompare(b.id));

  console.log(`Total wineries: ${rows.length}`);
  for (const r of rows) {
    console.log(r.id + (r.name ? `\t${r.name}` : ''));
  }

  const outDir = path.join(__dirname, '..');
  fs.writeFileSync(
    path.join(outDir, 'winery-ids.json'),
    JSON.stringify(rows, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, 'winery-ids.txt'),
    rows.map((r) => r.id).join('\n') + '\n'
  );

  console.log('\nWrote winery-ids.txt and winery-ids.json to project root.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
