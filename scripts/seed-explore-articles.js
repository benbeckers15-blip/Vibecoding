// scripts/seed-explore-articles.js
//
// Seeds the `explore_articles` Firestore collection — a single source of
// truth for every Library article on the home screen.
//
// Each document drives:
//   1. The home-page rail card (thumbnail + kicker + title + blurb + cadence)
//   2. The article reader screen (hero image + lede + sections + pull quotes
//      + callouts + Q&A) under /home/articles/<slug>.
//
// Run with:   node scripts/seed-explore-articles.js
//
// ── Document shape ──────────────────────────────────────────────────────────
//
// Identity
//   key                 — string, same as the Firestore doc ID
//   slug                — string, deep-link slug (usually same as key)
//   order               — integer, asc-sorted on the home rail
//   active              — set false to hide a row without deleting it
//   href                — in-app route, e.g. "/(tabs)/home/articles/hidden-gems"
//
// Thumbnail (shown on the home rail)
//   thumbnailImage      — URL — CLEARLY LABELED, swap this to change the card photo
//   thumbnailKicker     — uppercase category, e.g. "TASTING NOTES"
//   thumbnailTitle      — short title for the home card
//   thumbnailBlurb      — one-sentence description
//   thumbnailCadence    — publishing frequency, e.g. "Monthly", "Series"
//
// Article (shown on the article reader)
//   layout              — "editorial" | "list" | "magazine" | "interview"
//   articleTitle        — full title shown on the reader hero
//   heroImage           — URL — CLEARLY LABELED, top-of-article photo
//   pullQuoteBackgroundImage — OPTIONAL URL, photo behind a featured pull quote
//   publishDate, author, subject (interview only), lede
//
// Sections: array of typed blocks, in the order they appear in the article.
//   { type: "body",         paragraphs: ["..."] }
//   { type: "pullQuote",    text: "...", attribution?: "...", backgroundImage?: "..." }
//   { type: "imageGallery", images: [{ url, caption?, alt? }] }
//   { type: "callout",      text: "...", kicker?: "EDITOR'S NOTE" }
//   { type: "qa",           heading: "THE TRANSCRIPT" }   (interview only)
//
// Q&A (interview only)
//   qa: [{ question: "...", answer: "..." }]
//
// To swap an image, edit the `url` field on the block in question (or
// `thumbnailImage` / `heroImage` / `pullQuoteBackgroundImage` on the article
// itself), re-run this script, and restart the app. Done.

const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Every doc carries a regionId so the home rail's
// where("regionId", "==", regionId) query returns it. Currently single-region
// (Tasmania); when a second region launches, duplicate the articles below
// with the appropriate regionId.
const REGION_ID = "tasmania";

// ─── Articles ────────────────────────────────────────────────────────────────

const articles = [
  // ───────────────────────────────────────────────────────────────────────
  // 1. Sommelier Recommendations — list layout
  // ───────────────────────────────────────────────────────────────────────
  {
    key:      "sommelier-recommendations",
    slug:     "sommelier-recommendations",
    order:    1,
    active:   true,
    href:     "/(tabs)/home/articles/sommelier-recommendations",

    thumbnailImage:   "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=900&q=80",
    thumbnailKicker:  "TASTING NOTES",
    thumbnailTitle:   "Sommelier Recommendations",
    thumbnailBlurb:   "Hand-picked bottles from the region's leading wine professionals.",
    thumbnailCadence: "Monthly",

    layout:       "list",
    articleTitle: "Six Bottles for the Cool Months",
    publishDate:  "May 2026",
    author:       "Marisol Vega",
    heroImage:    "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=1600&q=80",
    lede:
      "Six bottles our team is reaching for as the evenings get longer — chosen with autumn cooking, fireside drinking, and the long Tasmanian dusk in mind.",

    sections: [
      { type: "body", paragraphs: [
        "Domaine Brisbois 2023 Pinot Noir",
        "An understated bottling from one of the Tamar's most thoughtful producers. The 2023 is darker and broader than the lifted, perfumed 2022 — black cherry, smoked thyme, and a long, soft tannin. Drinks beautifully now, will be even better in two years. Around $58 cellar door.",
      ]},
      { type: "body", paragraphs: [
        "Wellesley Estate 2024 Riesling",
        "Bone-dry, knife-edged, smelling like a cut nashi pear in a stone room. This is the bottle to hand to anyone who thinks they don't like riesling. Pours mean and finishes long. Ten years of cellar life ahead of it. Around $38.",
      ]},
      { type: "imageGallery", images: [
        { url: "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=1200&q=80",
          caption: "Bottles from Domaine Brisbois, photographed at cellar door.",
          alt: "Two unlabelled bottles of Pinot Noir on a wooden bench" },
        { url: "https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=1200&q=80",
          caption: "The Wellesley Estate tasting bench at first light.",
          alt: "Empty wine glasses lined up on a stone bench" },
      ]},
      { type: "body", paragraphs: [
        "Coal River Cellars 2022 Méthode Traditionnelle Brut",
        "Four years on lees and it shows — brioche, cool apple skin, that fine, persistent thread of bubble that makes a great Tasmanian sparkling almost telepathic with food. Uncork before the salt-and-vinegar chips emerge. Around $52.",
      ]},
      { type: "body", paragraphs: [
        "Strathlyn Old Vines 2023 Chardonnay",
        "Made by hand from a single vineyard planted in 1986. Restrained, salty, with citrus rind and a finish that keeps unwinding. The kind of chardonnay that converts skeptics. Around $64.",
      ]},
      { type: "pullQuote",
        text: "If a wine doesn't taste like the place it came from, I am not interested in pouring it.",
        attribution: "— Marisol Vega",
      },
      { type: "body", paragraphs: [
        "Hartford Lane 2022 Pinot Gris",
        "More skin contact than a typical Tassie pinot gris — it pours a soft amber and tastes of pear skin and quince paste. An autumn bottle if there ever was one. Sits beautifully next to a cheese board with anything aged. Around $34.",
      ]},
      { type: "body", paragraphs: [
        "Maker's Bench NV \"Field\" Red",
        "An across-vintages blend the Maker's Bench team release once a year, fortuitously when the weather turns. Mostly pinot, a splash of syrah, and something a little wild in the background. Drinks like a story. Around $46.",
      ]},
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // 2. Hidden Gems — magazine layout
  // ───────────────────────────────────────────────────────────────────────
  {
    key:      "hidden-gems",
    slug:     "hidden-gems",
    order:    2,
    active:   true,
    href:     "/(tabs)/home/articles/hidden-gems",

    thumbnailImage:   "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=900&q=80",
    thumbnailKicker:  "DISCOVERY",
    thumbnailTitle:   "Hidden Gems",
    thumbnailBlurb:   "Small-batch producers and tasting rooms most visitors never find.",
    thumbnailCadence: "Series",

    layout:       "magazine",
    articleTitle: "Down Quiet Lanes",
    publishDate:  "May 2026",
    author:       "Eliza Kerrison",
    heroImage:    "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=1600&q=80",
    lede:
      "Five small-batch producers and tasting rooms most visitors never find — tucked at the end of dirt tracks, signposted only by a hand-painted board nailed to a gum tree.",

    sections: [
      { type: "body", paragraphs: [
        "Tasmania's wine country tends to telegraph itself in big sandstone gateways and curated lavender approach roads. The cellar doors in this piece do none of that. Most of them you find by overshooting twice, doubling back, and then finally noticing the painted sign. That is part of the romance, and most of the reward.",
        "We spent four days driving slowly between the Coal River Valley and the Tamar, mostly without an itinerary, asking the people we met where they would send their best friend on a Sunday afternoon. The answers had nothing in common except a kind of quiet — small rooms, small pours, and a long view of paddock.",
      ]},
      { type: "imageGallery", images: [
        { url: "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200&q=80",
          caption: "The unsigned approach to a Coal River cellar door.",
          alt: "Long gravel driveway between vines under a wide sky" },
        { url: "https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=1200&q=80",
          caption: "Tasting glasses, lined up Sunday afternoon.",
          alt: "Row of empty wine glasses on a wooden table" },
      ]},
      { type: "pullQuote",
        text: "If you can hear the road from the tasting bench, you have probably gone to the wrong place.",
        attribution: "— Eliza Kerrison",
        // The magazine layout can render a pull quote on top of a photograph.
        // Drop a URL here to use this feature on this block.
        backgroundImage: "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1600&q=80",
      },
      { type: "body", paragraphs: [
        "The first stop was a converted shearing shed run by a winemaker who poured straight from the barrel and refused to commit to a release date. The Riesling was bone dry and absurd. We bought what we could carry.",
        "Two valleys over, a husband-and-wife team are making nine barrels of pinot a year on a north-facing slope they cleared by hand. The tasting room is a card table on the verandah. They opened a bottle that should not have been opened on a Tuesday morning, and we drank it watching the wind move through the rows.",
      ]},
      { type: "callout",
        kicker: "FROM THE FIELD",
        text:
          "All five cellar doors below operate by appointment only. A short text the day before is usually enough — but call ahead if you are bringing a group of more than four.",
      },
      { type: "imageGallery", images: [
        { url: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=1600&q=80",
          caption: "Last light, last bottle.",
          alt: "Sunset over a vineyard with a half-empty wine glass in the foreground" },
      ]},
      { type: "body", paragraphs: [
        "The last stop was the smallest. A single-row planting of a Jurassic-era Italian variety nobody else in the state grows, made into a wine that tasted like late-summer evenings and absolutely nothing else we had drunk that week. We left with the last two bottles and the winemaker's mobile number, scrawled on the back of a feed-store receipt.",
      ]},
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // 3. Vintage Reports — list layout
  // ───────────────────────────────────────────────────────────────────────
  {
    key:      "vintage-reports",
    slug:     "vintage-reports",
    order:    3,
    active:   true,
    href:     "/(tabs)/home/articles/vintage-reports",

    thumbnailImage:   "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=900&q=80",
    thumbnailKicker:  "REGION",
    thumbnailTitle:   "Vintage Reports",
    thumbnailBlurb:   "How the season shaped this year's release — variety by variety.",
    thumbnailCadence: "Annual",

    layout:       "list",
    articleTitle: "The 2026 Vintage, Variety by Variety",
    publishDate:  "May 2026",
    author:       "Hugh Anders",
    heroImage:    "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1600&q=80",
    lede:
      "A cool, dry summer with a generous late-March stretch produced the kind of vintage growers will talk about for a decade. Variety by variety, here is how the season landed.",

    sections: [
      { type: "body", paragraphs: [
        "Riesling",
        "The standout. A late, slow ripening window held acid high while still letting the aromatics open up — winemakers across the Tamar are reporting their best fruit in five years. Expect tightly wound, high-citrus releases that will reward two or three years in bottle. Yields were down by about 12 percent on the long-term average, but quality more than compensates.",
      ]},
      { type: "body", paragraphs: [
        "Chardonnay",
        "A patient vintage rewarded patient producers. Growers who held nerve through a slow February saw flavours catch up to sugars in the final fortnight. The wines coming off ferment now are textural, mineral, and notably less tropical than the warm 2024 set. Several producers are talking about doing less in the cellar — less new oak, less battonage — and letting the fruit lead.",
      ]},
      { type: "pullQuote",
        text: "I have not seen acid like this since 2018. We were filling barrels and laughing — it was almost too good.",
        attribution: "— A Tamar Valley winemaker",
      },
      { type: "body", paragraphs: [
        "Pinot Noir",
        "Smaller berries, thicker skins, deep colour, real grip. Early ferments are showing dark cherry and a savoury herbal lift that often takes pinot a year in barrel to develop. The challenge will be in the cellar, not the vineyard — extraction needs a light touch on this fruit, and the wines that nail it will be benchmark.",
      ]},
      { type: "body", paragraphs: [
        "Sauvignon Blanc",
        "Quietly excellent. Without the heat spikes that flatten the variety in warmer years, this vintage's sauvignon is showing the herbal, fennel-and-lime register Tasmania does best. Expect linear, restrained wines — not a vintage for the tropical-fruit camp, but a great one for everyone else.",
      ]},
      { type: "callout",
        kicker: "EDITOR'S NOTE",
        text:
          "Yields across the state were down 8 to 15 percent on the five-year average, with the largest reductions in the Coal River Valley. Cellar door pricing will reflect this — release prices on premium tiers are expected to lift 5 to 10 percent.",
      },
      { type: "body", paragraphs: [
        "Sparkling base",
        "The headline good news. Cool nights through January preserved the high natural acid that traditional-method winemakers live for, and base wines are coming off press with the structure to carry serious time on lees. Houses making tirage decisions now are talking about extended ageing windows — meaning the 2026 sparklings probably will not appear on shelf until 2031 or later, and you will want to be in line for them.",
      ]},
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // 4. Behind the Cellar Door — interview layout
  // ───────────────────────────────────────────────────────────────────────
  {
    key:      "behind-the-cellar-door",
    slug:     "behind-the-cellar-door",
    order:    4,
    active:   true,
    href:     "/(tabs)/home/articles/behind-the-cellar-door",

    thumbnailImage:   "https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=900&q=80",
    thumbnailKicker:  "INTERVIEW",
    thumbnailTitle:   "Behind the Cellar Door",
    thumbnailBlurb:   "Conversations with the winemakers, growers and sommeliers behind the bottle.",
    thumbnailCadence: "Series",

    layout:       "interview",
    articleTitle: "On dry farming, mistakes, and the patience that pinot demands.",
    subject:      "Mira Tomić",
    publishDate:  "May 2026",
    author:       "Hugh Anders",
    heroImage:    "https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=1600&q=80",
    lede:
      "We spent a Wednesday morning at Tomić Estate's tasting room, drinking the unfiltered 2023 pinot off the barrel and talking about why she still farms a vineyard most of her contemporaries gave up on a decade ago.",

    sections: [
      { type: "body", paragraphs: [
        "Mira Tomić arrives in a wax jacket and gumboots, apologises for being five minutes late, and has poured the first glass before she has even taken her coat off. The cellar smells of damp wood and the previous night's rain. We sit at the long table near the window, where the light is good and you can see the vines climbing the slope.",
      ]},
      { type: "callout",
        kicker: "BIO",
        text:
          "Mira Tomić took over Tomić Estate in 2014 from her father, who planted the first vines on the property in 1989. She is widely credited with the estate's shift toward dry-farmed, single-vineyard releases. The 2023 pinot is her tenth vintage as head winemaker.",
      },
      { type: "qa", heading: "THE TRANSCRIPT" },
    ],

    qa: [
      {
        question: "Most growers in this valley irrigate. You don't. What changed your mind?",
        answer:
          "Honestly, a bad year. 2017. We had everything on drip and we still lost a third of the crop to a heatwave because the canopies were soft and unprepared. The vines that did best that year were the older blocks where we'd already let irrigation lapse. They had deeper roots, smaller berries, and the fruit just held. After that I stopped and never went back. The vines complain for two seasons and then they figure it out.",
      },
      {
        question: "What is the single hardest thing about pinot in this region?",
        answer:
          "Patience. Not in the cellar — pinot in the cellar is actually quite generous if you leave it alone. The patience is in the vineyard. You have to let the vines tell you when to pick, and most years they tell you a week later than the spreadsheet wants. Walking past ripe-looking fruit and not picking it is the hardest thing I do all year.",
      },
      {
        question: "What is a mistake from your early years that you're glad you made?",
        answer:
          "Putting too much new oak on the 2016 reserve. It was the first wine I made entirely on my own and I wanted it to feel important. I oaked the life out of it. We released it anyway — we had to — and people were polite, but it taught me that the wine is allowed to just be itself. I have not bought a new barrel since 2019.",
      },
      {
        question: "If someone is visiting the region for the first time, what would you tell them to drink?",
        answer:
          "Riesling. I know that's not what people expect from a pinot maker. But the rieslings coming out of this state right now are unlike anywhere else in the world, and they are still absurdly cheap. Drink as many as you can while no one is looking.",
      },
      {
        question: "What's exciting you about the 2026 vintage?",
        answer:
          "The acid. We picked late, slowly, and the natural acidity is just sitting at this beautiful tense level — it feels like the wines are going to age for fifteen years without trying. I have not been this excited about a vintage since 2018. Ask me again in three years and I will probably have changed my mind, but today, I'm certain.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // 5. Food & Wine Pairings — magazine layout
  // ───────────────────────────────────────────────────────────────────────
  {
    key:      "pairings",
    slug:     "pairings",
    order:    5,
    active:   true,
    href:     "/(tabs)/home/articles/pairings",

    thumbnailImage:   "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&q=80",
    thumbnailKicker:  "AT THE TABLE",
    thumbnailTitle:   "Food & Wine Pairings",
    thumbnailBlurb:   "Local kitchens and cellars on what pours best with what plate.",
    thumbnailCadence: "Monthly",

    layout:       "magazine",
    articleTitle: "What the Cooks Are Pouring",
    publishDate:  "May 2026",
    author:       "Sage Lindholm",
    heroImage:    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1600&q=80",
    lede:
      "We asked four kitchens around the state what they are pouring with the dish that defines their winter menu. The answers were surprising, occasionally contrarian, and made us hungry.",

    sections: [
      { type: "body", paragraphs: [
        "There is a certain kind of conversation that happens when you ask a chef what wine they would pour with their own food. It tends to be slower than the conversation about the food itself, more hesitant, and often more interesting. The dish is the chef's; the wine is a collaboration with whoever sourced the bottle, whoever made it, and whoever is going to drink it. The pairings below are the ones we kept coming back to long after the meals were over.",
      ]},
      { type: "imageGallery", images: [
        { url: "https://images.unsplash.com/photo-1547573854-74d2a71d0826?w=1600&q=80",
          caption: "Lamb shoulder, slow-roasted, plated at Norfolk Inn.",
          alt: "A platter of slow-roasted lamb shoulder on a wooden board" },
      ]},
      { type: "body", paragraphs: [
        "Slow-roasted lamb shoulder · Norfolk Inn, Hobart",
        "Chef Reed Avila has been cooking lamb shoulder the same way for eight years and changing the wine pairing roughly every six months. This winter he is pouring a five-year-old pinot from a single Coal River vineyard. \"The lamb has so much fat and savoury depth — you need a wine with structure, but also with some lift, otherwise it just sits on top of the meat. The bottle we're pouring right now has a really long finish, almost herbal, and it cuts through.\"",
      ]},
      { type: "pullQuote",
        text: "I'd rather pour a bottle that argues with the food than one that just agrees with it.",
        attribution: "— Reed Avila, Norfolk Inn",
      },
      { type: "body", paragraphs: [
        "Smoked trout with horseradish cream · Pier 9, Devonport",
        "Trout from the Tamar, smoked over manuka in the kitchen, plated with a shocking amount of fresh horseradish. Sommelier Jess Park is uncompromising about the pour: bone-dry off-dry riesling with a touch of bottle age. \"The horseradish is the test. It will absolutely flatten a wine that doesn't have enough acid. I want a wine that says hello back when the horseradish hits.\"",
      ]},
      { type: "imageGallery", images: [
        { url: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80",
          caption: "The wine list at Pier 9.",
          alt: "Open wine list on a restaurant table, candle in foreground" },
        { url: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=1200&q=80",
          caption: "Off-dry riesling, with bottle age.",
          alt: "A glass of pale riesling held up to a window" },
      ]},
      { type: "body", paragraphs: [
        "Wood-fired mushrooms on toast · The Stillroom, Launceston",
        "Maybe the most-ordered dish in the state — black trumpet, pine, and oyster mushrooms cooked over apple wood, finished with cultured butter and a heap of black pepper. Co-owner Bea Marrone pours an aged white blend made from old-vine semillon and chardonnay. \"Mushrooms want something that smells like the forest, not like fruit. The wine has this nutty, slightly oxidative thing going that locks in with the mushrooms in a way I don't think a younger wine ever could.\"",
      ]},
      { type: "callout",
        kicker: "FROM THE FIELD",
        text:
          "Three of the four bottles in this piece are available by the glass at the kitchens we visited. Call ahead to confirm — winter pairing menus rotate quickly.",
      },
      { type: "body", paragraphs: [
        "Salt-baked celeriac, brown butter · Glenmorvan, Coles Bay",
        "Chef Olufemi Awe finishes his most photographed dish with a slick of brown butter and a fistful of crisp sage. The wine is a deliberate provocation: a skin-contact pinot gris from a tiny producer he visited on a day off two summers ago. \"It's a weird pairing on paper. But the wine has texture and grip and a little bit of bite, and the celeriac is essentially silk. They balance each other out. Everyone who orders the dish ends up ordering a second glass.\"",
      ]},
    ],
  },
];

// ─── Run ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n📚 Seeding explore_articles collection...\n");

  for (const article of articles) {
    // Use key as the document ID so re-running this script is idempotent.
    // `merge: false` (default) — we write the full doc so removed image URLs
    // actually go away. Edit the relevant block above and re-run.
    await db
      .collection("explore_articles")
      .doc(article.key)
      .set({ ...article, regionId: REGION_ID });
    console.log(
      `✅  ${article.order}. "${article.thumbnailTitle}" (${article.layout})`,
    );
  }

  console.log(
    "\n✅  Done. Edit thumbnailImage / heroImage / section image URLs in this " +
    "file or directly in the Firebase Console, then re-run / restart the app.\n",
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
