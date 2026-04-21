/**
 * add-hours-structured-tasmania.js
 *
 * Tasmania version of add-hours-structured.js
 *
 * Reads every winery document from Tasmania Firestore, parses the existing `hours`
 * string into a structured array, and writes it back as a NEW field called
 * `hoursStructured`.
 *
 * The original `hours` string is NEVER modified or deleted.
 *
 * ─── HOW TO USE ───────────────────────────────────────────────────────────────
 *
 *  1. DRY RUN first (default). Just prints what would be written — safe to run.
 *       node scripts/add-hours-structured-tasmania.js
 *
 *  2. Review the output. Check every winery's parsed hours look correct.
 *     If any look wrong, add a manual override in the OVERRIDES object below.
 *
 *  3. When happy, flip DRY_RUN to false and run again to write to Firestore.
 *       node scripts/add-hours-structured-tasmania.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const DRY_RUN = false;          // ← flip to false when you're ready to write
const FORCE_OVERWRITE = true;  // ← true = overwrite existing hoursStructured (needed to fix bad data)

/**
 * Manual overrides — use these if the parser gets a winery wrong.
 * Key = the Firestore document ID (slug).
 *
 * Example:
 *   'cape-mentelle': [
 *     { day: 'Mon – Fri', time: '10am – 5pm' },
 *     { day: 'Sat – Sun', time: '11am – 4pm' },
 *   ],
 */
const OVERRIDES = {
  // 'winery-slug': [ { day: '...', time: '...' }, ... ],
};

// ── PARSER ────────────────────────────────────────────────────────────────────

/**
 * Attempts to turn a raw hours string into an array of { day, time } entries.
 *
 * Handles two main formats found in this dataset:
 *
 *   Pipe-separated (Google Places style):
 *     "Monday: 10:00 AM – 5:00 PM | Tuesday: Closed | Wednesday: 10:00 AM – 5:00 PM"
 *
 *   Comma/freeform:
 *     "Mon – Fri 10am – 5pm, Sat 10am – 4pm, Closed Sun"
 *     "Daily 10am – 5pm"
 *     "Open daily 10am – 5pm"
 *
 * Falls back to a single { day: 'Hours', time: <original> } if it can't parse.
 */
function parseHours(raw) {
  if (!raw || typeof raw !== 'string') {
    return [{ day: 'Hours', time: 'N/A' }];
  }

  const str = raw.trim();

  // ── Format 1: pipe-separated "Day: Time | Day: Time" (Google Places) ────────
  if (str.includes('|')) {
    const segments = str.split('|').map(s => s.trim()).filter(Boolean);
    const results = [];
    for (const seg of segments) {
      // Match "Monday: 10:00 AM – 5:00 PM" or "Tuesday: Closed"
      const match = seg.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        results.push({
          day: titleCase(match[1].trim()),
          time: match[2].trim(),
        });
      }
    }
    if (results.length > 0) return results;
  }

  // ── Format 2: comma/semicolon-separated freeform ────────────────────────────
  const normalised = str
    .replace(/\s*-\s*/g, ' – ')
    .replace(/\s*–\s*/g, ' – ')
    .replace(/\s*—\s*/g, ' – ');

  const segments = normalised.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const results = [];

  const dayTimeRe = /^((?:open\s+)?(?:daily|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?:\s+–\s+(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?))?)\s+(.+)$/i;
  const closedRe = /^(closed)\s+(.+)$/i;

  for (const seg of segments) {
    const closedMatch = seg.match(closedRe);
    if (closedMatch) {
      results.push({ day: titleCase(closedMatch[2].trim()), time: 'Closed' });
      continue;
    }
    const match = seg.match(dayTimeRe);
    if (match) {
      results.push({
        day: titleCase(match[1].replace(/^open\s+/i, '').trim()),
        time: match[2].trim(),
      });
      continue;
    }
    // Unrecognised segment — fall back
    return [{ day: 'Hours', time: str }];
  }

  return results.length > 0 ? results : [{ day: 'Hours', time: str }];
}

function titleCase(str) {
  return str.replace(/\w\S*/g, txt =>
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

// Initialize Firebase Admin with Tasmania credentials
const serviceAccountPath = path.join(__dirname, '../service-account-tasmania.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('\n❌ Error: service-account-tasmania.json not found in project root');
  console.error(`   Expected at: ${serviceAccountPath}\n`);
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(DRY_RUN
    ? '🔍  DRY RUN — no changes will be written to Firestore'
    : '✏️   LIVE RUN — writing hoursStructured to Tasmania Firestore');
  console.log(`${'─'.repeat(60)}\n`);

  const snap = await db.collection('wineries').get();
  console.log(`Found ${snap.size} winery documents in Tasmania.\n`);

  let skipped = 0;
  let updated = 0;
  const batch = db.batch();

  snap.forEach(docSnap => {
    const id = docSnap.id;
    const data = docSnap.data();

    // Skip docs that already have hoursStructured — unless FORCE_OVERWRITE is on
    if (!FORCE_OVERWRITE && Array.isArray(data.hoursStructured) && data.hoursStructured.length > 0) {
      console.log(`  ⏭️  ${data.name || id} — already has hoursStructured, skipping`);
      skipped++;
      return;
    }

    // Use manual override if provided, otherwise parse
    const structured = OVERRIDES[id] || parseHours(data.hours);

    console.log(`  ✅  ${data.name || id}`);
    console.log(`       hours (original): "${data.hours.substring(0, 60)}${data.hours.length > 60 ? '...' : ''}"`);
    console.log(`       hoursStructured:  ${JSON.stringify(structured)}`);
    console.log();

    if (!DRY_RUN) {
      batch.update(docSnap.ref, { hoursStructured: structured });
    }
    updated++;
  });

  console.log(`${'─'.repeat(60)}`);
  console.log(`  ${updated} would be updated, ${skipped} already have hoursStructured.`);

  if (!DRY_RUN) {
    await batch.commit();
    console.log('\n  ✅  Batch committed to Tasmania Firestore.');
  } else {
    console.log('\n  Flip DRY_RUN to false and run again to apply changes.');
  }

  console.log(`${'─'.repeat(60)}\n`);
  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
