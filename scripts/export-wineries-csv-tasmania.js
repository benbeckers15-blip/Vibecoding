#!/usr/bin/env node
/**
 * Export Tasmania Wineries to CSV
 *
 * Reads all winery documents from the Tasmania Firestore collection and
 * exports them to a CSV file that can be opened directly in Google Sheets.
 *
 * Usage:
 *   node scripts/export-wineries-csv-tasmania.js
 *   node scripts/export-wineries-csv-tasmania.js --output ./my-export.csv
 *
 * Options:
 *   --output <path>  : Custom output file path (default: ./tasmania-wineries-export.csv)
 *
 * Once exported, open Google Sheets → File → Import → Upload the CSV file.
 *
 * Requirements:
 *   - service-account-tasmania.json in project root
 */

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

// ============================================================================
// Configuration
// ============================================================================

const serviceAccountPath = path.join(__dirname, '../service-account-tasmania.json');

const outputIdx  = process.argv.indexOf('--output');
const outputPath = outputIdx !== -1
  ? path.resolve(process.argv[outputIdx + 1])
  : path.join(__dirname, '../tasmania-wineries-export.csv');

// ============================================================================
// Validation
// ============================================================================

if (!fs.existsSync(serviceAccountPath)) {
  console.error('\n❌ Error: service-account-tasmania.json not found');
  console.error(`Expected at: ${serviceAccountPath}\n`);
  process.exit(1);
}

// ============================================================================
// Initialize Firebase
// ============================================================================

const serviceAccount = require(serviceAccountPath);

const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore(app);

// ============================================================================
// CSV Helpers
// ============================================================================

/**
 * Wrap a value in quotes and escape any internal quotes.
 * Handles arrays, booleans, nulls, and strings safely.
 */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    // Join arrays with a pipe separator so they fit in one cell
    value = value.join(' | ');
  }
  const str = String(value);
  // Wrap in quotes if it contains commas, quotes, or newlines
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(values) {
  return values.map(csvCell).join(',');
}

// ============================================================================
// Main
// ============================================================================

async function exportWineries() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 Export Tasmania Wineries → CSV');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // Fetch all wineries
  console.log('📡 Fetching wineries from Tasmania Firestore...');
  const snapshot = await db.collection('wineries').get();

  if (snapshot.empty) {
    console.error('❌ No wineries found in Tasmania Firestore.');
    await app.delete();
    process.exit(1);
  }

  const wineries = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  console.log(`✓ Found ${wineries.length} wineries\n`);

  // Define columns
  const columns = [
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
    { header: 'Images',             key: 'images' },
    { header: 'Place ID',           key: 'placeId' },
  ];

  // Build CSV rows
  const rows = [
    // Header row
    csvRow(columns.map(c => c.header)),
    // Data rows
    ...wineries.map(w => csvRow(columns.map(c => {
      // Description paragraphs are stored as an array — split into separate columns
      if (c.key === '_desc0') return Array.isArray(w.description) ? (w.description[0] || '') : '';
      if (c.key === '_desc1') return Array.isArray(w.description) ? (w.description[1] || '') : '';
      if (c.key === '_desc2') return Array.isArray(w.description) ? (w.description[2] || '') : '';
      return w[c.key];
    }))),
  ];

  // Write to file
  const csvContent = rows.join('\n');
  fs.writeFileSync(outputPath, csvContent, 'utf8');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`✅ Exported ${wineries.length} wineries`);
  console.log(`📄 File: ${outputPath}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('📝 To open in Google Sheets:');
  console.log('   1. Go to sheets.google.com and open a new sheet');
  console.log('   2. File → Import → Upload → select the CSV file');
  console.log('   3. Choose "Replace spreadsheet" and "Detect automatically"');
  console.log('   4. Click Import data');
  console.log('');

  await app.delete();
  process.exit(0);
}

// ============================================================================
// Run
// ============================================================================

exportWineries().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
