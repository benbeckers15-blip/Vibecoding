#!/usr/bin/env node
// scripts/rag/ingest-tasting-notes.js
// ────────────────────────────────────────────────────────────────────────────────
// Build / update the SipLocal wines vector index.
//
// Source of truth: the `wines` Firestore collection. Each doc:
//   { wineryId, name, varietal, vintage, tastingNotes, boost? }
//
// For every wine in the collection:
//   • build a short header ("<name> — <varietal> <vintage>") and prepend it
//     to the tastingNotes prose so varietal/vintage tokens land in the
//     embedding vector
//   • embed with voyage-3-lite (512-dim — same model as the wineries +
//     knowledge indices; MUST match services/concierge/tastingNotes.ts)
//   • upsert to Upstash Vector under the `wines` namespace, with
//     metadata { wineId, wineryId, name, varietal, vintage, notes }
//
// Re-runs are safe: vector ID is the wine's Firestore doc ID, so
// existing wines are overwritten in place. No-op when the wines
// collection is empty (which it will be until you populate it).
//
// USAGE
//   node --env-file=.env scripts/rag/ingest-tasting-notes.js
//   node --env-file=.env scripts/rag/ingest-tasting-notes.js --limit 5   ← cap (debug)
//   node --env-file=.env scripts/rag/ingest-tasting-notes.js --delay 250 ← ms between wines
//   node --env-file=.env scripts/rag/ingest-tasting-notes.js --dry-run   ← parse only, no API
//   node --env-file=.env scripts/rag/ingest-tasting-notes.js --force     ← re-embed every wine
// ────────────────────────────────────────────────────────────────────────────────

'use strict';

const path = require('path');
const { Index } = require('@upstash/vector');

const { embedDocuments } = require('./lib/voyage-client');
const { sleep, fmtMs } = require('./lib/util');

// We don't reuse upstash-client.js from lib/ because that file hard-codes
// the `knowledge` namespace. Tasting notes go to their own `wines`
// namespace, so we hold our own Index handle here.
const WINES_NAMESPACE = 'wines';

// ─── CLI args ──────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const DELAY_MS = args.delay ?? 250;
const LIMIT = args.limit ?? Infinity;
const DRY_RUN = args.dryRun;
const FORCE = args.force;

function parseArgs(argv) {
  const out = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10);
    else if (a === '--delay') out.delay = parseInt(argv[++i], 10);
  }
  return out;
}

// ─── Firestore (Admin SDK) ─────────────────────────────────────────────────────

const admin = require('firebase-admin');

function getDb() {
  if (admin.apps.length) return admin.firestore();

  // Match the path resolution convention used by scripts/rag/lib/firestore-client.js
  // so the same FIREBASE_SERVICE_ACCOUNT_PATH env var works for both.
  const REPO_ROOT = path.join(__dirname, '..', '..');
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
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin.firestore();
}

// ─── Upstash (wines namespace) ─────────────────────────────────────────────────

let _ns = null;
function getNamespace() {
  if (_ns) return _ns;
  const url = process.env.UPSTASH_VECTOR_URL;
  const token = process.env.UPSTASH_VECTOR_TOKEN;
  if (!url) throw new Error('UPSTASH_VECTOR_URL is not set');
  if (!token) throw new Error('UPSTASH_VECTOR_TOKEN is not set');
  _ns = new Index({ url, token }).namespace(WINES_NAMESPACE);
  return _ns;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Build the text we actually embed. Prepending a short header anchors
// the embedding on varietal/vintage tokens — important because users
// usually search by those, not by the loose prose of a tasting note.
function buildEmbedText(wine) {
  const header = [wine.name, wine.varietal, wine.vintage]
    .filter((s) => typeof s === 'string' && s.trim().length > 0)
    .join(' — ');
  const notes = (wine.tastingNotes || '').trim();
  if (!header) return notes;
  if (!notes) return header;
  return `${header}\n\n${notes}`;
}

// Trim metadata strings defensively — Upstash has a per-payload size
// budget and stale-very-long notes would push it past the limit.
function clampMeta(s, max = 2000) {
  if (typeof s !== 'string') return '';
  const t = s.trim();
  return t.length > max ? t.slice(0, max - 3) + '...' : t;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async function main() {
  const t0 = Date.now();
  console.log('🍷 SipLocal tasting-note ingestion');
  console.log(`   dry-run:  ${DRY_RUN}`);
  console.log(`   force:    ${FORCE}`);
  console.log(`   delay:    ${DELAY_MS}ms`);

  const db = getDb();
  const snap = await db.collection('wines').get();
  const wines = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (!wines.length) {
    console.log('\n`wines` collection is empty. Add some wine docs and re-run.');
    console.log('Expected schema per doc:');
    console.log('  { wineryId, name, varietal, vintage, tastingNotes, boost? }');
    return;
  }
  console.log(`\nFound ${wines.length} wine doc(s) in Firestore.`);

  if (DRY_RUN) {
    console.log('\n--dry-run — exiting before API calls. First wine preview:');
    const first = wines[0];
    console.log('─'.repeat(60));
    console.log(buildEmbedText(first));
    console.log('─'.repeat(60));
    console.log(`(wineryId=${first.wineryId}, id=${first.id})`);
    return;
  }

  // Process serially with a small delay (rate-limit-friendly). One
  // embed call per wine — could be batched but the size of the dataset
  // doesn't justify the extra complexity right now.
  let ingested = 0;
  let skipped = 0;
  const ns = getNamespace();

  for (let i = 0; i < wines.length && i < LIMIT; i++) {
    const w = wines[i];
    const tag = `[${i + 1}/${Math.min(wines.length, LIMIT)}]`;

    if (!w.wineryId || !w.tastingNotes) {
      console.log(`${tag} ⏭  Skipping ${w.id} — missing wineryId or tastingNotes`);
      skipped++;
      continue;
    }

    try {
      const text = buildEmbedText(w);
      const [vector] = await embedDocuments([text]);

      await ns.upsert([{
        id: w.id,
        vector,
        metadata: {
          wineId: w.id,
          wineryId: String(w.wineryId),
          name: clampMeta(w.name || '', 200),
          varietal: clampMeta(w.varietal || '', 100),
          vintage: clampMeta(w.vintage || '', 20),
          notes: clampMeta(w.tastingNotes || '', 2000),
        },
      }]);

      ingested++;
      console.log(`${tag} ✓ ${w.id}  ${w.name} (${w.varietal} ${w.vintage}) — winery=${w.wineryId}`);
    } catch (err) {
      console.error(`${tag} ✗ ${w.id}  ${err.message}`);
    }

    if (DELAY_MS > 0 && i < wines.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(
    `\nDone — ingested ${ingested}/${wines.length} wine(s), skipped ${skipped}, in ${fmtMs(Date.now() - t0)}.`
  );
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
