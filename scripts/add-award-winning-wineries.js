/**
 * add-award-winning-wineries.js
 *
 * Marks the wineries listed below as Award-Winning by setting
 * `awardWinning: true` on each `wineries` document.
 *
 *   - If a document with the slug already exists → updates only the flag.
 *   - If it doesn't exist → creates a stub document with sensible defaults
 *     so the wineries list / filter chips don't crash on missing fields.
 *
 * Usage:
 *   node scripts/add-award-winning-wineries.js
 */

const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const AWARD_WINNERS = [
  "Bangor Vineyard Shed",
  "Bream Creek Vineyard",
  "Bruny Island Premium Wines",
  "Clover Hill Wines",
  "Craigie Knowe Vineyard And Flora's Restaurant",
  "Craigow",
  "Derwent Estate Vineyard",
  "Devil's Corner Cellar Door",
  "Freycinet Vineyards",
  "Frogmore Creek Cellar Door and Restaurant",
  "Ghost Rock Wines Tasmania",
  "Home Hill Winery",
  "House of Arras",
  "Iron Pot Bay Vineyard",
  "Josef Chromy Wines",
  "Laurel Bank Vineyard",
  "Moores Hill Estate",
  "Nocton Vineyard",
  "Pipers Brook Winery",
  "Riversdale Estate",
  "Small Wonder Wines",
  "Stefano Lubiana",
  "Tamar Ridge Cellar Door",
  "Velo Wines",
  "Brinktop Vineyard",
  "Broad Acres Vineyard",
  "Eastford Creek Vineyard",
];

// Match existing slug convention: lowercase, hyphenated, apostrophes stripped.
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['‘’]/g, "") // straight + curly apostrophes
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function run() {
  console.log(
    `\n🏆 Marking ${AWARD_WINNERS.length} wineries as Award-Winning...\n`
  );

  let created = 0;
  let updated = 0;

  for (const name of AWARD_WINNERS) {
    const slug = slugify(name);
    const ref = db.collection("wineries").doc(slug);
    const snap = await ref.get();

    if (snap.exists) {
      await ref.update({ awardWinning: true });
      console.log(`✅ Updated:  ${name.padEnd(50)} (${slug})`);
      updated++;
    } else {
      await ref.set({
        name,
        slug,
        awardWinning: true,

        // Default boolean filter fields (so existing chips behave correctly)
        dogFriendly: false,
        hasRestaurant: false,
        isOrganic: false,
        isBiodynamic: false,
        walkinWelcome: false,

        // Featured / display defaults
        featured: false,
        rating: 0,
        userRatingsTotal: 0,

        // Required-ish display fields
        description: [],
        images: [],

        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`🆕 Created:  ${name.padEnd(50)} (${slug})`);
      created++;
    }
  }

  console.log(`\n——————————————————————————`);
  console.log(`🆕 Created:           ${created}`);
  console.log(`✅ Updated:           ${updated}`);
  console.log(`🏆 Award-Winning now: ${created + updated}`);
  console.log(`——————————————————————————\n`);
}

run().catch((err) => {
  console.error("❌ Script failed:", err);
  process.exit(1);
});
