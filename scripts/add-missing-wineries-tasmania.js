#!/usr/bin/env node
/**
 * Add Missing Tasmania Wineries to Firestore
 *
 * This script takes a hardcoded list of wineries identified as missing from the
 * Tasmania Firestore database (sourced from Wine Tasmania / Google Drive records),
 * looks up each one via the Google Places API to resolve a Place ID, then
 * uploads them to Firestore using the standard winery schema.
 *
 * Usage:
 *   GOOGLE_MAPS_API_KEY=your-key node scripts/add-missing-wineries-tasmania.js
 *   GOOGLE_MAPS_API_KEY=your-key node scripts/add-missing-wineries-tasmania.js --dry-run
 *   GOOGLE_MAPS_API_KEY=your-key node scripts/add-missing-wineries-tasmania.js --skip-confirm
 *
 * Options:
 *   --dry-run       : Show which wineries would be added without writing to Firestore
 *   --skip-confirm  : Skip the 3-second confirmation countdown
 *
 * Requirements:
 *   - GOOGLE_MAPS_API_KEY environment variable set
 *   - service-account-tasmania.json in project root
 *
 * After running this script, run the following to enrich the new entries:
 *   GOOGLE_MAPS_API_KEY=your-key node scripts/geocode-tasmania-wineries.js
 *   GOOGLE_MAPS_API_KEY=your-key node scripts/fetch-place-details-tasmania.js
 *   node scripts/generate-descriptions-tasmania.js
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

// Delay between Google Places API requests (ms) — stays within free-tier rate limits
const DELAY_MS = 200;

// ============================================================================
// Command Line Flags
// ============================================================================

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_CONFIRM = process.argv.includes('--skip-confirm');

// ============================================================================
// Missing Wineries List
// (sourced from Wine_Tasmania_Producers_Full Google Drive document,
//  cross-referenced against existing tasmania_wineries.json — April 2026)
// ============================================================================

const MISSING_WINERIES = [
  // ── Coal River Valley ─────────────────────────────────────────────────────
  { name: 'Bremley Vineyard',        website: 'www.bremley.com.au',           region: 'Coal River Valley' },
  { name: 'Brinktop Vineyard',       website: 'www.brinktop.com.au',          region: 'Coal River Valley' },
  { name: 'sixfriends Vineyard',     website: 'www.sixfriends.com.au',        region: 'Coal River Valley' },
  { name: 'Charles Reuben Estate',   website: 'www.charlesreuben.com.au',     region: 'Coal River Valley' },
  { name: 'Mapleton Vineyards',      website: 'www.mapletonvineyard.com.au',  region: 'Coal River Valley' },
  { name: 'Merriworth Wines',        website: 'www.merriworth.com.au',        region: 'Coal River Valley' },
  { name: 'Richmond Park Estate',    website: 'richmondpark.estate',          region: 'Coal River Valley' },
  { name: 'Roslyn 1823',             website: 'www.roslyn-1823.com',          region: 'Coal River Valley' },
  { name: 'Sisu Wines',              website: '',                             region: 'Coal River Valley' },
  { name: 'Stargazer Wine',          website: 'www.stargazerwine.com',        region: 'Coal River Valley' },
  { name: 'Uplands Vineyard',        website: 'www.uplandsvineyard.com',      region: 'Coal River Valley' },

  // ── Derwent Valley ────────────────────────────────────────────────────────
  { name: 'Dawson James Wines',      website: 'www.dawsonjames.com.au',       region: 'Derwent Valley' },
  { name: 'Domaine Dawnelle',        website: 'www.domainedawnelle.com',      region: 'Derwent Valley' },
  { name: 'Glenelg Estate',          website: 'www.glenelgestate.com.au',     region: 'Derwent Valley' },
  { name: 'Invercarron Wines',       website: 'www.invercarronwine.com.au',   region: 'Derwent Valley' },
  { name: 'Kinvarra Wines',          website: 'www.kinvarrawines.com.au',     region: 'Derwent Valley' },
  { name: 'Lowestoft Estate',        website: 'www.lowestoft.wine',           region: 'Derwent Valley' },
  { name: 'Meadowbank Wines',        website: 'www.meadowbank.com.au',        region: 'Derwent Valley' },
  { name: 'Quiet Mutiny',            website: 'www.quietmutiny.wine',         region: 'Derwent Valley' },

  // ── East Coast ────────────────────────────────────────────────────────────
  { name: 'Apsley Gorge Vineyard',   website: 'www.apsleygorgevineyard.com',  region: 'East Coast' },

  // ── Huon Valley and Channel ───────────────────────────────────────────────
  { name: 'Aunt Alice Wines',        website: 'www.auntalice.com.au',         region: 'Huon Valley and Channel' },
  { name: 'Chatto Wines',            website: 'www.chattowines.com.au',       region: 'Huon Valley and Channel' },
  { name: 'Frankcomb Vineyard',      website: '',                             region: 'Huon Valley and Channel' },
  { name: 'Sailor Seeks Horse',      website: 'www.sailorseekshorse.com.au',  region: 'Huon Valley and Channel' },
  { name: 'Wines By Rory',           website: 'www.rdmeure.com.au',           region: 'Huon Valley and Channel' },

  // ── North West ────────────────────────────────────────────────────────────
  { name: 'Broad Acres Vineyard',    website: 'www.broadacres.com.au',        region: 'North West' },
  { name: 'Eastford Creek Vineyard', website: 'www.eastfordcreek.com.au',     region: 'North West' },
  { name: 'La Villa Wines',          website: 'www.lavillawines.com.au',      region: 'North West' },
  { name: 'Leven Valley Vineyard',   website: 'www.levenvalleyvineyard.com.au', region: 'North West' },

  // ── Pipers River ──────────────────────────────────────────────────────────
  { name: 'Apogee Tasmania',         website: 'www.apogeetasmania.com',       region: 'Pipers River' },
  { name: 'Bay of Fires Wines',      website: 'www.bayoffireswines.com.au',   region: 'Pipers River' },
  { name: 'Bellebonne',              website: 'www.bellebonne.wine',          region: 'Pipers River' },
  { name: 'Oxberry Vineyard',        website: '',                             region: 'Pipers River' },
  { name: 'Wellington & Wolfe',      website: 'www.wellingtonwolfe.com',      region: 'Pipers River' },

  // ── Tamar Valley ──────────────────────────────────────────────────────────
  { name: 'Broad Arrow Wines',       website: 'www.broadarrowwines.com.au',   region: 'Tamar Valley' },
  { name: 'Bundaleera Vineyard',     website: 'www.bundaleerawines.com.au',   region: 'Tamar Valley' },
  { name: 'Chartley Estate',         website: 'www.chartleyestatevineyard.com.au', region: 'Tamar Valley' },
  { name: 'Eversley Vines',          website: 'www.eversleyvines.com.au',     region: 'Tamar Valley' },
  { name: 'Fish Hook Wines',         website: '',                             region: 'Tamar Valley' },
  { name: 'Grey Sands Vineyard',     website: 'www.greysands.com.au',         region: 'Tamar Valley' },
  { name: 'Handpicked Wines',        website: 'www.handpickedwines.com.au',   region: 'Tamar Valley' },
  { name: 'Lost Farm Wines',         website: 'www.lostfarmwines.com.au',     region: 'Tamar Valley' },
  { name: 'Heemskerk Wines',         website: 'www.heemskerk.com.au',         region: 'Tamar Valley' },
  { name: 'Utzinger Wines',          website: 'www.utzingerwines.com.au',     region: 'Tamar Valley' },
  { name: 'Winter Brook Vineyard',   website: 'www.winterbrookvineyard.com.au', region: 'Tamar Valley' },
];

// ============================================================================
// Validation
// ============================================================================

if (!GOOGLE_MAPS_API_KEY) {
  console.error('\n❌ Error: GOOGLE_MAPS_API_KEY environment variable not set');
  console.error('Usage: GOOGLE_MAPS_API_KEY=your-key node scripts/add-missing-wineries-tasmania.js\n');
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
 * Generate a URL-safe slug from a winery name
 */
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '');
}

/**
 * Search Google Places API for a winery by name and return its Place ID.
 * Uses the Find Place from Text endpoint with "name + Tasmania" as the query
 * to ensure we get the Tasmanian result and not a same-named place elsewhere.
 */
async function findPlaceId(wineryName) {
  const query = encodeURIComponent(`${wineryName} Tasmania`);
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=place_id,name,formatted_address&key=${GOOGLE_MAPS_API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.candidates && data.candidates.length > 0) {
      const candidate = data.candidates[0];
      return {
        placeId: candidate.place_id,
        foundName: candidate.name,
        address: candidate.formatted_address || '',
      };
    }

    if (data.status === 'ZERO_RESULTS') {
      return null;
    }

    console.warn(`    ⚠️  API status: ${data.status}${data.error_message ? ` — ${data.error_message}` : ''}`);
    return null;
  } catch (error) {
    console.error(`    ❌ Network error: ${error.message}`);
    return null;
  }
}

// ============================================================================
// Main Function
// ============================================================================

async function addMissingWineries() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🍷 Add Missing Tasmania Wineries');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE — no Firestore writes will be made\n');
  }

  console.log(`📋 ${MISSING_WINERIES.length} wineries to look up and add\n`);

  // Confirmation prompt
  if (!DRY_RUN && !SKIP_CONFIRM) {
    console.log('⚠️  This will add new winery documents to Tasmania Firestore.');
    console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');
    await sleep(3000);
  }

  // ── Phase 1: Look up Place IDs ─────────────────────────────────────────────

  console.log('🔍 Phase 1: Looking up Place IDs via Google Places API...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const resolved = [];   // { name, placeId, foundName, address, region, website }
  const notFound = [];   // { name, region }

  for (let i = 0; i < MISSING_WINERIES.length; i++) {
    const winery = MISSING_WINERIES[i];
    const progress = `[${i + 1}/${MISSING_WINERIES.length}]`;

    process.stdout.write(`${progress} 🔎 ${winery.name} (${winery.region})...\n`);

    const result = await findPlaceId(winery.name);

    if (result) {
      console.log(`         ✅ Found: "${result.foundName}"`);
      console.log(`            Place ID: ${result.placeId}`);
      if (result.address) {
        console.log(`            Address: ${result.address}`);
      }
      resolved.push({
        name: winery.name,
        placeId: result.placeId,
        foundName: result.foundName,
        address: result.address,
        region: winery.region,
        website: winery.website,
      });
    } else {
      console.log(`         ❌ Not found on Google Places`);
      notFound.push({ name: winery.name, region: winery.region });
    }

    await sleep(DELAY_MS);
  }

  // ── Phase 1 Summary ────────────────────────────────────────────────────────

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Resolved:   ${resolved.length}/${MISSING_WINERIES.length}`);
  console.log(`❌ Not found:  ${notFound.length}/${MISSING_WINERIES.length}`);

  if (notFound.length > 0) {
    console.log('\n⚠️  The following wineries had no Google Places match:');
    notFound.forEach(w => console.log(`   • ${w.name} (${w.region})`));
    console.log('\n   These may be very small producers without a Google listing.');
    console.log('   You can add them manually via the Firebase Console.');
  }

  if (resolved.length === 0) {
    console.log('\n❌ No wineries resolved — nothing to upload.');
    await app.delete();
    process.exit(0);
  }

  // ── Phase 2: Upload to Firestore ───────────────────────────────────────────

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🚀 Phase 2: Uploading to Firestore...');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  let uploadedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  // Check which placeIds already exist to avoid duplicates
  console.log('📋 Checking for existing documents...');
  const existingSnapshot = await db.collection('wineries').get();
  const existingPlaceIds = new Set(
    existingSnapshot.docs.map(doc => doc.data().placeId).filter(Boolean)
  );
  console.log(`   Found ${existingPlaceIds.size} existing winery documents\n`);

  const batch = db.batch();
  let batchSize = 0;
  const BATCH_LIMIT = 500;

  for (let i = 0; i < resolved.length; i++) {
    const winery = resolved[i];
    const progress = `[${i + 1}/${resolved.length}]`;

    // Skip if this placeId is already in Firestore
    if (existingPlaceIds.has(winery.placeId)) {
      console.log(`${progress} ✓ ${winery.name}`);
      console.log(`          (already in Firestore — skipped)`);
      skippedCount++;
      continue;
    }

    const slug = generateSlug(winery.name);
    const docRef = db.collection('wineries').doc(slug);

    const docData = {
      placeId: winery.placeId,
      name: winery.name,
      slug: slug,
      region: winery.region,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      // Placeholder values — populate via fetch-place-details-tasmania.js
      description: [],
      images: [],
      phone: '',
      website: winery.website ? `https://${winery.website.replace(/^https?:\/\//, '')}` : '',
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

    if (DRY_RUN) {
      console.log(`${progress} 📝 ${winery.name}`);
      console.log(`          • Slug: ${slug}`);
      console.log(`          • Place ID: ${winery.placeId}`);
      console.log(`          • Region: ${winery.region}`);
      if (winery.website) console.log(`          • Website: ${docData.website}`);
      uploadedCount++;
    } else {
      batch.set(docRef, docData, { merge: false });
      batchSize++;
      uploadedCount++;

      console.log(`${progress} ✅ ${winery.name}`);
      console.log(`          • Slug: ${slug}`);
      console.log(`          • Place ID: ${winery.placeId}`);
      console.log(`          • Region: ${winery.region}`);

      // Commit batch when it reaches the limit
      if (batchSize >= BATCH_LIMIT) {
        try {
          await batch.commit();
          console.log(`\n  ✓ Committed batch (${uploadedCount} documents so far)\n`);
          batchSize = 0;
        } catch (error) {
          console.error(`  ❌ Batch commit failed: ${error.message}`);
          errorCount += BATCH_LIMIT;
          batchSize = 0;
        }
      }
    }
  }

  // Commit any remaining documents
  if (!DRY_RUN && batchSize > 0) {
    try {
      await batch.commit();
      console.log(`\n  ✓ Committed final batch`);
    } catch (error) {
      console.error(`  ❌ Final batch commit failed: ${error.message}`);
      errorCount += batchSize;
    }
  }

  // ── Final Summary ──────────────────────────────────────────────────────────

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`✅ Resolved via Places API:  ${resolved.length}/${MISSING_WINERIES.length}`);
  console.log(`❌ Not found on Google:      ${notFound.length}/${MISSING_WINERIES.length}`);

  if (DRY_RUN) {
    console.log(`📝 Would upload:             ${uploadedCount}`);
    console.log(`✓  Would skip (duplicate):   ${skippedCount}`);
  } else {
    console.log(`💾 Uploaded to Firestore:    ${uploadedCount - errorCount}`);
    console.log(`✓  Skipped (duplicate):      ${skippedCount}`);
    console.log(`❌ Errors:                   ${errorCount}`);
  }
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (DRY_RUN) {
    console.log('ℹ️  DRY RUN complete. Run without --dry-run to write to Firestore.\n');
  } else if (uploadedCount > 0 && errorCount === 0) {
    console.log(`🎉 Successfully added ${uploadedCount} new winery/wineries!\n`);
  } else if (uploadedCount > 0) {
    console.log(`⚠️  Added ${uploadedCount - errorCount} wineries, but ${errorCount} failed.\n`);
  }

  console.log('📝 Next steps:');
  console.log('   1. Geocode the new entries (add lat/lng):');
  console.log('      GOOGLE_MAPS_API_KEY=your-key node scripts/geocode-tasmania-wineries.js');
  console.log('   2. Fetch phone, website, hours & photos:');
  console.log('      GOOGLE_MAPS_API_KEY=your-key node scripts/fetch-place-details-tasmania.js');
  console.log('   3. Generate AI descriptions:');
  console.log('      node scripts/generate-descriptions-tasmania.js');
  console.log('   4. Verify results in Firebase Console:');
  console.log('      https://console.firebase.google.com/project/winery-tourism-tasmania/firestore');
  console.log('');

  // Cleanup
  await app.delete();
  process.exit(0);
}

// ============================================================================
// Run
// ============================================================================

addMissingWineries().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
