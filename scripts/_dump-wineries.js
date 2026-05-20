// One-off: dump every wineries doc as {id, name} to stdout JSON.
const admin = require('firebase-admin');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(__dirname, '..', 'service-account-tasmania.json'))),
});

(async () => {
  const snap = await admin.firestore().collection('wineries').get();
  const out = [];
  snap.forEach(doc => {
    const d = doc.data();
    out.push({ id: doc.id, name: d.name || '', slug: d.slug || '' });
  });
  out.sort((a, b) => a.name.localeCompare(b.name));
  process.stdout.write(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
