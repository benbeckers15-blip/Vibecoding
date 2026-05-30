#!/usr/bin/env node
// scripts/rag/ingest-tasting-notes.js
// ────────────────────────────────────────────────────────────────────────────────
// Build / update the SipLocal wines vector index.
//
// Source of truth: the `wines` Firestore collection. Each doc may carry
// any subset of these fields (populated rows in the source spreadsheet
// often leave categorical tags blank — that's expected):
//   { wineryId, name, vintage, region, variety, style, color, body,
//     sweetness, oak, abv, price, pairings, awards, authorNotes,
//     tastingNotes, boost? }
// (`varietal` is accepted as a legacy alias for `variety`.)
//
// For every wine in the collection:
//   • build a multi-line "facts header" from whichever metadata fields
//     are populated (blank fields are dropped — no placeholders), then
//     append the tastingNotes prose and any authorNotes. This keeps
//     categorical signal (variety, sweetness, body…) as discrete tokens
//     in the embedding vector instead of relying on them appearing in
//     the loose prose, while degrading gracefully on partial metadata.
//   • embed with voyage-3-lite (512-dim — same model as the wineries +
//     knowledge indices; MUST match functions/src/concierge/tastingNotes.ts)
//   • upsert to Upstash Vector under the `wines` namespace, passing
//     every populated field through into metadata so the response model
//     can talk about price / pairings / awards without re-fetching
//     anything from Firestore.
//
// Re-runs are safe: vector ID is the wine's Firestore doc ID, so
// existing wines are overwritten in place. No-op when the wines
// collection is empty (which it will be until you populate it).
//
// USAGE
//   node --env-file=.env scripts/rag/ingest-tasting-notes.js
//   node --env-file=.env scripts/rag/ingest-tasting-notes.js --region tasmania
//                                                              ← regionId tag (default: tasmania)
//   node --env-file=.env scripts/rag/ingest-tasting-notes.js --limit 5   ← cap (debug)
//   node --env-file=.env scripts/rag/ingest-tasting-notes.js --delay 250 ← ms between wines
//   node --env-file=.env scripts/rag/ingest-tasting-notes.js --dry-run   ← parse only, no API
//   node --env-file=.env scripts/rag/ingest-tasting-notes.js --force     ← re-embed every wine
//
// Multi-region note: every wine gets a `regionId` metadata field on its
// Upstash vector. The retrieval code in functions/src/concierge/tastingNotes.ts
// filters on regionId — wines without it will silently be excluded. Re-run
// to backfill the metadata onto existing wines after a schema upgrade.
// ────────────────────────────────────────────────────────────────────────────────

'use strict';

const path = require('path');

// Only require heavy modules when this file is executed as a script —
// when it's required from a test we just want the pure helpers.
const isMain = require.main === module;
const { Index } = isMain ? require('@upstash/vector') : { Index: null };
const { embedDocuments } = isMain
  ? require('./lib/voyage-client')
  : { embedDocuments: null };
const { sleep, fmtMs } = isMain
  ? require('./lib/util')
  : { sleep: null, fmtMs: null };

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
const REGION_ID = args.region ?? 'tasmania';

if (!/^[a-z0-9-]+$/.test(REGION_ID)) {
  console.error(`Invalid --region "${REGION_ID}". Expected lowercase kebab-case (e.g. "tasmania", "margaret-river").`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10);
    else if (a === '--delay') out.delay = parseInt(argv[++i], 10);
    else if (a === '--region') out.region = String(argv[++i] || '').trim();
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

// Normalise a possibly-numeric / possibly-padded field to a trimmed
// string. Returns '' if the value is null / undefined / empty / NaN.
function s(value) {
  if (value === null || value === undefined) return '';
  const out = String(value).trim();
  return out.length === 0 ? '' : out;
}

// Build the multi-line text we actually embed. Each populated field
// becomes a labelled token sequence so voyage-3-lite has discrete
// hooks for categorical queries ("dry riesling", "tasmanian pinot",
// "low-oak chardonnay") even when those words never appear in the
// loose tasting-note prose. Blank fields are dropped entirely — there
// are no placeholder strings like "Sweetness: unknown" that would
// dilute the vector for wines with sparse metadata.
//
// `wineryName` (optional) is spliced in at the top so a query like
// "wines from Bangor Vineyard Shed" or "Frogmore's chardonnay" has
// something concrete to match against in the vector. Without it,
// Voyage had no semantic signal connecting a wine to its winery
// beyond the slug — the wineryId metadata filter alone wasn't enough
// to surface a winery's wines when the user asked for them by name
// (the cosine scores landed below the minScore floor in retrieval).
// See functions/src/concierge/tastingNotes.ts for the retrieval side.
function buildEmbedText(wine, wineryName) {
  const lines = [];

  const winery = s(wineryName);
  if (winery) lines.push(`Winery: ${winery}`);

  const name = s(wine.name);
  if (name) lines.push(`Wine: ${name}`);

  // Identity facts (the most discriminating columns)
  const variety = s(wine.variety) || s(wine.varietal);
  const vintage = s(wine.vintage);
  const region = s(wine.region);
  const ident = [];
  if (variety) ident.push(`Variety: ${variety}`);
  if (vintage) ident.push(`Vintage: ${vintage}`);
  if (region) ident.push(`Region: ${region}`);
  if (ident.length) lines.push(ident.join(' | '));

  // Sensory facts
  const style = s(wine.style);
  const color = s(wine.color);
  const body = s(wine.body);
  const sweetness = s(wine.sweetness);
  const oak = s(wine.oak);
  const sensory = [];
  if (style) sensory.push(`Style: ${style}`);
  if (color) sensory.push(`Color: ${color}`);
  if (body) sensory.push(`Body: ${body}`);
  if (sweetness) sensory.push(`Sweetness: ${sweetness}`);
  if (oak) sensory.push(`Oak: ${oak}`);
  if (sensory.length) lines.push(sensory.join(' | '));

  // Spec facts
  const abv = s(wine.abv);
  const price = s(wine.price);
  const spec = [];
  if (abv) spec.push(`ABV: ${abv}${abv.includes('%') ? '' : '%'}`);
  if (price) spec.push(`Price: ${price.startsWith('$') ? price : '$' + price}`);
  if (spec.length) lines.push(spec.join(' | '));

  const pairings = s(wine.pairings);
  if (pairings) lines.push(`Pairings: ${pairings}`);

  const awards = s(wine.awards);
  if (awards) lines.push(`Awards: ${awards}`);

  const header = lines.join('\n');
  const notes = s(wine.tastingNotes);
  const author = s(wine.authorNotes);

  const parts = [];
  if (header) parts.push(header);
  if (notes) parts.push(notes);
  if (author) parts.push(`Author note: ${author}`);

  return parts.join('\n\n');
}

// Trim metadata strings defensively — Upstash has a per-payload size
// budget and stale-very-long notes would push it past the limit.
function clampMeta(s, max = 2000) {
  if (typeof s !== 'string') return '';
  const t = s.trim();
  return t.length > max ? t.slice(0, max - 3) + '...' : t;
}

// Expose pure helpers for unit tests / re-use without triggering the
// main script behaviour. Anything that requires this file should still
// be ready to use these without an Upstash / Voyage / Firestore setup.
module.exports = { buildEmbedText, clampMeta };

// ─── Main ──────────────────────────────────────────────────────────────────────

if (isMain) (async function main() {
  const t0 = Date.now();
  console.log('🍷 SipLocal tasting-note ingestion');
  console.log(`   region:   ${REGION_ID}`);
  console.log(`   dry-run:  ${DRY_RUN}`);
  console.log(`   force:    ${FORCE}`);
  console.log(`   delay:    ${DELAY_MS}ms`);

  const db = getDb();
  // Load wines and the wineries directory in parallel. We need the
  // wineries collection so buildEmbedText can splice each wine's
  // winery name into the embedded text — wineryId alone (a slug like
  // "bangor-vineyard-shed") isn't a useful semantic signal for
  // Voyage. The wineries collection is small (low hundreds of docs),
  // so loading it whole and building an in-memory slug→name map is
  // cheaper than per-wine getDoc calls.
  const [winesSnap, wineriesSnap] = await Promise.all([
    db.collection('wines').get(),
    db.collection('wineries').get(),
  ]);
  const wines = winesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // wineryId on each wine doc IS the winery's slug (== Firestore doc
  // id on the wineries collection — see CLAUDE.md, "Firestore Collections").
  // We try both `slug` and the doc id when building the map so the
  // lookup works regardless of which convention a given winery doc
  // was written with.
  const wineryNameById = new Map();
  for (const d of wineriesSnap.docs) {
    const data = d.data();
    const name = data && data.name ? String(data.name) : '';
    if (!name) continue;
    if (data.slug) wineryNameById.set(String(data.slug), name);
    wineryNameById.set(d.id, name);
  }
  console.log(`   wineries: ${wineryNameById.size} name(s) loaded for embed splice`);

  if (!wines.length) {
    console.log('\n`wines` collection is empty. Add some wine docs and re-run.');
    console.log('Expected schema per doc (every field except wineryId + tastingNotes is optional):');
    console.log('  { wineryId, name, vintage, region, variety, style, color, body,');
    console.log('    sweetness, oak, abv, price, pairings, awards, authorNotes,');
    console.log('    tastingNotes, boost? }');
    console.log('\nUse `scripts/seed-wines-from-csv.js` to load rows from a CSV export of your sheet.');
    return;
  }
  console.log(`\nFound ${wines.length} wine doc(s) in Firestore.`);

  if (DRY_RUN) {
    console.log('\n--dry-run — exiting before API calls. First wine preview:');
    const first = wines[0];
    const firstWineryName = wineryNameById.get(String(first.wineryId)) || '';
    console.log('─'.repeat(60));
    console.log(buildEmbedText(first, firstWineryName));
    console.log('─'.repeat(60));
    console.log(`(wineryId=${first.wineryId}, wineryName=${firstWineryName || '(none)'}, id=${first.id})`);
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
      const wineryName = wineryNameById.get(String(w.wineryId)) || '';
      if (!wineryName) {
        // Surface a per-wine warning so a mismatched slug (or a wine
        // that points at a winery no longer in the corpus) is loud
        // in the ingest log instead of silently degrading the embed.
        console.warn(
          `${tag} ⚠  no winery name found for wineryId="${w.wineryId}" (wine="${w.id}") — embedding without it`
        );
      }
      const text = buildEmbedText(w, wineryName);
      const [vector] = await embedDocuments([text]);

      // Build the metadata payload. Every populated field is passed
      // through so the response model can talk about price / pairings /
      // awards directly from retrieval output without an extra Firestore
      // round-trip. Blank fields are dropped from the payload to keep
      // it compact and to make "missing metadata" obvious downstream
      // (rather than masking it as an empty string).
      const meta = {
        // regionId is the partition key the retrieval filter in
        // functions/src/concierge/tastingNotes.ts requires.
        regionId: REGION_ID,
        wineId: w.id,
        wineryId: String(w.wineryId),
      };
      const setIf = (key, raw, max) => {
        const val = clampMeta(typeof raw === 'string' ? raw : (raw == null ? '' : String(raw)), max);
        if (val) meta[key] = val;
      };
      setIf('name', w.name, 200);
      setIf('variety', w.variety || w.varietal, 100);
      setIf('vintage', w.vintage, 20);
      setIf('region', w.region, 100);
      setIf('style', w.style, 100);
      setIf('color', w.color, 50);
      setIf('body', w.body, 50);
      setIf('sweetness', w.sweetness, 50);
      setIf('oak', w.oak, 100);
      setIf('abv', w.abv, 20);
      setIf('price', w.price, 20);
      setIf('pairings', w.pairings, 500);
      setIf('awards', w.awards, 500);
      setIf('authorNotes', w.authorNotes, 1000);
      setIf('notes', w.tastingNotes, 2000);

      await ns.upsert([{ id: w.id, vector, metadata: meta }]);

      ingested++;
      const varietyShown = meta.variety || '—';
      const vintageShown = meta.vintage || '—';
      console.log(`${tag} ✓ ${w.id}  ${meta.name || w.id} (${varietyShown} ${vintageShown}) — winery=${w.wineryId}`);
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

