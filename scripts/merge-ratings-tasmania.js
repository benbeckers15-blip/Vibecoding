#!/usr/bin/env node
/**
 * Merge Google Ratings for Tasmania Wineries
 *
 * For every winery in the Tasmania Firestore that has a placeId, fetches the
 * Google Places rating and user_ratings_total and writes them to the winery
 * document directly.
 *
 * Mirrors the pattern used in fetch-place-details-tasmania.js.
 *
 * Usage:
 *   GOOGLE_MAPS_API_KEY=your-key node scripts/merge-ratings-tasmania.js
 *   GOOGLE_MAPS_API_KEY=your-key node scripts/merge-ratings-tasmania.js --dry-run
 *   GOOGLE_MAPS_API_KEY=your-key node scripts/merge-ratings-tasmania.js --overwrite
 *
 * Options:
 *   --dry-run    : Show what would be updated without making Firestore writes
 *   --overwrite  : Refresh ratings even for wineries that already have values
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

// Delay between API requests — keeps us well under Google's QPS cap
const DELAY_MS = 200;

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
  console.error('Usage: GOOGLE_MAPS_API_KEY=your-key node scripts/merge-ratings-tasmania.js');
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
// Helpers
// ============================================================================

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch just the rating fields from Google Places API.
 * These sit in the cheapest "Basic" data SKU.
 */
async function fetchRating(placeId) {
  const fields = ['rating', 'user_ratings_total'].join(',');
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId.trim()}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK') {
    throw new Error(
      `Places API error: ${data.status}${data.error_message ? ` — ${data.error_message}` : ''}`
    );
  }

  return {
    rating: typeof data.result.rating === 'number' ? data.result.rating : null,
    userRatingsTotal:
      typeof data.result.user_ratings_total === 'number'
        ? data.result.user_ratings_total
        : null,
  };
}

/**
 * Did this doc already receive real rating data on a prior run?
 * The placeholder state from upload-tasmania-wineries.js is { rating: 0, userRatingsTotal: 0 }.
 */
function hasRating(wineryData) {
  return (
    typeof wineryData.rating === 'number' &&
    wineryData.rating > 0 &&
    typeof wineryData.userRatingsTotal === 'number' &&
    wineryData.userRatingsTotal > 0
  );
}

// ============================================================================
// Main
// ============================================================================

async function mergeRatings() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('⭐ Merge Google Ratings into Tasmania Wineries');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE — no Firestore writes will be made\n');
  }
  if (OVERWRITE) {
    console.log('♻️  OVERWRITE MODE — refreshing ratings even where they exist\n');
  }

  try {
    console.log('📋 Fetching wineries from Tasmania Firestore...');
    const snapshot = await db.collection('wineries').get();
    const wineries = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (wineries.length === 0) {
      console.error('❌ No wineries found in Tasmania Firestore');
      process.exit(1);
    }

    console.log(`✓ Found ${wineries.length} wineries\n`);

    let processedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let updatedCount = 0;

    console.log('🔄 Processing wineries...\n');

    for (let i = 0; i < wineries.length; i++) {
      const winery = wineries[i];
      const progress = `[${i + 1}/${wineries.length}]`;

      if (!winery.placeId) {
        console.warn(`${progress} ⚠️  ${winery.name || winery.id}`);
        console.warn(`          (no placeId — skipping)`);
        failedCount++;
        continue;
      }

      if (!OVERWRITE && hasRating(winery)) {
        console.log(`${progress} ✓ ${winery.name}`);
        console.log(`          (already rated: ⭐ ${winery.rating} / ${winery.userRatingsTotal} reviews)`);
        skippedCount++;
        continue;
      }

      let rating, userRatingsTotal;
      try {
        const result = await fetchRating(winery.placeId);
        rating = result.rating;
        userRatingsTotal = result.userRatingsTotal;
      } catch (error) {
        console.error(`${progress} ❌ ${winery.name}`);
        console.error(`          ${error.message}`);
        failedCount++;
        await sleep(DELAY_MS);
        continue;
      }

      if (rating === null && userRatingsTotal === null) {
        console.warn(`${progress} ⚠️  ${winery.name}`);
        console.warn(`          (Places returned no rating data)`);
        skippedCount++;
        await sleep(DELAY_MS);
        continue;
      }

      console.log(`${progress} ⭐ ${winery.name}`);
      console.log(`          Rating: ${rating ?? 'n/a'}  ·  Reviews: ${userRatingsTotal ?? 'n/a'}`);

      if (!DRY_RUN) {
        try {
          await db.collection('wineries').doc(winery.id).update({
            rating: rating ?? 0,
            userRatingsTotal: userRatingsTotal ?? 0,
          });
          updatedCount++;
        } catch (error) {
          console.error(`          ❌ Failed to update Firestore: ${error.message}`);
          failedCount++;
        }
      }

      processedCount++;
      await sleep(DELAY_MS);
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 Summary');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`📝 Processed: ${processedCount}`);
    if (DRY_RUN) {
      console.log(`💾 Updated:   ${processedCount} (DRY RUN — not actually saved)`);
    } else {
      console.log(`💾 Updated:   ${updatedCount}`);
    }
    console.log(`✓ Skipped:    ${skippedCount}`);
    console.log(`❌ Failed:    ${failedCount}`);
    console.log(`📈 Total:     ${wineries.length}`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    if (DRY_RUN) {
      console.log('ℹ️  DRY RUN completed. Run without --dry-run to save changes.\n');
    } else if (failedCount === 0 && updatedCount > 0) {
      console.log(`🎉 Successfully wrote ratings for ${updatedCount} winery/wineries!\n`);
    } else if (updatedCount > 0) {
      console.log(`⚠️  Updated ${updatedCount} wineries, but ${failedCount} failed.\n`);
    } else {
      console.log('⚠️  No ratings were written. Check your API key and Place IDs.\n');
    }
  } catch (error) {
    console.error('\n❌ Fatal error:');
    console.error(error.message);
    console.error('');
    process.exit(1);
  } finally {
    await app.delete();
  }
}

mergeRatings();
