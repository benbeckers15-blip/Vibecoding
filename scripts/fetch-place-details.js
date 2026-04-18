// scripts/fetch-place-details.js
//
// For every winery that has a googlePlaceId, fetches phone, website,
// opening hours, and photos from the Google Places API and writes
// them to Firestore.
//
// Usage:
//   GOOGLE_MAPS_API_KEY=your-key node scripts/fetch-place-details.js
//   GOOGLE_MAPS_API_KEY=your-key node scripts/fetch-place-details.js --dry-run
//   GOOGLE_MAPS_API_KEY=your-key node scripts/fetch-place-details.js --overwrite
//
// By default skips wineries that already have all fields populated.
// Use --overwrite to refresh everything.

const admin = require('firebase-admin');
const fetch = require('node-fetch');
const serviceAccount = require('../service-account.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const DELAY_MS = 200;
const MAX_PHOTOS = 6; // max number of photo URLs to store per winery

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Fetch place details from Google Places API */
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
    throw new Error(`Places API error: ${data.status}`);
  }

  return data.result;
}

/** Convert a Places API photo reference into a usable image URL */
function photoUrl(photoReference) {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photoreference=${photoReference}&key=${GOOGLE_MAPS_API_KEY}`;
}

/** Format opening hours array into a readable string */
function formatHours(openingHours) {
  if (!openingHours?.weekday_text?.length) return null;
  // e.g. "Mon–Fri: 10am–5pm, Sat–Sun: 11am–4pm"
  return openingHours.weekday_text.join('  |  ');
}

async function main() {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error('❌ GOOGLE_MAPS_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const DRY_RUN   = process.argv.includes('--dry-run');
  const OVERWRITE = process.argv.includes('--overwrite');

  console.log('\n🍷 Google Places — Fetch Winery Details');
  console.log('─'.repeat(45));
  if (DRY_RUN)   console.log('🔍 DRY RUN — no Firestore writes');
  if (OVERWRITE) console.log('♻️  OVERWRITE mode — refreshing all fields');
  console.log('');

  const snapshot = await db.collection('wineries').get();
  const wineries = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`📋 Found ${wineries.length} wineries\n`);

  let updated = 0;
  let skipped = 0;
  let noPlaceId = 0;
  let failed = 0;

  for (const winery of wineries) {
    if (!winery.googlePlaceId) {
      console.log(`⚠️  No googlePlaceId: ${winery.name}`);
      noPlaceId++;
      continue;
    }

    // Skip if already fully populated and not in overwrite mode
    const alreadyHasData = winery.phone && winery.website && winery.hours &&
      Array.isArray(winery.images) && winery.images.length > 0;

    if (alreadyHasData && !OVERWRITE) {
      console.log(`⏭️  Skipping (already complete): ${winery.name}`);
      skipped++;
      continue;
    }

    process.stdout.write(`🔍 ${winery.name}... `);

    try {
      const result = await fetchPlaceDetails(winery.googlePlaceId);

      const updates = {};

      if (result.formatted_phone_number) {
        updates.phone = result.formatted_phone_number;
      }
      if (result.website) {
        updates.website = result.website;
      }
      const hours = formatHours(result.opening_hours);
      if (hours) {
        updates.hours = hours;
      }
      if (result.photos?.length) {
        updates.images = result.photos
          .slice(0, MAX_PHOTOS)
          .map(p => photoUrl(p.photo_reference));
      }

      if (Object.keys(updates).length === 0) {
        console.log('⚠️  No data returned by Places API');
        skipped++;
      } else {
        const summary = Object.keys(updates).join(', ');
        if (DRY_RUN) {
          console.log(`✅ (dry run) would set: ${summary}`);
          if (updates.phone)   console.log(`     📞 ${updates.phone}`);
          if (updates.website) console.log(`     🌐 ${updates.website}`);
          if (updates.hours)   console.log(`     🕐 ${updates.hours.slice(0, 80)}...`);
          if (updates.images)  console.log(`     🖼  ${updates.images.length} photos`);
        } else {
          await db.collection('wineries').doc(winery.id).update(updates);
          console.log(`✅ updated: ${summary}`);
        }
        updated++;
      }
    } catch (err) {
      console.log(`❌ ${err.message}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log('\n─'.repeat(45));
  console.log(`✅ Updated:       ${updated}`);
  console.log(`⏭️  Skipped:       ${skipped}`);
  console.log(`⚠️  No place ID:   ${noPlaceId}`);
  if (failed) console.log(`❌ Failed:        ${failed}`);
  process.exit(0);
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err.message);
  process.exit(1);
});
