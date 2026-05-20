#!/usr/bin/env node
/**
 * Push winery IDs + names from winery-ids.json into the "wines-template"
 * Google Sheet, on the "template" tab, columns A and B.
 *
 * Setup (one-time):
 *   1. Make sure the wines-template spreadsheet is shared with this service
 *      account as Editor:
 *        firebase-adminsdk-fbsvc@winery-tourism-tasmania.iam.gserviceaccount.com
 *   2. Copy the Sheet ID from the URL:
 *        https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
 *   3. Run:
 *        node scripts/push-winery-ids-to-template.js --sheet-id SHEET_ID_HERE
 *
 * After the first run the Sheet ID is saved to
 * sheets-config-wines-template.json, so subsequent runs are just:
 *        node scripts/push-winery-ids-to-template.js
 *
 * Layout written to the sheet:
 *   A1: wineryID    B1: wineryName
 *   A2..: doc IDs   B2..: names
 *
 * Behavior:
 *   - Only columns A:B in the "template" tab are touched.
 *   - A:B is cleared before writing (other columns untouched).
 *   - Header row is bolded and frozen.
 *
 * Requirements:
 *   - winery-ids.json in project root (run scripts/list-winery-ids.js first)
 *   - service-account-tasmania.json in project root
 *   - Google Sheets API enabled for the Firebase project
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Configuration
// ============================================================================

const serviceAccountPath = path.join(__dirname, '..', 'service-account-tasmania.json');
const configPath = path.join(__dirname, '..', 'sheets-config-wines-template.json');
const wineryIdsPath = path.join(__dirname, '..', 'winery-ids.json');
const TAB_NAME = 'template';
const HEADER = ['wineryID', 'wineryName'];

// ============================================================================
// Sanity checks
// ============================================================================

if (!fs.existsSync(serviceAccountPath)) {
  console.error('\nError: service-account-tasmania.json not found');
  console.error(`Expected at: ${serviceAccountPath}\n`);
  process.exit(1);
}

if (!fs.existsSync(wineryIdsPath)) {
  console.error('\nError: winery-ids.json not found in project root.');
  console.error('Run scripts/list-winery-ids.js first to generate it.\n');
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

const sheetIdArgIdx = process.argv.indexOf('--sheet-id');
const sheetIdFromArg = sheetIdArgIdx !== -1 ? process.argv[sheetIdArgIdx + 1] : null;
const config = loadConfig();
const spreadsheetId = sheetIdFromArg || config.spreadsheetId;

if (!spreadsheetId) {
  console.error('\nNo Sheet ID found. On first run you must supply it:\n');
  console.error('   node scripts/push-winery-ids-to-template.js --sheet-id YOUR_SHEET_ID\n');
  console.error('How to get your Sheet ID:');
  console.error('  1. Open the wines-template spreadsheet in Google Sheets');
  console.error('  2. Make sure it is shared with');
  console.error('     firebase-adminsdk-fbsvc@winery-tourism-tasmania.iam.gserviceaccount.com (Editor)');
  console.error('  3. Copy the ID from the URL:');
  console.error('     docs.google.com/spreadsheets/d/SHEET_ID/edit\n');
  process.exit(1);
}

// ============================================================================
// Auth
// ============================================================================

const serviceAccount = require(serviceAccountPath);

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('Push wineryID + wineryName -> wines-template / template tab');
  console.log('-----------------------------------------------------------');
  console.log(`Sheet ID: ${spreadsheetId}`);

  // Load source data
  const wineries = JSON.parse(fs.readFileSync(wineryIdsPath, 'utf8'));
  if (!Array.isArray(wineries) || wineries.length === 0) {
    console.error('winery-ids.json is empty or not an array');
    process.exit(1);
  }

  // Sort alphabetically by name (fall back to id) for a nicer template view
  wineries.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

  console.log(`Wineries to write: ${wineries.length}`);

  // Make sure the template tab exists, otherwise create it.
  // Sheets treats tab names case-insensitively for duplicates, so match that way
  // and reuse the existing title casing for subsequent range references.
  console.log('Checking template tab...');
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
  let existingTab = sheetMeta.data.sheets.find(
    (s) => (s.properties.title || '').trim().toLowerCase() === TAB_NAME.toLowerCase()
  );

  let resolvedTabName = TAB_NAME;
  if (!existingTab) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB_NAME } } }] },
    });
    existingTab = { properties: created.data.replies[0].addSheet.properties };
    resolvedTabName = existingTab.properties.title;
    console.log(`  Created "${resolvedTabName}" tab`);
  } else {
    resolvedTabName = existingTab.properties.title;
    console.log(`  Using existing "${resolvedTabName}" tab`);
  }
  const sheetId = existingTab.properties.sheetId;

  // Clear only columns A:B
  console.log('Clearing existing A:B...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${resolvedTabName}!A:B`,
  });

  // Build rows: header + data
  const rows = [HEADER, ...wineries.map((w) => [w.id, w.name || ''])];

  // Write
  console.log('Writing rows...');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${resolvedTabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  // Bold + freeze header, and auto-resize A:B
  console.log('Applying formatting...');
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                backgroundColor: { red: 0.18, green: 0.18, blue: 0.18 },
              },
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 2 },
          },
        },
      ],
    },
  });

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`;
  saveConfig({ spreadsheetId, lastPush: new Date().toISOString() });

  console.log('');
  console.log(`Done. Wrote ${wineries.length} rows to "${resolvedTabName}".`);
  console.log(url);
  console.log('');
}

main().catch((err) => {
  console.error('\nFatal:', err.message || err);
  if (err.message?.includes('PERMISSION_DENIED') || err.message?.includes('does not have permission')) {
    console.error('\nMake sure the wines-template spreadsheet is shared with:');
    console.error('  firebase-adminsdk-fbsvc@winery-tourism-tasmania.iam.gserviceaccount.com');
    console.error('  (Editor access)\n');
  }
  if (err.message?.includes('accessNotConfigured') || err.message?.includes('disabled')) {
    console.error('\nEnable the Google Sheets API at:');
    console.error('  https://console.cloud.google.com/apis/library/sheets.googleapis.com\n');
  }
  process.exit(1);
});
