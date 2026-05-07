// scripts/seed-explore-articles.js
//
// Seeds the `explore_articles` Firestore collection.
// Each document drives one row in the Explore tab's "THE LIBRARY" section.
//
// Run with:   node scripts/seed-explore-articles.js
//
// Fields:
//   key      — unique string identifier (used as document ID)
//   kicker   — uppercase category label, e.g. "TASTING NOTES"
//   title    — article series title
//   blurb    — short description shown in the row
//   image    — URL for the thumbnail (swap for Firebase Storage URLs anytime)
//   cadence  — publishing frequency label, e.g. "Monthly", "Series"
//   href     — in-app route to navigate to on tap (omit or set null = "Coming soon")
//   order    — integer used to sort rows ascending
//   active   — set false to hide a row without deleting it

const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const articles = [
  {
    key:     "sommelier-recommendations",
    kicker:  "TASTING NOTES",
    title:   "Sommelier Recommendations",
    blurb:   "Hand-picked bottles from the region's leading wine professionals.",
    image:   "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=900&q=80",
    cadence: "Monthly",
    href:    "/(tabs)/articles/sommelier-recommendations",
    order:   1,
    active:  true,
  },
  {
    key:     "hidden-gems",
    kicker:  "DISCOVERY",
    title:   "Hidden Gems",
    blurb:   "Small-batch producers and tasting rooms most visitors never find.",
    image:   "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=900&q=80",
    cadence: "Series",
    href:    "/(tabs)/articles/hidden-gems",
    order:   2,
    active:  true,
  },
  {
    key:     "vintage-reports",
    kicker:  "REGION",
    title:   "Vintage Reports",
    blurb:   "How the season shaped this year's release — variety by variety.",
    image:   "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=900&q=80",
    cadence: "Annual",
    href:    "/(tabs)/articles/vintage-reports",
    order:   3,
    active:  true,
  },
  {
    key:     "behind-the-cellar-door",
    kicker:  "INTERVIEW",
    title:   "Behind the Cellar Door",
    blurb:   "Conversations with the winemakers, growers and sommeliers behind the bottle.",
    image:   "https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=900&q=80",
    cadence: "Series",
    href:    "/(tabs)/articles/behind-the-cellar-door",
    order:   4,
    active:  true,
  },
  {
    key:     "pairings",
    kicker:  "AT THE TABLE",
    title:   "Food & Wine Pairings",
    blurb:   "Local kitchens and cellars on what pours best with what plate.",
    image:   "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&q=80",
    cadence: "Monthly",
    href:    "/(tabs)/articles/pairings",
    order:   5,
    active:  true,
  },
];

async function run() {
  console.log("\n📚 Seeding explore_articles collection...\n");

  for (const article of articles) {
    // Use key as the document ID so re-running this script is idempotent
    await db.collection("explore_articles").doc(article.key).set(article);
    console.log(`✅  ${article.order}. "${article.title}"`);
  }

  console.log("\n✅  Done! Swap image URLs in the Firebase Console whenever you like.\n");
}

run().catch(console.error);
