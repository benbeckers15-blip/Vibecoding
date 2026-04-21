#!/usr/bin/env node
/**
 * Fetch Place Details for Tasmania Wineries
 *
 * For every winery in Tasmania that has a placeId, fetches phone, website,
 * opening hours, and photos from the Google Places API and writes them
 * to Firestore.
 *
 * Usage:
 *   GOOGLE_MAPS_API_KEY=your-key node scripts/fetch-place-details-tasmania.js
 *   GOOGLE_MAPS_API_KEY=your-key node scripts/fetch-place-details-tasmania.js --dry-run
 *   GOOGLE_MAPS_API_KEY=your-key node scripts/fetch-place-details-tasmania.js --overwrite
 *
 * Options:
 *   --dry-run    : Show what would be updated without making changes
 *   --overwrite  : Refresh all data even if already populated
 *
 * Requirements:
 *   - GOOGLE_MAPS_API_KEY environment variable set
 *   - service-account-tasmania.json in project root
 *   - Wineries must have a placeId field
 */

const admin = require('firebase-admin');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

// ============================================================================
// Configuration
// ============================================================================

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const serviceAccountPath = path.join(__dirname, '../service-account-tasmania.json');

// Delay between API requests (Google's recommended rate limit)
const DELAY_MS = 200;

// Maximum number of photo URLs to store per winery
const MAX_PHOTOS = 6;

// ============================================================================
// Command Line Flags
// ============================================================================

const DRY_RUN = process.argv.includes('--dry-run');
const OVERWRITE = process.argv.includes('--overwrite');

// ============================================================================
// Validation
// ============================================================================

if (!GOOGLE_MAPS_API_KEY) {
  console.error('\n❌ Error: GOOGLE_MAPS_API_KEY environment variable not set');
  console.error('Usage: GOOGLE_MAPS_API_KEY=your-key node scripts/fetch-place-details-tasmania.js');
  console.error('');
  process.exit(1);
}

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
// Helper Functions
// ============================================================================

/**
 * Sleep for a specified duration
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch place details from Google Places API
 */
async function fetchPlaceDetails(placeId) {
  const fields = [
    'formatted_phone_number',
    'website',
    'opening_hours',
    'photos',
  ].join(',');

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId.trim()}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK') {
    throw new Error(`Places API error: ${data.status} ${data.error_message ? `- ${data.error_message}` : ''}`);
  }

  return data.result;
}

/**
 * Convert a Places API photo reference into a usable image URL
 */
function photoUrl(photoReference) {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photoreference=${photoReference}&key=${GOOGLE_MAPS_API_KEY}`;
}

/**
 * Format opening hours array into a readable string
 */
function formatHours(openingHours) {
  if (!openingHours?.weekday_text?.length) return null;
  // e.g. "Mon–Fri: 10am–5pm, Sat–Sun: 11am–4pm"
  return openingHours.weekday_text.join('  |  ');
}

/**
 * Check if a winery already has complete data
 */
function hasCompleteData(wineryData) {
  return (
    wineryData.phone &&
    wineryData.website &&
    wineryData.hours &&
    wineryData.images &&
    Array.isArray(wineryData.images) &&
    wineryData.images.length > 0
  );
}

// ============================================================================
// Main Function
// ============================================================================

async function fetchPlaceDetailsForWineries() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🏢 Fetch Place Details for Tasmania Wineries');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE — no Firestore writes will be made\n');
  }
  if (OVERWRITE) {
    console.log('♻️  OVERWRITE MODE — refreshing all fields\n');
  }

  try {
    // Fetch all wineries from Tasmania Firestore
    console.log('📋 Fetching wineries from Tasmania Firestore...');
    const snapshot = await db.collection('wineries').get();
    const wineriesDocs = snapshot.docs;

    const wineries = wineriesDocs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (wineries.length === 0) {
      console.error('❌ No wineries found in Tasmania Firestore');
      process.exit(1);
    }

    console.log(`✓ Found ${wineries.length} wineries\n`);

    // Stats
    let processedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let updatedCount = 0;

    // Process each winery
    console.log('🔄 Processing wineries...\n');

    for (let i = 0; i < wineries.length; i++) {
      const winery = wineries[i];
      const progress = `[${i + 1}/${wineries.length}]`;

      // Check if we have a Place ID
      if (!winery.placeId) {
        console.warn(`${progress} ⚠️  ${winery.name}`);
        console.warn(`          (no placeId found)`);
        failedCount++;
        continue;
      }

      // Skip if already has complete data (unless --overwrite)
      if (!OVERWRITE && hasCompleteData(winery)) {
        console.log(`${progress} ✓ ${winery.name}`);
        console.log(`          (already has complete data)`);
        skippedCount++;
        continue;
      }

      // Fetch details from Google Places API
      let placeDetails;
      try {
        placeDetails = await fetchPlaceDetails(winery.placeId);
      } catch (error) {
        console.error(`${progress} ❌ ${winery.name}`);
        console.error(`          Error: ${error.message}`);
        failedCount++;
        await sleep(DELAY_MS);
        continue;
      }

      // Extract relevant fields
      const phone = placeDetails.formatted_phone_number || '';
      const website = placeDetails.website || '';
      const hours = formatHours(placeDetails.opening_hours) || '';
      const images = (placeDetails.photos || [])
        .slice(0, MAX_PHOTOS)
        .map((photo) => photoUrl(photo.photo_reference));

      // Prepare update data
      const updateData = {};
      if (phone) updateData.phone = phone;
      if (website) updateData.website = website;
      if (hours) updateData.hours = hours;
      if (images.length > 0) updateData.images = images;

      // Show what would be updated
      console.log(`${progress} 📝 ${winery.name}`);
      if (phone) console.log(`          • Phone: ${phone}`);
      if (website) console.log(`          • Website: ${website}`);
      if (hours) console.log(`          • Hours: ${hours.substring(0, 50)}...`);
      if (images.length > 0) console.log(`          • Images: ${images.length} photo(s)`);

      // Update Firestore (unless --dry-run)
      if (!DRY_RUN && Object.keys(updateData).length > 0) {
        try {
          await db.collection('wineries').doc(winery.id).update(updateData);
          updatedCount++;
        } catch (error) {
          console.error(`          ❌ Failed to update Firestore: ${error.message}`);
          failedCount++;
        }
      }

      processedCount++;
      await sleep(DELAY_MS);
    }

    // Summary
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 Summary');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`📝 Processed:  ${processedCount}`);
    if (DRY_RUN) {
      console.log(`💾 Updated:    ${processedCount} (DRY RUN — not actually saved)`);
    } else {
      console.log(`💾 Updated:    ${updatedCount}`);
    }
    console.log(`✓ Skipped:     ${skippedCount}`);
    console.log(`❌ Failed:     ${failedCount}`);
    console.log(`📈 Total:      ${wineries.length}`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    // Success/warning message
    if (DRY_RUN) {
      console.log('ℹ️  DRY RUN completed. Run without --dry-run to save changes.\n');
    } else if (failedCount === 0 && updatedCount > 0) {
      console.log(`🎉 Successfully updated ${updatedCount} winery/wineries!\n`);
    } else if (updatedCount > 0) {
      console.log(`⚠️  Updated ${updatedCount} wineries, but ${failedCount} failed.\n`);
    } else {
      console.log('⚠️  No wineries were updated. Check your Google API key and Place IDs.\n');
    }

    // Next steps
    console.log('📝 Next steps:');
    console.log('   1. Switch app to Tasmania environment:');
    console.log('      node scripts/setup-region-env.js tasmania');
    console.log('   2. Test the app with Tasmania data');
    console.log('   3. Deploy to App Store and Google Play');
    console.log('');

  } catch (error) {
    console.error('\n❌ Fatal error:');
    console.error(error.message);
    console.error('');
    process.exit(1);
  } finally {
    // Cleanup
    await app.delete();
  }
}

// ============================================================================
// Run
// ============================================================================

fetchPlaceDetailsForWineries();
