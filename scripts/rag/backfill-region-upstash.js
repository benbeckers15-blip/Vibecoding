#!/usr/bin/env node
// scripts/rag/backfill-region-upstash.js
// ────────────────────────────────────────────────────────────────────────────────
// Backfill `regionId` on existing knowledge_chunks (Firestore) + their
// matching Upstash vectors. Pure metadata patch — no Claude re-tagging,
// no Voyage re-embedding. Runs in seconds, costs nothing.
//
// Use this AFTER bumping ingest.js to write regionId on new chunks, BUT
// BEFORE deploying the function changes that filter on regionId. Without
// the backfill, the strict filter in functions/src/concierge/knowledgeRetrieve.ts
// excludes every existing chunk and the concierge returns no regional
// knowledge until you either run this script or re-ingest from scratch.
//
// USAGE
//   node --env-file=.env scripts/rag/backfill-region-upstash.js
//   node --env-file=.env scripts/rag/backfill-region-upstash.js --region tasmania
//                                                       ← regionId tag (default: tasmania)
//   node --env-file=.env scripts/rag/backfill-region-upstash.js --dry-run
//                                                       ← count + skip writes
//   node --env-file=.env scripts/rag/backfill-region-upstash.js --force
//                                                       ← overwrite even chunks already tagged
// ────────────────────────────────────────────────────────────────────────────────

'use strict';

const { Index } = require('@upstash/vector');
const { getDb, COLLECTION } = require('./lib/firestore-client');

const NAMESPACE = 'knowledge';

// ─── CLI ───────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const REGION_ID = args.region ?? 'tasmania';
const DRY_RUN = args.dryRun;
const FORCE = args.force;

if (!/^[a-z0-9-]+$/.test(REGION_ID)) {
  console.error(`Invalid --region "${REGION_ID}". Expected lowercase kebab-case.`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--region') out.region = String(argv[++i] || '').trim();
  }
  return out;
}

// ─── Upstash ───────────────────────────────────────────────────────────────────

function getNamespace() {
  const url = process.env.UPSTASH_VECTOR_URL;
  const token = process.env.UPSTASH_VECTOR_TOKEN;
  if (!url) throw new Error('UPSTASH_VECTOR_URL is not set');
  if (!token) throw new Error('UPSTASH_VECTOR_TOKEN is not set');
  return new Index({ url, token }).namespace(NAMESPACE);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async function main() {
  console.log('🪛 SipLocal regionId backfill (knowledge namespace)');
  console.log(`   region:   ${REGION_ID}`);
  console.log(`   dry-run:  ${DRY_RUN}`);
  console.log(`   force:    ${FORCE}`);

  const db = getDb();
  const snap = await db.collection(COLLECTION).get();
  console.log(`\n${snap.size} chunk(s) in Firestore '${COLLECTION}'.`);

  if (snap.size === 0) {
    console.log("Nothing to do — collection is empty. Run scripts/rag/ingest.js first to populate it.");
    return;
  }

  const toBackfill = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!FORCE && data.regionId === REGION_ID) {
      continue; // already tagged
    }
    toBackfill.push({ id: doc.id, ref: doc.ref });
  }
  console.log(
    `${toBackfill.length} chunk(s) need updating ` +
    `(${snap.size - toBackfill.length} already tagged${FORCE ? '; --force will overwrite anyway' : ''}).`
  );

  if (DRY_RUN) {
    console.log('Dry run — exiting before writes.');
    return;
  }
  if (toBackfill.length === 0) {
    console.log('Nothing to do. ✅');
    return;
  }

  // ── 1. Patch Upstash metadata ──────────────────────────────────────────────
  // PATCH mode merges new fields into existing metadata without touching the
  // vector itself — no re-embedding cost, no risk of semantic drift.
  const ns = getNamespace();
  let upstashPatched = 0;
  let upstashMissing = 0;
  for (let i = 0; i < toBackfill.length; i++) {
    const { id } = toBackfill[i];
    try {
      await ns.update({
        id,
        metadata: { regionId: REGION_ID },
        metadataUpdateMode: 'PATCH',
      });
      upstashPatched++;
      if ((i + 1) % 20 === 0 || i === toBackfill.length - 1) {
        console.log(`  Upstash: ${i + 1}/${toBackfill.length}`);
      }
    } catch (err) {
      // A vector ID may be in Firestore but missing from Upstash if a
      // previous ingest run partially failed. Log and continue.
      upstashMissing++;
      console.warn(`  ✗ Upstash update failed for ${id}: ${err.message}`);
    }
  }
  console.log(`\nUpstash done — patched ${upstashPatched}, missing ${upstashMissing}.`);

  // ── 2. Patch Firestore docs ────────────────────────────────────────────────
  let firestorePatched = 0;
  const BATCH = 400; // Firestore batch limit is 500; leave headroom
  for (let i = 0; i < toBackfill.length; i += BATCH) {
    const slice = toBackfill.slice(i, i + BATCH);
    const wb = db.batch();
    for (const { ref } of slice) {
      wb.update(ref, { regionId: REGION_ID });
    }
    await wb.commit();
    firestorePatched += slice.length;
    console.log(`  Firestore: committed ${firestorePatched}/${toBackfill.length}`);
  }

  console.log(`\nDone. ✅`);
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
