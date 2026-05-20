// scripts/backfill-region-id.js
// ─────────────────────────────────────────────────────────────────────────────
// Adds `regionId: "tasmania"` to every document in the content collections
// that don't already have one. Pure data migration — no behaviour change.
// Runs once before the app starts depending on the field.
//
// Idempotent: skips any doc that already has a regionId (so it's safe to
// re-run after adding new docs, or after a partial failure).
//
// Usage:
//   node scripts/backfill-region-id.js              # write
//   node scripts/backfill-region-id.js --dry-run    # report counts, no writes
//
// Why a script and not a one-off Firestore console action:
//   • Multiple collections, hundreds of docs each — point-and-click is brittle.
//   • Idempotency: re-running is a no-op once the field is set.
//   • Audit trail: the script lives in git; the migration is reproducible.
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const serviceAccount = require("../service-account-tasmania.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_REGION_ID = "tasmania";

// Every content collection whose docs need a regionId field. Per-user
// collections (users/{uid}/*) are intentionally NOT in this list — saved
// wineries / lists / tastings get region-tagged via a separate, smaller
// migration if/when needed (see plan §6).
const COLLECTIONS = [
  "wineries",
  "premade_trips",
  "pour_articles",
  "explore_articles",
  "knowledge_chunks",
];

// Firestore caps a batch at 500 ops. Stay safely under to leave room for
// any pre-condition writes Firestore may inject under the hood.
const BATCH_SIZE = 400;

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Run ─────────────────────────────────────────────────────────────────────

async function backfillCollection(name) {
  const snap = await db.collection(name).get();
  const total = snap.size;
  const missing = snap.docs.filter((d) => !d.data().regionId);
  const present = total - missing.length;

  console.log(
    `  ${name.padEnd(20)} total=${String(total).padStart(4)}  ` +
      `with-regionId=${String(present).padStart(4)}  ` +
      `to-update=${String(missing.length).padStart(4)}`
  );

  if (DRY_RUN || missing.length === 0) return { total, updated: 0 };

  let updated = 0;
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const slice = missing.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const doc of slice) {
      batch.update(doc.ref, { regionId: DEFAULT_REGION_ID });
    }
    await batch.commit();
    updated += slice.length;
    console.log(
      `    ${name}: committed ${updated}/${missing.length}`
    );
  }
  return { total, updated };
}

async function run() {
  console.log(`\n🌿  Backfilling regionId=${DEFAULT_REGION_ID}`);
  console.log(
    `Mode: ${DRY_RUN ? "DRY-RUN (no writes)" : "WRITE"}\n`
  );

  const results = [];
  for (const name of COLLECTIONS) {
    const result = await backfillCollection(name);
    results.push({ name, ...result });
  }

  console.log("\nSummary:");
  for (const r of results) {
    console.log(
      `  ${r.name.padEnd(20)} total=${String(r.total).padStart(4)}  updated=${String(r.updated).padStart(4)}`
    );
  }

  if (DRY_RUN) {
    console.log(
      "\nDry-run complete. Re-run without --dry-run to apply."
    );
  } else {
    console.log("\n✅  Done.");
  }
  process.exit(0);
}

run().catch((err) => {
  console.error("\n❌  Backfill failed:", err);
  process.exit(1);
});
