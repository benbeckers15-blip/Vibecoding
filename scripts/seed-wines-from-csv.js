#!/usr/bin/env node
// scripts/seed-wines-from-csv.js
// ─────────────────────────────────────────────────────────────────────────────
// Seed the `wines` Firestore collection from a CSV export of the
// "wines-template.xlsx" Google Sheet.
//
// USAGE
//   1. In Google Sheets / Excel, export the populated `Template` sheet as CSV.
//   2. Drop the file at `scripts/rag/wines.csv` (or pass a different path
//      with --file).
//   3. Run:
//        node scripts/seed-wines-from-csv.js
//        node scripts/seed-wines-from-csv.js --dry-run
//        node scripts/seed-wines-from-csv.js --file path/to/other.csv
//        node scripts/seed-wines-from-csv.js --limit 5
//        node scripts/seed-wines-from-csv.js --region tasmania
//        node scripts/seed-wines-from-csv.js --allow-missing-winery
//
// EXPECTED CSV COLUMNS (header row, in any order — extra columns ignored):
//   wineryId      — required. Must match a Firestore `wineries` doc ID
//                   (i.e. the slug). Rows with an unknown wineryId are
//                   skipped unless --allow-missing-winery is passed.
//   wineryName    — display only, used for log output. Not stored.
//   wineName      — required for ingest, but rows with this blank are
//                   treated as template scaffolding and silently skipped
//                   (the xlsx ships with 262 blank rows pre-stamped with
//                   wineryId/wineryName).
//   vintage, region, variety, style, color, body, sweetness, oak,
//   abv, price, tastingNotes, pairings, awards, authorNotes
//                 — all optional. Blank cells are dropped from the
//                   resulting Firestore doc (no empty-string fields) so
//                   the downstream ingest script sees "missing" the
//                   same way for sheet-blank and CSV-blank.
//
// DOC ID SCHEME
//   {wineryId}__{slug(wineName)}-{vintage}  if vintage is present
//   {wineryId}__{slug(wineName)}            otherwise
//
//   Re-runs are idempotent — same wineryId + wineName + vintage maps to
//   the same Firestore doc, so editing the sheet and re-seeding just
//   updates in place.
//
// NEXT STEP AFTER SEEDING
//   node --env-file=.env scripts/rag/ingest-tasting-notes.js
//     (embeds every `wines` doc into the Upstash `wines` namespace so
//      the concierge can retrieve them on the next conversation turn.
//      Re-run after every CSV change.)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs = require('fs');
const path = require('path');

const isMain = require.main === module;
const admin = isMain ? require('firebase-admin') : null;

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = isMain ? parseArgs(process.argv.slice(2)) : { dryRun: false };
const CSV_PATH = path.resolve(args.file || path.join(__dirname, 'rag', 'wines.csv'));
const DRY_RUN = !!args.dryRun;
const LIMIT = args.limit ?? Infinity;
const REGION_ID = args.region ?? 'tasmania';
const ALLOW_MISSING_WINERY = !!args.allowMissingWinery;

function parseArgs(argv) {
  const out = { dryRun: false, allowMissingWinery: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--allow-missing-winery') out.allowMissingWinery = true;
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10);
    else if (a === '--file') out.file = String(argv[++i] || '').trim();
    else if (a === '--region') out.region = String(argv[++i] || '').trim();
    else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

if (isMain && !/^[a-z0-9-]+$/.test(REGION_ID)) {
  console.error(`Invalid --region "${REGION_ID}". Expected lowercase kebab-case (e.g. "tasmania").`);
  process.exit(1);
}

// ─── Firestore (Admin SDK) ────────────────────────────────────────────────────

function getDb() {
  if (admin.apps.length) return admin.firestore();
  const REPO_ROOT = path.join(__dirname, '..');
  const credPath = path.join(REPO_ROOT, 'service-account-tasmania.json');
  const serviceAccount = require(credPath);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin.firestore();
}

// ─── CSV parser (RFC-4180 subset — quoted fields, "" escapes, CRLF/LF) ────────

// Returns string[][] — array of rows, each row an array of cell strings.
// Trims surrounding whitespace from unquoted cells but preserves leading /
// trailing whitespace inside quoted cells. Skips a leading BOM if present.
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote ("")? Otherwise end of quoted field.
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      // Opening quote — only valid at the start of an empty cell.
      // If we're mid-cell, treat the quote as a literal character.
      if (cell.length === 0) {
        inQuotes = true;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    if (ch === ',') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }

    if (ch === '\r') {
      // Swallow lone \r — handle the newline on the next iteration if \n
      // follows, or flush the row here if it doesn't.
      if (text[i + 1] === '\n') { i++; continue; }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }

    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }

    cell += ch;
    i++;
  }

  // Flush trailing cell / row if the file didn't end with a newline.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function s(value) {
  if (value === null || value === undefined) return '';
  const out = String(value).trim();
  return out.length === 0 ? '' : out;
}

// Strip a trailing % so abv stores as "13.5" not "13.5%"; downstream
// renderer re-adds the % sign. Same idea for the $ on price.
function stripPrefixSuffix(value, chars) {
  let v = s(value);
  for (const c of chars) {
    if (v.startsWith(c)) v = v.slice(1).trim();
    if (v.endsWith(c)) v = v.slice(0, -1).trim();
  }
  return v;
}

// Expose pure helpers for unit tests / re-use without triggering the
// main script behaviour. Anything that requires this file should still
// be ready to use these without Firestore credentials.
module.exports = { parseCsv, slugify, stripPrefixSuffix };

// ─── Main ─────────────────────────────────────────────────────────────────────

if (isMain) (async function main() {
  console.log('🍷 SipLocal wines CSV seeder');
  console.log(`   file:    ${CSV_PATH}`);
  console.log(`   region:  ${REGION_ID}`);
  console.log(`   dry-run: ${DRY_RUN}`);

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`\nCSV not found at ${CSV_PATH}`);
    console.error('Either drop your export at scripts/rag/wines.csv or pass --file.');
    process.exit(1);
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(raw);

  if (rows.length === 0) {
    console.error('CSV is empty.');
    process.exit(1);
  }

  // Header lookup is case-insensitive — the source sheet uses
  // `wineryID` (capital D), our schema uses `wineryId`, and either
  // is fine. Normalising at the index keeps every downstream `get`
  // call written in the canonical lowerCamelCase form.
  const header = rows[0].map((h) => s(h));
  const colIndex = {};
  header.forEach((name, i) => {
    if (name) colIndex[name.toLowerCase()] = i;
  });
  const get = (row, key) => {
    const ix = colIndex[key.toLowerCase()];
    return ix === undefined ? '' : s(row[ix]);
  };
  const hasCol = (key) => colIndex[key.toLowerCase()] !== undefined;

  if (!hasCol('wineryId') || !hasCol('wineName')) {
    console.error('CSV header is missing required columns. Need at least: wineryId, wineName.');
    console.error(`Found columns: ${header.join(', ')}`);
    process.exit(1);
  }

  // Pre-load all winery IDs for validation. The wineries collection
  // is small (~131 docs) and getting them once is cheaper than one
  // get() per row.
  const db = getDb();
  console.log('\nLoading wineries for slug validation...');
  const winerySnap = await db.collection('wineries').get();
  const knownWineryIds = new Set(winerySnap.docs.map((d) => d.id));
  console.log(`  ${knownWineryIds.size} winery doc(s) loaded.`);

  // Build the docs.
  const dataRows = rows.slice(1);
  const planned = [];
  const stats = {
    rowsRead: dataRows.length,
    skippedBlank: 0,
    skippedMissingWinery: 0,
    invalidWinery: 0,
    queued: 0,
  };
  const seenDocIds = new Set();

  for (let r = 0; r < dataRows.length && planned.length < LIMIT; r++) {
    const row = dataRows[r];
    if (!row || row.every((c) => s(c).length === 0)) {
      stats.skippedBlank++;
      continue;
    }

    const wineryId = get(row, 'wineryId');
    const wineryName = get(row, 'wineryName');
    const wineName = get(row, 'wineName');

    // Template-only rows that haven't been filled in yet (wineryId
    // and wineryName present but no wineName) are silently skipped —
    // the xlsx ships with 262 of these.
    if (!wineName) {
      stats.skippedBlank++;
      continue;
    }

    if (!wineryId) {
      console.warn(`  row ${r + 2}: missing wineryId for "${wineName}" — skipped`);
      stats.skippedMissingWinery++;
      continue;
    }

    if (!knownWineryIds.has(wineryId) && !ALLOW_MISSING_WINERY) {
      console.warn(`  row ${r + 2}: wineryId "${wineryId}" not found in Firestore — skipped (pass --allow-missing-winery to override)`);
      stats.invalidWinery++;
      continue;
    }

    const vintage = get(row, 'vintage');
    const baseSlug = slugify(wineName);
    if (!baseSlug) {
      console.warn(`  row ${r + 2}: wineName "${wineName}" slugifies to empty — skipped`);
      stats.skippedBlank++;
      continue;
    }
    const docId = vintage
      ? `${wineryId}__${baseSlug}-${slugify(vintage)}`
      : `${wineryId}__${baseSlug}`;

    if (seenDocIds.has(docId)) {
      console.warn(`  row ${r + 2}: duplicate doc id "${docId}" within this CSV — earlier row will be overwritten`);
    }
    seenDocIds.add(docId);

    const doc = { wineryId };
    const setIf = (key, raw) => {
      const val = s(raw);
      if (val) doc[key] = val;
    };
    setIf('name', wineName);
    setIf('vintage', vintage);
    setIf('region', get(row, 'region'));
    setIf('variety', get(row, 'variety'));
    setIf('style', get(row, 'style'));
    setIf('color', get(row, 'color'));
    setIf('body', get(row, 'body'));
    setIf('sweetness', get(row, 'sweetness'));
    setIf('oak', get(row, 'oak'));
    // Normalise abv / price by stripping a stray % or $ — the embed-text
    // builder in scripts/rag/ingest-tasting-notes.js re-adds them.
    setIf('abv', stripPrefixSuffix(get(row, 'abv'), ['%']));
    setIf('price', stripPrefixSuffix(get(row, 'price'), ['$']));
    setIf('tastingNotes', get(row, 'tastingNotes'));
    setIf('pairings', get(row, 'pairings'));
    setIf('awards', get(row, 'awards'));
    setIf('authorNotes', get(row, 'authorNotes'));
    // regionId scoping for the retrieval filter — stored on the
    // Firestore doc so it round-trips through `ingest-tasting-notes.js`
    // even though the ingest script also defaults it. Keeps multi-region
    // datasets cleanly partitioned.
    doc.regionId = REGION_ID;

    planned.push({ docId, doc, wineryName });
    stats.queued++;
  }

  console.log(`\nParsed ${stats.rowsRead} data row(s) → ${stats.queued} wine(s) to write`);
  console.log(`  skipped (blank / template):     ${stats.skippedBlank}`);
  console.log(`  skipped (missing wineryId):     ${stats.skippedMissingWinery}`);
  console.log(`  skipped (unknown wineryId):     ${stats.invalidWinery}`);

  if (planned.length === 0) {
    console.log('\nNothing to write. Did you populate the wineName column?');
    return;
  }

  if (DRY_RUN) {
    console.log('\n--dry-run — first 3 planned writes:');
    planned.slice(0, 3).forEach(({ docId, doc, wineryName }) => {
      console.log('─'.repeat(60));
      console.log(`docId: wines/${docId}  (${wineryName || doc.wineryId})`);
      console.log(JSON.stringify(doc, null, 2));
    });
    console.log(`\n... ${planned.length} doc(s) would be written. Re-run without --dry-run to commit.`);
    return;
  }

  // Batch the writes — Firestore caps batches at 500 ops; 30-300 wines
  // fits in one batch comfortably but the loop keeps us safe.
  const BATCH_SIZE = 400;
  let written = 0;
  for (let i = 0; i < planned.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = planned.slice(i, i + BATCH_SIZE);
    for (const { docId, doc } of slice) {
      batch.set(db.collection('wines').doc(docId), doc, { merge: false });
    }
    await batch.commit();
    written += slice.length;
    console.log(`  committed ${written}/${planned.length}`);
  }

  console.log(`\nDone — wrote ${written} wine doc(s) to the \`wines\` collection.`);
  console.log('\nNext step: re-embed into Upstash so the concierge can see them.');
  console.log('  node --env-file=.env scripts/rag/ingest-tasting-notes.js');
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
