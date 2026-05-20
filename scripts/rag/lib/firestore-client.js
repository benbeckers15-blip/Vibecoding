// scripts/rag/lib/firestore-client.js
// Firestore Admin SDK wrapper. Uses the same service-account-tasmania.json
// the rest of the scripts use.
'use strict';

const path = require('path');
const admin = require('firebase-admin');

const COLLECTION = 'knowledge_chunks';

let _db = null;

function getDb() {
  if (_db) return _db;

  // Resolve the service-account JSON path. The existing repo convention
  // (used by every script in scripts/) is that FIREBASE_SERVICE_ACCOUNT_PATH
  // in .env is *relative to scripts/* — e.g. "../service-account-tasmania.json"
  // points to the repo root. We honour that convention so the same .env value
  // keeps working whether the caller lives in scripts/ or scripts/rag/.
  const REPO_ROOT = path.join(__dirname, '..', '..', '..');
  const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  let credPath;
  if (envPath) {
    credPath = path.isAbsolute(envPath)
      ? envPath
      : path.resolve(REPO_ROOT, 'scripts', envPath);
  } else {
    credPath = path.join(REPO_ROOT, 'service-account-tasmania.json');
  }

  const serviceAccount = require(credPath);

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  _db = admin.firestore();
  return _db;
}

/** Cheap existence check — used to skip already-ingested chunks. */
async function chunkExists(id) {
  const snap = await getDb().collection(COLLECTION).doc(id).get();
  return snap.exists;
}

/**
 * Store the full chunk: text, every metadata field, and provenance.
 * Idempotent — uses .set() with the deterministic chunk ID so re-runs
 * overwrite cleanly.
 */
async function saveChunk(doc) {
  await getDb().collection(COLLECTION).doc(doc.id).set({
    ...doc,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Batch-fetch chunks by ID. Used at query time after Upstash returns its
 * topK hits — Upstash carries the lightweight metadata, Firestore has the
 * full text.
 */
async function getChunksByIds(ids) {
  if (!ids.length) return [];
  const refs = ids.map(id => getDb().collection(COLLECTION).doc(id));
  const snaps = await getDb().getAll(...refs);
  return snaps
    .filter(s => s.exists)
    .map(s => ({ id: s.id, ...s.data() }));
}

module.exports = { getDb, chunkExists, saveChunk, getChunksByIds, COLLECTION };
