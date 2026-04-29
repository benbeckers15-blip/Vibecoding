// scripts/seed-pour.js
// Seeds the `pour_articles` Firestore collection with The Tassie Pour issues.
//
// Schema — each document in `pour_articles`:
//   issueNumber  : number        — used for ordering (desc = latest first)
//   issueLabel   : string        — e.g. "THE TASSIE POUR · ISS. 24"
//   kicker       : string        — e.g. "Region report · Tamar Valley"
//   headline     : string
//   author       : string
//   authorInitials: string
//   date         : string        — display date e.g. "Apr 21"
//   readTime     : string        — e.g. "6 min read"
//   heroImage    : string        — URL
//   active       : boolean       — set false to hide from app without deleting
//   publishedAt  : Timestamp
//   body         : Block[]       — ordered array of content blocks (see below)
//   sponsor      : SponsorBlock | null
//   continueReading: ContinueItem[]
//
// Block types:
//   { type: "paragraph", text: string, dropCap?: boolean }
//   { type: "pullquote", text: string, attribution: string }
//   { type: "image",     url: string,  caption: string }
//
// ContinueItem:
//   { kicker: string, title: string, image: string }
//
// SponsorBlock:
//   { label: string, title: string, subtitle: string, image: string }
//
// To add a new issue each week, just add another entry to the `issues` array
// below and re-run this script. Existing documents are never overwritten —
// each run only inserts the issues whose `issueNumber` does not yet exist.

const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ─── Issues ───────────────────────────────────────────────────────────────────
const issues = [
  {
    issueNumber: 24,
    issueLabel: "THE TASSIE POUR · ISS. 24",
    kicker: "Region report · Tamar Valley",
    headline:
      "Why 2024 may be the Tamar's quietest great vintage in a decade.",
    author: "Hannah Reinl",
    authorInitials: "HR",
    date: "Apr 21",
    readTime: "6 min read",
    heroImage:
      "https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=900&q=80",
    active: true,
    publishedAt: admin.firestore.Timestamp.fromDate(new Date("2024-04-21")),
    body: [
      {
        type: "paragraph",
        dropCap: true,
        text:
          "t was, by every measure that matters in a winery's year-end summary, a forgettable vintage. The yields fell below five-year averages. The headlines went elsewhere — to the Yarra, to the Adelaide Hills, to anywhere with bigger stories and brighter sunshine.",
      },
      {
        type: "paragraph",
        text:
          "And yet here we are, six months on, sitting in a Pipers Brook tasting room, sipping a Pinot that will, in time, be argued about by people who weren't here.",
      },
      {
        type: "pullquote",
        text:
          '"We picked when we picked because the vines decided. The vines, in 2024, were patient."',
        attribution: "— Tom Wallace, winemaker",
      },
      {
        type: "paragraph",
        text:
          "That patience is the through-line of this report. A late, cool, dry summer; a slow ripening that frustrated the spreadsheet but rewarded the glass. Across nine producers visited for this issue, a single word kept returning: composure.",
      },
      {
        type: "image",
        url: "https://images.unsplash.com/photo-1566754844989-4c81d5b3a3b1?w=900&q=80",
        caption: "Barrel selection at Frogmore Creek. Photo: Anna Vouri",
      },
      {
        type: "paragraph",
        text:
          "What follows is a region-by-region breakdown of who picked what, when, and why this season may quietly outlive a few louder neighbours — and what it means for the cellar doors you visit this summer.",
      },
    ],
    sponsor: {
      label: "Sponsored · Tamar Valley Wine Trail",
      title: "The Tamar in 4 stops, one weekend.",
      subtitle: "Curated by the Tamar Wine Trail. From $189.",
      image:
        "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=400&q=80",
    },
    continueReading: [
      {
        kicker: "Producer interview",
        title: '"We picked at 2am." A frantic Coal River harvest.',
        image:
          "https://images.unsplash.com/photo-1566754844989-4c81d5b3a3b1?w=400&q=80",
      },
      {
        kicker: "On the bottle",
        title:
          "A field guide to Tasmanian sparkling, six grams at a time.",
        image:
          "https://images.unsplash.com/photo-1547595628-c61a29f496f0?w=400&q=80",
      },
    ],
  },

  // ── Add future issues here ────────────────────────────────────────────────
  // {
  //   issueNumber: 25,
  //   issueLabel: "THE TASSIE POUR · ISS. 25",
  //   kicker: "...",
  //   headline: "...",
  //   author: "...",
  //   authorInitials: "...",
  //   date: "Apr 28",
  //   readTime: "5 min read",
  //   heroImage: "https://...",
  //   active: true,
  //   publishedAt: admin.firestore.Timestamp.fromDate(new Date("2024-04-28")),
  //   body: [
  //     { type: "paragraph", dropCap: true, text: "..." },
  //     { type: "pullquote", text: "\"...\"", attribution: "— Name, role" },
  //     { type: "image", url: "https://...", caption: "Caption text" },
  //     { type: "paragraph", text: "..." },
  //   ],
  //   sponsor: null,
  //   continueReading: [],
  // },
];

// ─── Runner ───────────────────────────────────────────────────────────────────
async function run() {
  console.log("\n🍷 Seeding pour_articles collection...\n");

  // Fetch existing issue numbers so we never double-insert
  const existing = await db.collection("pour_articles").get();
  const existingNumbers = new Set(
    existing.docs.map((d) => d.data().issueNumber)
  );

  let inserted = 0;
  let skipped = 0;

  for (const issue of issues) {
    if (existingNumbers.has(issue.issueNumber)) {
      console.log(`⏭  Skipped Issue ${issue.issueNumber} (already exists)`);
      skipped++;
      continue;
    }
    await db.collection("pour_articles").add(issue);
    console.log(`✅ Inserted Issue ${issue.issueNumber}: "${issue.headline}"`);
    inserted++;
  }

  console.log(`\n📊 Done — ${inserted} inserted, ${skipped} skipped.\n`);
  console.log(
    "💡 To add next week's issue: append a new entry to the `issues` array\n" +
      "   in scripts/seed-pour.js and run `node scripts/seed-pour.js` again.\n"
  );
}

run().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
