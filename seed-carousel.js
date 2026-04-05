const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const slides = [
  {
    order: 1,
    active: true,
    title: "Explore Margaret River",
    description: "Discover 91 cellar doors across one of Australia's finest wine regions.",
    imageUrl: "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=800",
    linkTo: "/wineries",
  },
  {
    order: 2,
    active: true,
    title: "Upcoming Events",
    description: "Wine festivals, live music, and exclusive tasting experiences.",
    imageUrl: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800",
    linkTo: "/events",
  },
  {
    order: 3,
    active: true,
    title: "Cellar Door Specials",
    description: "Limited-time offers from your favourite Margaret River producers.",
    imageUrl: "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=800",
    linkTo: "/specials",
  },
  {
    order: 4,
    active: true,
    title: "Find Your Cellar Door",
    description: "Use our map to discover wineries near you.",
    imageUrl: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800",
    linkTo: "/wineries",
  },
];

async function run() {
  console.log("\n🍷 Seeding homepage_carousel collection...\n");
  for (const slide of slides) {
    await db.collection("homepage_carousel").add(slide);
    console.log(`✅ Added: "${slide.title}"`);
  }
  console.log("\n✅ Done! Update imageUrl values in Firebase Console anytime.\n");
}

run().catch(console.error);