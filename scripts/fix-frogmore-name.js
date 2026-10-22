// scripts/fix-frogmore-name.js
// ─────────────────────────────────────────────────────────────────────────────
// One-off: correct the DISPLAY name of the Frogmore Creek winery.
//
//   "Frogmore Creek Cellar Door and Restaurant"  →  "Frogmore Creek"
//
// This only touches the `name` field on the winery document — the field the app
// reads for every on-screen title (home hero, wineries list, detail header,
// concierge cards, trips). It does NOT change the document ID / `slug`, which is
// an internal identifier referenced by other collections (wines.wineryId,
// events.winerySlug, premade_trips.wineryIds[]) and user saved-lists. Renaming
// the slug is a separate migration — see notes at the bottom.
//
// Safe by design: it locates the doc, prints before/after, and refuses to run
// if it can't find exactly one match. Pass --apply to actually write; without
// it the script is a dry run.
//
// Usage:
//   node scripts/fix-frogmore-name.js          # dry run (shows what it would do)
//   node scripts/fix-frogmore-name.js --apply   # performs the update
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const NEW_NAME = "Frogmore Creek";
const APPLY = process.argv.includes("--apply");

async function main() {
  const snapshot = await db.collection("wineries").get();

  // Match the Frogmore Creek doc by id or current name. We deliberately match
  // broadly, then require exactly one hit before writing.
  const matches = snapshot.docs.filter(
    (d) => /frogmore/i.test(d.id) || /frogmore/i.test(d.data().name || "")
  );

  if (matches.length === 0) {
    console.error("✗ No Frogmore winery found — nothing changed.");
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(
      `✗ Found ${matches.length} possible matches — aborting to be safe:`
    );
    matches.forEach((d) =>
      console.error(`   docId=${d.id}  name=${JSON.stringify(d.data().name)}`)
    );
    process.exit(1);
  }

  const doc = matches[0];
  const current = doc.data().name;

  console.log(`Document ID (slug): ${doc.id}`);
  console.log(`Current name:       ${JSON.stringify(current)}`);
  console.log(`New name:           ${JSON.stringify(NEW_NAME)}`);

  if (current === NEW_NAME) {
    console.log("\n✓ Name is already correct — nothing to do.");
    process.exit(0);
  }

  if (!APPLY) {
    console.log("\n(dry run) Re-run with --apply to write this change.");
    process.exit(0);
  }

  await doc.ref.update({ name: NEW_NAME });
  console.log("\n✓ Updated. The app will show the new name on next data load.");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERR", err.message);
  process.exit(1);
});

// ── If you DO want to clean up the slug too ──────────────────────────────────
// The slug is the document ID, so it can't be renamed in place. A migration
// would need to, in a single batch/transaction:
//   1. Create a new doc `frogmore-creek` copying all fields, with slug:"frogmore-creek"
//   2. Re-point  wines    where wineryId   == old slug  → new slug
//   3. Re-point  events   where winerySlug == old slug  → new slug
//   4. Update    premade_trips.wineryIds[] arrays containing the old slug
//   5. Migrate   users/{uid}/savedWineries/{oldSlug} for every affected user
//   6. Delete the old winery doc
//   7. Re-ingest the concierge Upstash vectors that carry the old slug/name
// This touches user data and the concierge index, so it's higher risk. Ask and
// I'll write it as a separate, reversible migration script.
