#!/usr/bin/env node
/**
 * Cleanup Wrongly-Uploaded Place ID Documents
 *
 * The add-missing-wineries-tasmania.js script was initially run with placeId
 * as the Firestore document ID. This script deletes those documents so they
 * can be re-uploaded with slug as the document ID.
 *
 * Targets documents where:
 *   - doc.id === doc.data().placeId  (document ID is a Google Place ID)
 *   - doc.data().region exists       (only the newly-added docs have this field)
 *
 * Usage:
 *   node scripts/cleanup-placeid-docs-tasmania.js
 *   node scripts/cleanup-placeid-docs-tasmania.js --dry-run
 *   node scripts/cleanup-placeid-docs-tasmania.js --skip-confirm
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ============================================================================
// Configuration
// ============================================================================

const serviceAccountPath = path.join(__dirname, '../service-account-tasmania.json');
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_CONFIRM = process.argv.includes('--skip-confirm');

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
// Helper
// ============================================================================

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// Main
// ============================================================================

async function cleanupPlaceIdDocs() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧹 Cleanup Place ID Documents — Tasmania Wineries');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE — no documents will be deleted\n');
  }

  // Fetch all wineries
  console.log('📋 Fetching wineries from Tasmania Firestore...');
  const snapshot = await db.collection('wineries').get();
  console.log(`✓ Found ${snapshot.docs.length} total documents\n`);

  // Identify targets: doc ID equals placeId field AND has a region field
  // (region was only added by the add-missing script, not the original upload)
  const targets = snapshot.docs.filter((doc) => {
    const data = doc.data();
    return doc.id === data.placeId && data.region !== undefined;
  });

  if (targets.length === 0) {
    console.log('✅ No wrongly-uploaded Place ID documents found. Nothing to clean up.');
    await app.delete();
    process.exit(0);
  }

  console.log(`🎯 Found ${targets.length} document(s) to delete:\n`);
  targets.forEach((doc) => {
    const data = doc.data();
    console.log(`   • ${data.name} (${data.region})`);
    console.log(`     Doc ID: ${doc.id}`);
  });

  // Confirmation
  if (!DRY_RUN && !SKIP_CONFIRM) {
    console.log(`\n⚠️  About to delete ${targets.length} documents from Tasmania Firestore.`);
    console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');
    await sleep(3000);
  }

  if (DRY_RUN) {
    console.log(`\n📝 DRY RUN — would delete ${targets.length} document(s).`);
    console.log('ℹ️  Run without --dry-run to actually delete them.\n');
    await app.delete();
    process.exit(0);
  }

  // Delete in batches
  console.log('\n🗑️  Deleting...\n');
  const batch = db.batch();
  targets.forEach((doc) => batch.delete(doc.ref));

  try {
    await batch.commit();
    console.log(`✅ Deleted ${targets.length} document(s) successfully.`);
  } catch (error) {
    console.error(`❌ Batch delete failed: ${error.message}`);
    await app.delete();
    process.exit(1);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`🎉 Cleanup complete — ${targets.length} stale document(s) removed.`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('📝 Next step — re-upload with slug as document ID:');
  console.log('   GOOGLE_MAPS_API_KEY=your-key node scripts/add-missing-wineries-tasmania.js');
  console.log('');

  await app.delete();
  process.exit(0);
}

// ============================================================================
// Run
// ============================================================================

cleanupPlaceIdDocs().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
