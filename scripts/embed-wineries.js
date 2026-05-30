// scripts/embed-wineries.js
// ────────────────────────────────────────────────────────────────────────────────
// Build a semantic-search index over the SipLocal winery corpus.
//
// One-shot, idempotent. Re-run any time wineries are added, removed, or have
// their description / region / tags changed. Upserts overwrite by id, so
// running this twice is a no-op (just costs a few cents in embedding tokens).
//
// FLOW:
//   1. Pull every doc from the `wineries` collection in Tasmania Firestore.
//   2. For each winery, build a natural-language "embedding text" — the
//      string we want a user query to match against. Rich and prose-y, not
//      the compact pipe format the LLM consumes. Embedding models score
//      readable sentences far better than key:value lines.
//   3. Batch-embed via Voyage (`voyage-3-lite`, 512 dims, ~$0.02/1M tokens).
//   4. Upsert vectors to Upstash Vector with the small subset of metadata we
//      need to apply hard post-filters at query time (region, tag flags).
//
// USAGE:
//   node --env-file=.env scripts/embed-wineries.js
//   node --env-file=.env scripts/embed-wineries.js --limit 5     ← test on a slice
//   node --env-file=.env scripts/embed-wineries.js --dry-run     ← embed but don't upsert
//
// REQUIREMENTS (in .env):
//   - VOYAGE_API_KEY
//   - UPSTASH_VECTOR_URL
//   - UPSTASH_VECTOR_TOKEN
//   - service-account-tasmania.json must be at the project root
// ────────────────────────────────────────────────────────────────────────────────

'use strict';

const admin = require('firebase-admin');
const { VoyageAIClient } = require('voyageai');
const { Index } = require('@upstash/vector');

// ─── Init ──────────────────────────────────────────────────────────────────────

const serviceAccount = require('../service-account-tasmania.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const VOYAGE_KEY    = process.env.VOYAGE_API_KEY;
const UPSTASH_URL   = process.env.UPSTASH_VECTOR_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_VECTOR_TOKEN;

if (!VOYAGE_KEY)    fail('VOYAGE_API_KEY is not set');
if (!UPSTASH_URL)   fail('UPSTASH_VECTOR_URL is not set');
if (!UPSTASH_TOKEN) fail('UPSTASH_VECTOR_TOKEN is not set');

const voyage  = new VoyageAIClient({ apiKey: VOYAGE_KEY });
const vectorIndex = new Index({ url: UPSTASH_URL, token: UPSTASH_TOKEN });

// ─── Config ────────────────────────────────────────────────────────────────────

const EMBED_MODEL  = 'voyage-3-lite';   // 512 dims (Matryoshka), cheap, plenty good for ~73 docs.
                                        // Matches the Upstash index dimension — switching to voyage-3
                                        // (1024 dims) would require recreating the index from scratch.
const BATCH_SIZE   = 64;                // Voyage allows up to 128; 64 is a comfortable fit
const ARGS         = parseArgs(process.argv.slice(2));

// ─── Embedding-text builder ────────────────────────────────────────────────────
// Rich natural-language string. The goal is to maximise the chance that a
// user query like "biodynamic pinot with a view" surfaces the right winery,
// so we want the human-readable signals (region, vibe, tasting notes,
// editorial blurb) all present in the embedded text.
//
// We deliberately do NOT include hours, coords, phone, or website — those
// are detail fields. They never come up in semantic queries; they're only
// needed once we've already retrieved the right winery.

function buildEmbeddingText(w) {
  const lines = [];

  if (w.name)   lines.push(`Winery: ${w.name}`);
  if (w.region) lines.push(`Region: ${w.region} (Tasmania, Australia)`);

  const tagWords = [];
  if (w.dogFriendly)    tagWords.push('dog-friendly');
  if (w.hasRestaurant)  tagWords.push('restaurant on site');
  if (w.isOrganic)      tagWords.push('organic');
  if (w.isBiodynamic)   tagWords.push('biodynamic');
  if (w.walkinWelcome)  tagWords.push('walk-ins welcome');
  if (w.featured)       tagWords.push('SipLocal featured');
  if (tagWords.length)  lines.push(`Notable for: ${tagWords.join(', ')}`);

  if (typeof w.rating === 'number') lines.push(`Rating: ${w.rating.toFixed(1)} / 5`);

  // Description is sometimes string[], sometimes string. Join paragraphs.
  let body = '';
  if (Array.isArray(w.description))      body = w.description.join('\n\n');
  else if (typeof w.description === 'string') body = w.description;
  if (body) lines.push(`About: ${body}`);

  if (w.pullQuote) lines.push(`Quote: "${w.pullQuote}"`);

  return lines.join('\n');
}

// ─── Metadata extractor ────────────────────────────────────────────────────────
// What we stash on the vector record so we can post-filter at query time
// without a Firestore round-trip. Keep this minimal — we still hold the full
// winery list in memory in the app, so the vector metadata only needs to
// support hard filters (region, tag flags) and quick debugging.

function buildMetadata(w) {
  return {
    name:           w.name || '',
    slug:           w.slug || w.id,
    region:         w.region || '',
    rating:         typeof w.rating === 'number' ? w.rating : null,
    dogFriendly:    !!w.dogFriendly,
    hasRestaurant:  !!w.hasRestaurant,
    isOrganic:      !!w.isOrganic,
    isBiodynamic:   !!w.isBiodynamic,
    walkinWelcome:  !!w.walkinWelcome,
    featured:       !!w.featured,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n🍷 SipLocal — embedding wineries to Upstash Vector\n');

  // 1. Fetch corpus.
  const snap = await db.collection('wineries').get();
  let wineries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`  → loaded ${wineries.length} wineries from Firestore`);

  if (ARGS.limit) {
    wineries = wineries.slice(0, ARGS.limit);
    console.log(`  → limited to first ${wineries.length} (--limit)`);
  }

  // 2. Build embedding texts. We do this synchronously so we can preview
  //    what we're about to embed before paying for it.
  const records = wineries.map((w) => ({
    id:       w.slug || w.id,
    text:     buildEmbeddingText(w),
    metadata: buildMetadata(w),
  }));

  // 3. Embed in batches.
  console.log(`\n  → embedding with ${EMBED_MODEL} in batches of ${BATCH_SIZE}...`);
  const vectors = [];
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const resp = await voyage.embed({
      input:     batch.map((r) => r.text),
      model:     EMBED_MODEL,
      inputType: 'document',
    });
    if (!resp || !Array.isArray(resp.data) || resp.data.length !== batch.length) {
      fail(`Voyage returned ${resp?.data?.length ?? 0} embeddings for a batch of ${batch.length}`);
    }
    for (let j = 0; j < batch.length; j++) {
      vectors.push({
        id:       batch[j].id,
        vector:   resp.data[j].embedding,
        metadata: batch[j].metadata,
      });
    }
    console.log(`    ✓ ${Math.min(i + BATCH_SIZE, records.length)} / ${records.length}`);
  }

  // 4. Upsert.
  if (ARGS.dryRun) {
    console.log('\n  → --dry-run set, skipping upsert.');
    console.log('\n  ─── First record: text that was embedded ───\n');
    console.log(records[0].text);
    console.log('\n  ─── First record: what would be upserted ───\n');
    console.log(JSON.stringify({ ...vectors[0], vector: `<${vectors[0].vector.length}-dim>` }, null, 2));
    return;
  }

  console.log('\n  → upserting to Upstash Vector...');
  // Upstash accepts a batch upsert in a single call.
  await vectorIndex.upsert(vectors);
  console.log(`    ✓ upserted ${vectors.length} vectors`);

  console.log('\n✅ Done.\n');
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { limit: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') out.limit = parseInt(argv[++i], 10);
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

run().catch((err) => {
  console.error('\n❌ Indexer failed:');
  console.error(err);
  process.exit(1);
});
