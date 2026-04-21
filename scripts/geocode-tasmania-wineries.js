#!/usr/bin/env node
/**
 * Geocode Tasmania Wineries
 *
 * Fetches latitude and longitude for all Tasmania wineries using the
 * Google Places API and their Place IDs, then updates Firestore.
 *
 * Usage:
 *   GOOGLE_MAPS_API_KEY=your-key node scripts/geocode-tasmania-wineries.js
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
const DELAY_MS = 150;

// ============================================================================
// Validation
// ============================================================================

if (!GOOGLE_MAPS_API_KEY) {
  console.error('\n❌ Error: GOOGLE_MAPS_API_KEY environment variable not set');
  console.error('Usage: GOOGLE_MAPS_API_KEY=your-key node scripts/geocode-tasmania-wineries.js\n');
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
 * Fetch coordinates from Google Places API using Place ID
 */
async function getCoordinatesFromPlaceId(placeId, name) {
  const trimmedId = placeId.trim();
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${trimmedId}&fields=geometry&key=${GOOGLE_MAPS_API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (
      data.status === 'OK' &&
      data.result &&
      data.result.geometry &&
      data.result.geometry.location
    ) {
      const { lat, lng } = data.result.geometry.location;
      return { latitude: lat, longitude: lng };
    }

    console.warn(`⚠️  Failed to geocode "${name}": ${data.status}`);
    if (data.error_message) {
      console.warn(`    Error: ${data.error_message}`);
    }
    return null;
  } catch (error) {
    console.error(`❌ Network error for "${name}": ${error.message}`);
    return null;
  }
}

// ============================================================================
// Main Function
// ============================================================================

async function geocodeWineries() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🗺️  Tasmania Winery Geocoding');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  try {
    // Fetch all wineries from Tasmania Firestore
    console.log('📋 Fetching wineries from Tasmania Firestore...');
    const snapshot = await db.collection('wineries').get();
    const wineries = snapshot.docs;

    if (wineries.length === 0) {
      console.error('❌ No wineries found in Tasmania Firestore');
      process.exit(1);
    }

    console.log(`✓ Found ${wineries.length} wineries\n`);

    // Stats
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Process each winery
    console.log('🔍 Geocoding...\n');

    for (let i = 0; i < wineries.length; i++) {
      const docSnap = wineries[i];
      const data = docSnap.data();
      const name = data.name || docSnap.id;
      const placeId = data.placeId;

      // Progress indicator
      const progress = `[${i + 1}/${wineries.length}]`;

      // Skip if already has coordinates
      if (data.latitude && data.longitude) {
        console.log(`${progress} ✓ ${name}`);
        console.log(`          (already geocoded: ${data.latitude}, ${data.longitude})`);
        skippedCount++;
        continue;
      }

      // Check if we have a Place ID
      if (!placeId) {
        console.warn(`${progress} ⚠️  ${name}`);
        console.warn(`          (no placeId found)`);
        failedCount++;
        continue;
      }

      // Fetch coordinates
      const coords = await getCoordinatesFromPlaceId(placeId, name);

      if (coords) {
        // Update Firestore
        await db.collection('wineries').doc(docSnap.id).update({
          latitude: coords.latitude,
          longitude: coords.longitude,
        });

        console.log(`${progress} ✅ ${name}`);
        console.log(`          → Lat: ${coords.latitude.toFixed(4)}, Lng: ${coords.longitude.toFixed(4)}`);
        successCount++;
      } else {
        console.warn(`${progress} ❌ ${name}`);
        console.warn(`          (failed to fetch coordinates)`);
        failedCount++;
      }

      // Rate limiting
      await sleep(DELAY_MS);
    }

    // Summary
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 Summary');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`✅ Updated:   ${successCount}`);
    console.log(`✓ Skipped:    ${skippedCount}`);
    console.log(`❌ Failed:    ${failedCount}`);
    console.log(`📈 Total:     ${wineries.length}`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    // Success/warning message
    if (failedCount === 0) {
      console.log('🎉 All wineries geocoded successfully!\n');
    } else if (successCount > 0) {
      console.log(`⚠️  ${failedCount} winery/wineries failed. You may need to retry or check Place IDs.\n`);
    } else {
      console.log('⚠️  No wineries were geocoded. Check your Google API key and Place IDs.\n');
    }

    // Next steps
    console.log('📝 Next steps:');
    console.log('   1. Fetch additional details (phone, website, hours):');
    console.log('      GOOGLE_MAPS_API_KEY=your-key node scripts/fetch-place-details-tasmania.js');
    console.log('   2. Switch app to Tasmania environment:');
    console.log('      node scripts/setup-region-env.js tasmania');
    console.log('   3. Test the app with Tasmania data');
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

geocodeWineries();
