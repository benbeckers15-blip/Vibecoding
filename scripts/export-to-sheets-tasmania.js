#!/usr/bin/env node
/**
 * Export Tasmania Wineries → Google Sheet
 *
 * Reads all winery documents from Tasmania Firestore and writes them into
 * a Google Sheet. On first run you must supply the Sheet ID via --sheet-id.
 * After that the ID is saved to sheets-config-tasmania.json and subsequent
 * runs update the same sheet automatically.
 *
 * Setup (one-time):
 *   1. Go to sheets.google.com and create a blank spreadsheet
 *   2. Share it with this service account email as Editor:
 *        firebase-adminsdk-fbsvc@winery-tourism-tasmania.iam.gserviceaccount.com
 *   3. Copy the Sheet ID from the URL:
 *        https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
 *   4. Run:
 *        node scripts/export-to-sheets-tasmania.js --sheet-id SHEET_ID_HERE
 *
 * Usage after first run:
 *   node scripts/export-to-sheets-tasmania.js
 *
 * Requirements:
 *   - service-account-tasmania.json in project root
 *   - Google Sheets API enabled:
 *     https://console.cloud.google.com/apis/library/sheets.googleapis.com
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

// ============================================================================
// Column definitions
// ============================================================================

const COLUMNS = [
  { header: 'Document ID',        key: 'id' },
  { header: 'Name',               key: 'name' },
  { header: 'Slug',               key: 'slug' },
  { header: 'Region',             key: 'region' },
  { header: 'Website',            key: 'website' },
  { header: 'Phone',              key: 'phone' },
  { header: 'Hours',              key: 'hours' },
  { header: 'Rating',             key: 'rating' },
  { header: 'Total Ratings',      key: 'userRatingsTotal' },
  { header: 'Latitude',           key: 'latitude' },
  { header: 'Longitude',          key: 'longitude' },
  { header: 'Dog Friendly',       key: 'dogFriendly' },
  { header: 'Restaurant',         key: 'hasRestaurant' },
  { header: 'Organic',            key: 'isOrganic' },
  { header: 'Biodynamic',         key: 'isBiodynamic' },
  { header: 'Walk-ins Welcome',   key: 'walkinWelcome' },
  { header: 'Featured',           key: 'featured' },
  { header: 'Featured Tier',      key: 'featuredTier' },
  { header: 'Featured Label',     key: 'featuredLabel' },
  { header: 'Pull Quote',         key: 'pullQuote' },
  { header: 'Description Para 1', key: '_desc0' },
  { header: 'Description Para 2', key: '_desc1' },
  { header: 'Description Para 3', key: '_desc2' },
  { header: 'Place ID',           key: 'placeId' },
];

// ============================================================================
// Validation
// ============================================================================

if (!fs.existsSync(serviceAccountPath)) {
  console.error('\n❌ Error: service-account-tasmania.json not found');
  console.error(`Expected at: ${serviceAccountPath}\n`);
  process.exit(1);
}

// ============================================================================
// Resolve Sheet ID — from --sheet-id flag, or saved config
// ============================================================================

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {}
  return {};
}

function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

const sheetIdArgIdx  = process.argv.indexOf('--sheet-id');
const sheetIdFromArg = sheetIdArgIdx !== -1 ? process.argv[sheetIdArgIdx + 1] : null;
const config         = loadConfig();
const spreadsheetId  = sheetIdFromArg || config.spreadsheetId;

if (!spreadsheetId) {
  console.error('\n❌ No Sheet ID found. On first run you must supply it:\n');
  console.error('   node scripts/export-to-sheets-tasmania.js --sheet-id YOUR_SHEET_ID\n');
  console.error('How to get your Sheet ID:');
  console.error('  1. Create a blank Google Sheet at sheets.google.com');
  console.error('  2. Share it with firebase-adminsdk-fbsvc@winery-tourism-tasmania.iam.gserviceaccount.com (Editor)');
  console.error('  3. Copy the ID from the URL: docs.google.com/spreadsheets/d/SHEET_ID/edit\n');
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
// Initialize Google Sheets (no Drive API needed)
// ============================================================================

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// ============================================================================
// Helpers
// ============================================================================

function resolveValue(winery, key) {
  if (key === '_desc0') return Array.isArray(winery.description) ? (winery.description[0] || '') : '';
  if (key === '_desc1') return Array.isArray(winery.description) ? (winery.description[1] || '') : '';
  if (key === '_desc2') return Array.isArray(winery.description) ? (winery.description[2] || '') : '';
  const val = winery[key];
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  return val;
}

// ============================================================================
// Main
// ============================================================================

async function exportToSheets() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 Export Tasmania Wineries → Google Sheet');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`📋 Sheet ID: ${spreadsheetId}`);
  console.log('');

  // ── Fetch Firestore wineries ───────────────────────────────────────────────
  console.log('📡 Fetching wineries from Tasmania Firestore...');
  const snapshot = await db.collection('wineries').get();

  if (snapshot.empty) {
    console.error('❌ No wineries found in Tasmania Firestore.');
    await firebaseApp.delete();
    process.exit(1);
  }

  const wineries = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  console.log(`✓ Found ${wineries.length} wineries\n`);

  // ── Ensure the Wineries tab exists ────────────────────────────────────────
  console.log('📋 Checking sheet tab...');
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTab = sheetMeta.data.sheets.find(s => s.properties.title === TAB_NAME);
  const sheetId = existingTab?.properties?.sheetId ?? 0;

  if (!existingTab) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: TAB_NAME } } }],
      },
    });
    console.log(`  ✓ Created "${TAB_NAME}" tab`);
  } else {
    console.log(`  ✓ Using existing "${TAB_NAME}" tab`);
  }

  // ── Build and write data ───────────────────────────────────────────────────
  console.log('\n📝 Writing data...');

  const headerRow = COLUMNS.map(c => c.header);
  const dataRows  = wineries.map(w => COLUMNS.map(c => resolveValue(w, c.key)));
  const allRows   = [headerRow, ...dataRows];

  // Clear existing content
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${TAB_NAME}!A:Z`,
  });

  // Write all rows
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TAB_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: allRows },
  });

  console.log(`  ✓ Wrote ${wineries.length} rows`);

  // ── Formatting ─────────────────────────────────────────────────────────────
  console.log('\n🎨 Applying formatting...');

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // Bold + dark background on header row
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                backgroundColor: { red: 0.18, green: 0.18, blue: 0.18 },
              },
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          },
        },
        // Freeze header row
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        // Auto-resize columns
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: COLUMNS.length,
            },
          },
        },
      ],
    },
  });

  console.log('  ✓ Formatting applied');

  // ── Save config ────────────────────────────────────────────────────────────
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  saveConfig({ spreadsheetId, spreadsheetUrl, lastExport: new Date().toISOString() });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`✅ Exported ${wineries.length} wineries`);
  console.log(`🔗 ${spreadsheetUrl}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('📝 Next steps:');
  console.log('   1. Open the link above and edit winery data freely');
  console.log('   2. Do NOT edit the "Document ID" column');
  console.log('   3. When done, push changes back to Firestore:');
  console.log('      node scripts/import-from-sheets-tasmania.js');
  console.log('');

  await firebaseApp.delete();
  process.exit(0);
}

// ============================================================================
// Run
// ============================================================================

exportToSheets().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  if (error.message?.includes('accessNotConfigured') || error.message?.includes('disabled')) {
    console.error('\n   The Google Sheets API is not enabled for your project.');
    console.error('   Enable it at:');
    console.error('   https://console.cloud.google.com/apis/library/sheets.googleapis.com');
  }
  if (error.message?.includes('does not have permission') || error.message?.includes('PERMISSION_DENIED')) {
    console.error('\n   The service account does not have access to this sheet.');
    console.error('   Make sure you shared the sheet with:');
    console.error('   firebase-adminsdk-fbsvc@winery-tourism-tasmania.iam.gserviceaccount.com');
    console.error('   (give it Editor access)');
  }
  process.exit(1);
});
