#!/usr/bin/env node
/**
 * Import Tasmania Wineries ← Google Sheet
 *
 * Reads the Google Sheet created by export-to-sheets-tasmania.js,
 * parses every row, and updates the corresponding Firestore winery
 * document with any changes — without overwriting fields that were
 * left blank in the sheet.
 *
 * Usage:
 *   node scripts/import-from-sheets-tasmania.js
 *   node scripts/import-from-sheets-tasmania.js --dry-run
 *   node scripts/import-from-sheets-tasmania.js --skip-confirm
 *
 * Options:
 *   --dry-run       : Show what would change without writing to Firestore
 *   --skip-confirm  : Skip the 3-second confirmation prompt
 *
 * Requirements:
 *   - service-account-tasmania.json in project root
 *   - sheets-config-tasmania.json created by export-to-sheets-tasmania.js
 *   - Google Sheets API enabled in your Google Cloud project
 *   - Run: npm install googleapis
 */

const admin      = require('firebase-admin');
const { google } = require('googleapis');
const fs         = require('fs');
const path       = require('path');

// ============================================================================
// Configuration
// ============================================================================

const serviceAccountPath = path.join(__dirname, '../service-account-tasmania.json');
const configPath         = path.join(__dirname, '../sheets-config-tasmania.json');
const TAB_NAME           = 'Wineries';

const DRY_RUN     = process.argv.includes('--dry-run');
const SKIP_CONFIRM = process.argv.includes('--skip-confirm');

// ============================================================================
// Validation
// ============================================================================

if (!fs.existsSync(serviceAccountPath)) {
  console.error('\n❌ Error: service-account-tasmania.json not found');
  console.error(`Expected at: ${serviceAccountPath}\n`);
  process.exit(1);
}

if (!fs.existsSync(configPath)) {
  console.error('\n❌ Error: sheets-config-tasmania.json not found.');
  console.error('   Run the export script first to create the Google Sheet:');
  console.error('   node scripts/export-to-sheets-tasmania.js\n');
  process.exit(1);
}

const { spreadsheetId, spreadsheetUrl } = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (!spreadsheetId) {
  console.error('\n❌ Error: No spreadsheetId found in sheets-config-tasmania.json.');
  console.error('   Run export-to-sheets-tasmania.js first.\n');
  process.exit(1);
}

// ============================================================================
// Initialize Firebase
// ============================================================================

const serviceAccount = require(serviceAccountPath);

const firebaseApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore(firebaseApp);

// ============================================================================
// Initialize Google Sheets
// ============================================================================

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

// ============================================================================
// Value Parsers
// ============================================================================

/**
 * Parse a string cell value back into the correct JS type for Firestore
 */
function parseBoolean(val) {
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  if (s === 'true' || s === 'yes') return true;
  if (s === 'false' || s === 'no') return false;
  return false;
}

function parseNumber(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function parseString(val) {
  return (val === null || val === undefined) ? '' : String(val).trim();
}

// ============================================================================
// Row → Firestore update mapper
//
// Special rules:
//   - Classification = "delete"  → flags row for deletion, not update
//   - By Appointment Only = "yes" → walkinWelcome = FALSE
//   - By Appointment Only = ""    → walkinWelcome = TRUE
//   - Organic / Biodynamic = "yes"/"TRUE" → mapped to isOrganic / isBiodynamic
//   - Tours = "yes"/"TRUE"        → mapped to hasTours boolean
//
// Returns { update, shouldDelete }
// ============================================================================

function rowToUpdate(headers, row) {
  const update = {};
  const desc   = ['', '', ''];

  // Pull raw values into a lookup map for special cross-column logic
  const cells = {};
  headers.forEach((header, i) => {
    cells[header] = (row[i] !== undefined && row[i] !== null) ? String(row[i]).trim() : '';
  });

  // ── Special: Classification = "delete" → mark for deletion ───────────────
  const classification = cells['Classification'] || '';
  if (classification.toLowerCase() === 'delete') {
    return { update: null, shouldDelete: true };
  }

  // ── Special: By Appointment Only → controls walkinWelcome + byAppointmentOnly
  // "yes" (any case) → byAppointmentOnly = TRUE,  walkinWelcome = FALSE
  // empty            → byAppointmentOnly = FALSE, walkinWelcome = TRUE
  const byAppt = cells['By Appointment Only'] || '';
  if (byAppt.toLowerCase() === 'yes') {
    update.byAppointmentOnly = true;
    update.walkinWelcome = false;
  } else if (byAppt === '') {
    update.byAppointmentOnly = false;
    update.walkinWelcome = true;
  }

  // ── Map all columns ────────────────────────────────────────────────────────
  headers.forEach((header, i) => {
    const raw = cells[header];

    switch (header) {
      // Read-only identifiers — never written back
      case 'Document ID':
      case 'Place ID':
      case 'Slug':
      // Handled above via special logic — skip in normal loop
      case 'By Appointment Only':
      case 'Classification':
        break;

      // Skip empty cells for normal fields — don't overwrite with blanks
      default:
        if (raw === '') return;
    }

    switch (header) {
      // Strings
      case 'Name':           update.name           = parseString(raw); break;
      case 'Region':         update.region         = parseString(raw); break;
      case 'Website':        update.website        = parseString(raw); break;
      case 'Phone':          update.phone          = parseString(raw); break;
      case 'Hours':          update.hours          = parseString(raw); break;
      case 'Featured Tier':  update.featuredTier   = parseString(raw); break;
      case 'Featured Label': update.featuredLabel  = parseString(raw); break;
      case 'Pull Quote':     update.pullQuote      = parseString(raw); break;

      // Store classification as a string (anything other than "delete")
      case 'Classification':
        if (raw !== '' && raw.toLowerCase() !== 'delete') {
          update.classification = parseString(raw);
        }
        break;

      // Numbers
      case 'Rating':        update.rating           = parseNumber(raw); break;
      case 'Total Ratings': update.userRatingsTotal = parseNumber(raw); break;
      case 'Latitude':      update.latitude         = parseNumber(raw); break;
      case 'Longitude':     update.longitude        = parseNumber(raw); break;

      // Booleans
      case 'Dog Friendly':     update.dogFriendly   = parseBoolean(raw); break;
      case 'Restaurant':       update.hasRestaurant = parseBoolean(raw); break;
      case 'Organic':          update.isOrganic     = parseBoolean(raw); break;
      case 'Biodynamic':       update.isBiodynamic  = parseBoolean(raw); break;
      case 'Tours':            update.hasTours      = parseBoolean(raw); break;
      // walkinWelcome is derived from "By Appointment Only" column above — never overridden here
      case 'Walk-ins Welcome': break;
      case 'Featured':         update.featured      = parseBoolean(raw); break;

      // Description paragraphs — assembled into an array at the end
      case 'Description Para 1': desc[0] = raw; break;
      case 'Description Para 2': desc[1] = raw; break;
      case 'Description Para 3': desc[2] = raw; break;
    }
  });

  // Only include description if at least one paragraph has content
  if (desc.some(p => p.trim() !== '')) {
    update.description = desc;
  }

  return { update, shouldDelete: false };
}

// ============================================================================
// Main
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function importFromSheets() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📥 Import Tasmania Wineries ← Google Sheet');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (DRY_RUN) console.log('🔍 DRY RUN MODE — no Firestore writes will be made\n');

  console.log(`📋 Sheet: ${spreadsheetUrl || spreadsheetId}`);
  console.log('');

  // ── Read sheet ─────────────────────────────────────────────────────────────
  console.log('📡 Reading data from Google Sheet...');
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB_NAME}!A:Z`,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) {
    console.error('❌ Sheet appears empty or only has a header row. Nothing to import.');
    await firebaseApp.delete();
    process.exit(1);
  }

  const headers  = rows[0];
  const dataRows = rows.slice(1);

  // Find the Document ID column index
  const docIdColIndex = headers.indexOf('Document ID');
  if (docIdColIndex === -1) {
    console.error('❌ Could not find "Document ID" column in the sheet.');
    console.error('   Make sure the sheet was created by export-to-sheets-tasmania.js.');
    await firebaseApp.delete();
    process.exit(1);
  }

  console.log(`✓ Found ${dataRows.length} rows (${headers.length} columns)\n`);

  // ── Parse rows ─────────────────────────────────────────────────────────────
  const updates = [];
  const deletes = [];
  const skipped = [];

  for (const row of dataRows) {
    const docId = (row[docIdColIndex] || '').toString().trim();
    if (!docId) {
      skipped.push('(empty Document ID — row skipped)');
      continue;
    }

    const { update, shouldDelete } = rowToUpdate(headers, row);

    if (shouldDelete) {
      deletes.push(docId);
      continue;
    }

    if (Object.keys(update).length === 0) {
      skipped.push(`${docId} — no changes detected`);
      continue;
    }

    updates.push({ docId, update });
  }

  console.log(`📊 ${updates.length} row(s) to update, ${deletes.length} to delete`);
  if (skipped.length > 0) {
    console.log(`⏭️  ${skipped.length} row(s) skipped (no changes or missing ID)\n`);
  }

  if (updates.length === 0 && deletes.length === 0) {
    console.log('\n✅ Nothing to change — Firestore is already in sync with the sheet.');
    await firebaseApp.delete();
    process.exit(0);
  }

  // ── Preview changes ────────────────────────────────────────────────────────
  if (updates.length > 0) {
    console.log('\n📋 Updates to be written:\n');
    updates.forEach(({ docId, update }) => {
      console.log(`  • ${docId}`);
      Object.entries(update).forEach(([field, value]) => {
        const display = Array.isArray(value)
          ? `[${value.length} paragraphs]`
          : String(value).substring(0, 60);
        console.log(`      ${field}: ${display}`);
      });
    });
  }

  if (deletes.length > 0) {
    console.log('\n🗑️  Wineries to be DELETED from Firestore:\n');
    deletes.forEach(docId => console.log(`  • ${docId}`));
  }

  // ── Confirmation ───────────────────────────────────────────────────────────
  if (!DRY_RUN && !SKIP_CONFIRM) {
    console.log(`\n⚠️  About to update ${updates.length} and permanently delete ${deletes.length} document(s).`);
    console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');
    await sleep(3000);
  }

  if (DRY_RUN) {
    console.log('\n📝 DRY RUN — no changes written. Run without --dry-run to apply.\n');
    await firebaseApp.delete();
    process.exit(0);
  }

  // ── Write updates to Firestore ─────────────────────────────────────────────
  let successCount = 0;
  let errorCount   = 0;

  if (updates.length > 0) {
    console.log('\n🚀 Writing updates to Firestore...\n');
    for (const { docId, update } of updates) {
      try {
        await db.collection('wineries').doc(docId).update({
          ...update,
          updatedAt: admin.firestore.Timestamp.now(),
        });
        console.log(`  ✅ ${docId}`);
        successCount++;
      } catch (error) {
        console.error(`  ❌ ${docId} — ${error.message}`);
        errorCount++;
      }
    }
  }

  // ── Delete flagged wineries ────────────────────────────────────────────────
  let deleteCount = 0;
  let deleteErrorCount = 0;

  if (deletes.length > 0) {
    console.log('\n🗑️  Deleting wineries from Firestore...\n');
    for (const docId of deletes) {
      try {
        await db.collection('wineries').doc(docId).delete();
        console.log(`  🗑️  Deleted: ${docId}`);
        deleteCount++;
      } catch (error) {
        console.error(`  ❌ Failed to delete ${docId} — ${error.message}`);
        deleteErrorCount++;
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  if (updates.length > 0) {
    console.log(`✅ Updated:  ${successCount}`);
    if (errorCount > 0) console.log(`❌ Update errors:  ${errorCount}`);
  }
  if (deletes.length > 0) {
    console.log(`🗑️  Deleted:  ${deleteCount}`);
    if (deleteErrorCount > 0) console.log(`❌ Delete errors: ${deleteErrorCount}`);
  }
  if (skipped.length > 0) console.log(`⏭️  Skipped:  ${skipped.length}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const totalErrors = errorCount + deleteErrorCount;
  if (totalErrors === 0) {
    console.log('🎉 Firestore is now up to date!\n');
  } else {
    console.log(`⚠️  ${totalErrors} operation(s) failed. Check document IDs exist in Firestore.\n`);
  }

  await firebaseApp.delete();
  process.exit(0);
}

// ============================================================================
// Run
// ============================================================================

importFromSheets().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  if (error.message.includes('googleapis')) {
    console.error('   Run: npm install googleapis');
  }
  process.exit(1);
});
