#!/usr/bin/env node
/**
 * Upload Tasmania Wineries to Firestore
 *
 * This script takes the scraped winery data (Place ID + name) and uploads
 * them to the Tasmania Firestore database.
 *
 * Usage:
 *   node scripts/upload-tasmania-wineries.js <path-to-json-file> [--use-slug]
 *
 * Examples:
 *   node scripts/upload-tasmania-wineries.js ./tasmania_wineries.json
 *   node scripts/upload-tasmania-wineries.js ./tasmania_wineries.json --use-slug
 *
 * Options:
 *   --use-slug  : Use slug as document ID (for app routing)
 *                 Default: uses placeId as document ID
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin with Tasmania credentials
const serviceAccountPath = path.join(__dirname, '../service-account-tasmania.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Error: service-account-tasmania.json not found in project root');
  console.error(`   Expected at: ${serviceAccountPath}`);
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore(app);

/**
 * Upload wineries to Firestore
 */
async function uploadWineries() {
  // Get filepath from command line or use default
  const arg = process.argv[2];
  const useSlug = process.argv.includes('--use-slug');

  if (!arg) {
    console.log('Usage: node scripts/upload-tasmania-wineries.js <path-to-json-file> [--use-slug]');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/upload-tasmania-wineries.js ./tasmania_wineries.json');
    console.log('  node scripts/upload-tasmania-wineries.js ./tasmania_wineries.json --use-slug');
    process.exit(1);
  }

  const filePath = path.resolve(arg);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: File not found: ${filePath}`);
    process.exit(1);
  }

  // Read the JSON file
  let wineryData;
  try {
    const rawData = fs.readFileSync(filePath, 'utf8');
    wineryData = JSON.parse(rawData);
    console.log(`✓ Loaded ${filePath}`);
  } catch (error) {
    console.error(`❌ Error reading/parsing JSON: ${error.message}`);
    process.exit(1);
  }

  // Extract wineries array
  const wineries = wineryData.wineries || wineryData;

  if (!Array.isArray(wineries)) {
    console.error('❌ Error: JSON must contain a "wineries" array or be an array itself');
    process.exit(1);
  }

  if (wineries.length === 0) {
    console.error('❌ Error: No wineries found in JSON');
    process.exit(1);
  }

  console.log(`\n📋 Found ${wineries.length} wineries to upload`);
  console.log(`📝 Document ID: ${useSlug ? 'slug' : 'placeId'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Validate data
  let validCount = 0;
  const invalid = [];

  for (let i = 0; i < wineries.length; i++) {
    const winery = wineries[i];

    if (!winery.placeId || !winery.name) {
      invalid.push(`${i + 1}: Missing placeId or name`);
      continue;
    }
    validCount++;
  }

  if (invalid.length > 0) {
    console.warn(`⚠️  Warning: ${invalid.length} invalid entries:`);
    invalid.slice(0, 5).forEach(msg => console.warn(`   ${msg}`));
    if (invalid.length > 5) {
      console.warn(`   ... and ${invalid.length - 5} more`);
    }
  }

  console.log(`✓ ${validCount}/${wineries.length} entries valid`);
  console.log('');

  // Ask for confirmation
  if (process.argv[3] !== '--skip-confirm') {
    console.log('⚠️  This will upload wineries to Firebase Firestore.');
    console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...');

    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Upload to Firestore
  console.log('\n🚀 Starting upload...');

  let successCount = 0;
  let errorCount = 0;
  const batch = db.batch();
  let batchSize = 0;
  const BATCH_LIMIT = 500; // Firestore batch write limit

  for (let i = 0; i < wineries.length; i++) {
    const winery = wineries[i];

    // Skip invalid entries
    if (!winery.placeId || !winery.name) {
      errorCount++;
      continue;
    }

    // Generate slug from name
    const slug = winery.name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');

    // Create document reference using slug or placeId based on --use-slug flag
    const docId = useSlug ? slug : winery.placeId;
    const docRef = db.collection('wineries').doc(docId);

    // Prepare document data
    const docData = {
      placeId: winery.placeId,
      name: winery.name,
      slug: slug,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      // Placeholder values for schema compatibility
      description: [],
      images: [],
      phone: '',
      website: '',
      hours: '',
      latitude: 0,
      longitude: 0,
      rating: 0,
      userRatingsTotal: 0,
      dogFriendly: false,
      hasRestaurant: false,
      isOrganic: false,
      isBiodynamic: false,
      walkinWelcome: false,
      featured: false,
      featuredTier: null,
      featuredLabel: null,
    };

    batch.set(docRef, docData, { merge: true });
    batchSize++;
    successCount++;

    // Commit batch when it reaches the limit
    if (batchSize >= BATCH_LIMIT) {
      try {
        await batch.commit();
        console.log(`  ✓ Uploaded batch ${Math.ceil(successCount / BATCH_LIMIT)} (${successCount} documents)`);
        batchSize = 0;
      } catch (error) {
        console.error(`  ❌ Batch commit failed: ${error.message}`);
        errorCount += BATCH_LIMIT;
        batchSize = 0;
      }
    }
  }

  // Commit remaining batch
  if (batchSize > 0) {
    try {
      await batch.commit();
      console.log(`  ✓ Uploaded final batch (total: ${successCount} documents)`);
    } catch (error) {
      console.error(`  ❌ Final batch commit failed: ${error.message}`);
      errorCount += batchSize;
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Upload complete!`);
  console.log(`   Successful: ${successCount}`);
  console.log(`   Errors: ${errorCount}`);
  console.log('');
  console.log('📝 Next steps:');
  console.log('   1. Verify data in Firebase Console');
  console.log('   2. Run geocoding script to add lat/lng');
  console.log('   3. Add additional winery data (hours, website, etc.)');
  console.log('   4. Switch app to Tasmania environment');
  console.log('');

  // Cleanup
  await app.delete();
  process.exit(0);
}

// Run the upload
uploadWineries().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
