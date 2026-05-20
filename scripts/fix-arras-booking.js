// fix-arras-booking.js
// ────────────────────────────────────────────────────────────────────────────────
// One-shot patch for House of Arras: set `bookingUrl` on the
// `house-of-arras` Firestore doc so the wineries list CTA flips from
// "CALL TO BOOK" → tel: to "BOOK ONLINE" → bookingUrl.
//
// Background
// ──────────
// Arras's cellar door requires bookings, so `walkinWelcome` is false in
// Firestore. The list-screen CTA logic in `app/(tabs)/wineries/index.tsx`
// used to surface a phone CTA in that case, but Arras takes its
// bookings through its website rather than by phone — so the dialer
// was the wrong channel. The CTA now branches on a new optional
// `bookingUrl` field; this script populates that field for Arras.
//
// What it does
// ────────────
// 1. Reads the `house-of-arras` doc.
// 2. If `bookingUrl` is already set, prints it and exits (idempotent).
// 3. Otherwise, picks the booking URL:
//      • $BOOKING_URL env var if set (explicit override — use this if
//        Arras has a dedicated booking page distinct from its
//        marketing site).
//      • Otherwise the doc's existing `website` field.
// 4. Writes `bookingUrl` to the doc.
//
// USAGE
//   node scripts/fix-arras-booking.js
//   BOOKING_URL=https://www.houseofarras.com.au/cellar-door \
//     node scripts/fix-arras-booking.js
//
// To roll back: delete the `bookingUrl` field on the Arras doc in the
// Firebase Console (or run a tiny FieldValue.delete() script). The CTA
// falls back to phone behaviour automatically when the field is
// missing.
// ────────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const DOC_ID = "house-of-arras";

async function run() {
  const ref = db.collection("wineries").doc(DOC_ID);
  const snap = await ref.get();

  if (!snap.exists) {
    console.error(`❌ No winery doc with id "${DOC_ID}" — bailing.`);
    process.exit(1);
  }

  const data = snap.data();
  const name = data.name || DOC_ID;

  // Idempotent: don't clobber an existing bookingUrl. If you actually
  // want to update it, either delete the field in the console first or
  // pass a new BOOKING_URL and edit this branch to allow overwrite.
  if (typeof data.bookingUrl === "string" && data.bookingUrl.trim().length > 0) {
    console.log(`✓  ${name} already has bookingUrl: ${data.bookingUrl}`);
    console.log("   Nothing to do. Exiting.");
    return;
  }

  // Pick the URL: explicit env var override wins, otherwise reuse the
  // marketing website (which is the channel the user wants in the
  // common case — "Arras's bookings come through its website").
  const override = (process.env.BOOKING_URL || "").trim();
  const fromDoc = typeof data.website === "string" ? data.website.trim() : "";
  const bookingUrl = override || fromDoc;

  if (!bookingUrl) {
    console.error(
      `❌ ${name} has no website and no BOOKING_URL was provided.\n` +
        `   Set BOOKING_URL=<full URL> and re-run.`
    );
    process.exit(1);
  }

  console.log(`\n🍾 Patching ${name}`);
  console.log(`   Source:     ${override ? "BOOKING_URL env var" : "existing `website` field"}`);
  console.log(`   bookingUrl: ${bookingUrl}\n`);

  await ref.update({ bookingUrl });

  console.log(`✅ Done. The "BOOK ONLINE" CTA will now appear on Arras's card.`);
  console.log(`   (Existing Firestore cache may need a sec to revalidate on device.)`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Update failed:", err);
    process.exit(1);
  });
