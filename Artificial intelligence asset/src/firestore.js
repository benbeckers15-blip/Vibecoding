/**
 * firestore.js — Firebase Admin connection + winery fetch.
 *
 * Loads the Tasmania service-account credentials, returns a Firestore
 * handle, and provides a single `fetchWineries()` helper that returns every
 * document in the `wineries` collection sorted alphabetically.
 *
 * The Admin SDK is intentionally used (not the client SDK) because this
 * script runs server-side / from a developer machine, not in React Native.
 */

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

let _app = null;
let _db = null;

function getDb() {
  if (_db) return _db;

  const credPath = path.resolve(
    __dirname,
    '..',
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '../service-account-tasmania.json'
  );

  if (!fs.existsSync(credPath)) {
    throw new Error(
      `Firebase service account not found at: ${credPath}\n` +
      `Set FIREBASE_SERVICE_ACCOUNT_PATH in .env or place the file at the expected location.`
    );
  }

  const serviceAccount = require(credPath);
  _app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  _db = admin.firestore(_app);
  return _db;
}

/**
 * Fetch every winery document and sort alphabetically by name.
 * Returns the raw Firestore data plus the document id under `id`.
 */
async function fetchWineries() {
  const db = getDb();
  const snap = await db.collection('wineries').get();
  return snap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/**
 * Shut down the underlying Firebase app. Call this at the end of any script
 * so the Node process exits cleanly.
 */
async function shutdown() {
  if (_app) {
    await _app.delete();
    _app = null;
    _db = null;
  }
}

module.exports = { getDb, fetchWineries, shutdown };
