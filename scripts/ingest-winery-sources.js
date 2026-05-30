// scripts/ingest-winery-sources.js
// ─────────────────────────────────────────────────────────────────────────────
// Build the SipLocal `winery_sources` vector index from the cleaned
// per-winery source markdown files in scripts/winery-sources/.
//
// PIPELINE STAGE:
//   1. collect-winery-sources.js  → Generates raw .md per winery via
//                                    Gemini grounded search.
//   2. strip-citations.js         → Removes inline citations + the
//                                    Wines section (handled separately
//                                    by the `wines` namespace).
//   3. ingest-winery-sources.js   ← YOU ARE HERE. Chunks + embeds the
//                                    cleaned files into Upstash so the
//                                    concierge can pull source-grounded
//                                    facts at retrieval time.
//
// WHAT GETS EMBEDDED:
//   Each .md file's prose body is split on top-level `## ` headers.
//   Each remaining section becomes ONE vector. After exclusions:
//
//     ✓ Founding & History
//     ✓ People
//     ✓ Vineyard & Site
//     ✓ Cellar Door Experience
//     ✓ Food & Hospitality
//     ✓ Awards & Recognition
//     ✓ Sustainability & Certifications
//     ✓ Notable / Distinctive
//
//   Skipped:
//     ✗ Visiting Practical Info — Firestore is the source of truth for
//       hours, address, contact, website. The concierge pulls those
//       directly from the wineries collection, not the vector store.
//     ✗ Sources — URL list, not content.
//     ✗ Wines — already handled by the `wines` namespace (per-bottle
//       tasting notes via scripts/rag/ingest-tasting-notes.js).
//       (Should already be removed by strip-citations.js but we filter
//       defensively in case any file still has one.)
//     ✗ Empty / "No reliable information found" sections — no signal.
//     ✗ Sections under ~25 words — likely stub content.
//
// METADATA PER VECTOR:
//   wineryId    — the slug, for hard-filter retrieval (e.g. "give me
//                 Pooley's source chunks")
//   wineryName  — for display in retrieval previews
//   region      — sub-region (e.g. "Coal River Valley"); useful as a
//                 metadata filter for regional queries
//   regionId    — top-level region scope (e.g. "tasmania") — matches
//                 the pattern used by the `knowledge` and `wines`
//                 namespaces so multi-region filtering works
//                 consistently
//   section     — which section the chunk came from (for debugging +
//                 future per-section filtering)
//   sourcePath  — relative path back to the .md file (provenance)
//   text        — the actual chunk prose, stored in metadata so
//                 retrieval doesn't need a separate Firestore hydration
//                 round-trip
//   wordCount   — for audit / debugging
//
// VECTOR ID FORMAT:
//   "<wineryId>__<section-key>"  (e.g. "apogee-tasmania__founding-history")
//   Stable across runs → re-ingesting overwrites cleanly, no duplicate
//   accumulation. The double-underscore separator is unambiguous since
//   slugs use single hyphens internally.
//
// USAGE:
//   # Dry run — show what would be ingested without writing
//   node --env-file=.env scripts/ingest-winery-sources.js --dry-run
//
//   # Full ingest
//   node --env-file=.env scripts/ingest-winery-sources.js
//
//   # Ingest only specific wineries (useful after re-collecting one)
//   node --env-file=.env scripts/ingest-winery-sources.js --slugs apogee-tasmania,pooley
//
//   # Different source dir
//   node --env-file=.env scripts/ingest-winery-sources.js --dir path/to/sources
//
//   # Override regionId (default reads from CONCIERGE_REGION_ID env or "tasmania")
//   node --env-file=.env scripts/ingest-winery-sources.js --region tasmania
//
//   # Skip the post-ingest sanity-check query
//   node --env-file=.env scripts/ingest-winery-sources.js --no-sanity-check
//
// COST:
//   At ~500 vectors × ~250 tokens each = ~125K tokens to embed.
//   Voyage voyage-3-lite is $0.02/MTok → ~$0.003. Trivial.
//   Upstash upserts are free; storage at this scale is free.
//
// IDEMPOTENCY:
//   Upstash upserts are by ID. Re-running this script overwrites
//   existing vectors instead of duplicating them. Safe to run as many
//   times as you like.
//
// NOT IMPLEMENTED HERE (deliberately — separate scope):
//   • Cleanup of stale vectors. If a winery is removed from
//     scripts/winery-sources/ entirely, its old vectors stay in
//     Upstash. Not critical at v1; add a cleanup pass later if it
//     becomes a problem.
//   • Wiring this namespace into the concierge orchestrator. That's
//     the next script after this one.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Index } = require('@upstash/vector');
const { VoyageAIClient } = require('voyageai');

// ─── Config ────────────────────────────────────────────────────────────────────

const NAMESPACE = 'winery_sources';
const EMBED_MODEL = 'voyage-3-lite';
const EMBED_BATCH_SIZE = 64;  // Voyage allows up to 128; 64 is comfortable

// Sections we explicitly DO NOT embed. Anything else in the prose body
// gets embedded as one chunk. Case-insensitive match against the header
// text after the "## ".
const EXCLUDE_SECTIONS = new Set([
  'visiting practical info',
  'sources',
  'wines',  // defensive — strip-citations.js should have removed these
]);

// Skip sections whose content is empty or only the "no info found"
// sentinel from the collector prompt. No semantic value to embed.
const NO_INFO_MARKER = /no reliable information found from public sources/i;

// Sections under this many words are likely stubs ("Open by appointment.")
// — embed them anyway only if you really want, but most of the time
// they don't carry meaningful retrieval signal.
const MIN_WORDS_PER_CHUNK = 25;

// ─── Init ──────────────────────────────────────────────────────────────────────

const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const UPSTASH_URL = process.env.UPSTASH_VECTOR_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_VECTOR_TOKEN;

if (!VOYAGE_KEY) fail('VOYAGE_API_KEY is not set in .env');
if (!UPSTASH_URL) fail('UPSTASH_VECTOR_URL is not set in .env');
if (!UPSTASH_TOKEN) fail('UPSTASH_VECTOR_TOKEN is not set in .env');

const voyage = new VoyageAIClient({ apiKey: VOYAGE_KEY });
const indexRoot = new Index({ url: UPSTASH_URL, token: UPSTASH_TOKEN });
const ns = indexRoot.namespace(NAMESPACE);

// ─── Args ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    dir: path.resolve(__dirname, 'winery-sources'),
    dryRun: false,
    onlySlugs: null,
    regionId: process.env.CONCIERGE_REGION_ID || 'tasmania',
    sanityCheck: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' && argv[i + 1]) out.dir = path.resolve(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--slugs' && argv[i + 1]) out.onlySlugs = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--region' && argv[i + 1]) out.regionId = argv[++i];
    else if (a === '--no-sanity-check') out.sanityCheck = false;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node --env-file=.env scripts/ingest-winery-sources.js [--dir PATH] [--dry-run] [--slugs a,b,c] [--region ID] [--no-sanity-check]');
      process.exit(0);
    }
  }
  return out;
}

// ─── File parsing ──────────────────────────────────────────────────────────────

/**
 * Pull winery metadata + the prose body out of one .md file.
 *
 * The collector script writes a known front-matter header at the top
 * containing winery name, slug, region. We parse those out so we don't
 * need a separate Firestore round-trip during ingestion.
 *
 * Returns { wineryId, wineryName, region, prose } where `prose` is the
 * body content with the metadata header and grounding footer stripped.
 */
function parseSourceFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');

  // Extract winery name from the first `# ` heading.
  const nameMatch = text.match(/^#\s+(.+?)\s*$/m);
  const wineryName = nameMatch ? nameMatch[1].trim() : path.basename(filePath, '.md');

  // Extract slug from the metadata header (e.g. "> Winery slug: `apogee-tasmania`").
  const slugMatch = text.match(/^>\s*Winery slug:\s*`?([a-z0-9-]+)`?\s*$/m);
  const wineryId = slugMatch ? slugMatch[1] : path.basename(filePath, '.md');

  // Region from the front matter (e.g. "> Region: Pipers River"). Optional.
  const regionMatch = text.match(/^>\s*Region:\s*(.+?)\s*$/m);
  const region = regionMatch ? regionMatch[1].trim() : '';

  // Body = between the first `\n---\n` (end of front matter) and the
  // last `\n---\n` (start of grounding footer). Mirrors split logic from
  // strip-citations.js.
  const firstDividerIdx = text.indexOf('\n---\n');
  const afterHeader = firstDividerIdx >= 0 ? text.slice(firstDividerIdx + 5) : text;
  const lastDividerIdx = afterHeader.lastIndexOf('\n---\n');
  const prose = (lastDividerIdx >= 0 && /## Grounding metadata/.test(afterHeader.slice(lastDividerIdx)))
    ? afterHeader.slice(0, lastDividerIdx)
    : afterHeader;

  return { wineryId, wineryName, region, prose };
}

/**
 * Split a prose body on top-level `## ` headers. Returns an array of
 * { name, text } where text is the content under the header (excluding
 * the header line itself).
 */
function splitSections(prose) {
  const lines = prose.split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^## (.+?)\s*$/);
    if (m) {
      if (current) sections.push(current);
      current = { name: m[1].trim(), text: '' };
    } else if (current) {
      current.text += line + '\n';
    }
  }
  if (current) sections.push(current);
  return sections.map(s => ({ ...s, text: s.text.trim() }));
}

function wordCount(s) {
  return s.split(/\s+/).filter(Boolean).length;
}

function sectionKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Build the embedding text. We prefix with winery name + region +
 * section header so Voyage has strong context for cross-winery
 * queries like "who founded the Pipers River sparkling pioneer?"
 * The text-to-embed differs from the text-stored-in-metadata: the
 * stored text is just the prose, so retrieval gives the model clean
 * content without our prefix.
 */
function buildEmbeddingText({ wineryName, region, sectionName, sectionText }) {
  const regionLine = region ? `${wineryName} (${region}, Tasmania)` : wineryName;
  return [
    regionLine,
    `Section: ${sectionName}`,
    '',
    sectionText,
  ].join('\n');
}

// ─── Build candidate records ───────────────────────────────────────────────────

function buildRecordsForFile(filePath, opts) {
  const { wineryId, wineryName, region, prose } = parseSourceFile(filePath);
  const sections = splitSections(prose);

  const records = [];
  const skips = []; // { section, reason } for visibility
  for (const sec of sections) {
    if (EXCLUDE_SECTIONS.has(sec.name.toLowerCase())) {
      skips.push({ section: sec.name, reason: 'excluded-by-name' });
      continue;
    }
    if (!sec.text) {
      skips.push({ section: sec.name, reason: 'empty' });
      continue;
    }
    if (NO_INFO_MARKER.test(sec.text)) {
      skips.push({ section: sec.name, reason: 'no-info-marker' });
      continue;
    }
    const wc = wordCount(sec.text);
    if (wc < MIN_WORDS_PER_CHUNK) {
      skips.push({ section: sec.name, reason: `too-short:${wc}w` });
      continue;
    }
    const key = sectionKey(sec.name);
    const id = `${wineryId}__${key}`;
    records.push({
      id,
      embedText: buildEmbeddingText({
        wineryName,
        region,
        sectionName: sec.name,
        sectionText: sec.text,
      }),
      metadata: {
        wineryId,
        wineryName,
        region,
        regionId: opts.regionId,
        section: sec.name,
        sourcePath: path.relative(process.cwd(), filePath),
        text: sec.text,
        wordCount: wc,
      },
    });
  }
  return { wineryId, wineryName, region, records, skips, totalSections: sections.length };
}

// ─── Embed + upsert ────────────────────────────────────────────────────────────

async function embedBatch(texts) {
  const resp = await voyage.embed({
    input: texts,
    model: EMBED_MODEL,
    inputType: 'document',
  });
  if (!resp || !Array.isArray(resp.data) || resp.data.length !== texts.length) {
    throw new Error(`Voyage returned ${resp?.data?.length ?? 0} embeddings for a batch of ${texts.length}`);
  }
  return resp.data.map(d => d.embedding);
}

async function embedAllRecords(records) {
  let totalTokens = 0;
  for (let i = 0; i < records.length; i += EMBED_BATCH_SIZE) {
    const batch = records.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await embedBatch(batch.map(r => r.embedText));
    for (let j = 0; j < batch.length; j++) batch[j].vector = vectors[j];
    // Voyage doesn't return per-batch token counts in the SDK; approximate
    // for cost reporting. Rough heuristic: 4 chars/token for English.
    const batchChars = batch.reduce((s, r) => s + r.embedText.length, 0);
    totalTokens += Math.ceil(batchChars / 4);
    process.stdout.write(`    embedded ${Math.min(i + EMBED_BATCH_SIZE, records.length)} / ${records.length}\r`);
  }
  process.stdout.write('\n');
  return { totalTokens };
}

async function upsertAllRecords(records) {
  // Upstash accepts a single batch upsert. Split into chunks to stay
  // under the per-request payload cap (Upstash's stated limit is 1MB
  // per request, but small chunks are safer and have visible progress).
  const UPSERT_BATCH = 100;
  let upserted = 0;
  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    const batch = records.slice(i, i + UPSERT_BATCH).map(r => ({
      id: r.id,
      vector: r.vector,
      metadata: r.metadata,
    }));
    await ns.upsert(batch);
    upserted += batch.length;
    process.stdout.write(`    upserted ${upserted} / ${records.length}\r`);
  }
  process.stdout.write('\n');
}

// ─── Sanity check ──────────────────────────────────────────────────────────────

async function sanityCheck(opts) {
  // After ingest, run a couple of canned queries against the new
  // namespace and print top hits. Confirms the data is queryable and
  // that retrieval matches what you'd expect.
  //
  // IMPORTANT — what belongs in vector retrieval vs Firestore:
  //
  // The vector DB answers questions that need PROSE CONTEXT — history,
  // people, distinctive site features, vibe, what makes a place
  // editorially interesting. Examples below.
  //
  // The vector DB does NOT answer questions about structured tags
  // (dog-friendly, biodynamic, organic, walk-ins, restaurant, tours,
  // award-winning, featured) or operational facts (hours, address,
  // phone, website). Those live in Firestore boolean fields on the
  // `wineries` collection and are filtered by the orchestrator's
  // retrieveCandidates step BEFORE any vector query runs. So a query
  // like "which wineries are biodynamic?" would be answered by a
  // Firestore filter on isBiodynamic == true — never by semantic
  // search on prose that happens to mention biodynamics.
  //
  // The sanity queries below deliberately exercise the prose layer
  // only. If you find yourself wanting to add a "what wineries are X"
  // tag-style query here, that's a signal the architecture is being
  // misused — fix the orchestrator filter logic, don't embed the tag.
  const queries = [
    'Who founded Apogee Tasmania?',
    'Which winery uses an unusual trellis system?',
    'Tell me about a multi-generational family winery',
  ];

  console.log('\n🧪 Sanity check — running canned queries against the new namespace:\n');
  for (const q of queries) {
    const embed = await voyage.embed({ input: [q], model: EMBED_MODEL, inputType: 'query' });
    const vector = embed?.data?.[0]?.embedding;
    if (!vector) {
      console.log(`   "${q}" → embed failed`);
      continue;
    }
    const hits = await ns.query({
      vector,
      topK: 3,
      includeMetadata: true,
      filter: `regionId = '${opts.regionId.replace(/'/g, "''")}'`,
    });
    console.log(`   "${q}"`);
    for (const h of hits) {
      const m = h.metadata || {};
      const preview = String(m.text || '').slice(0, 90).replace(/\s+/g, ' ');
      console.log(`     ${h.score.toFixed(3)}  ${m.wineryId}__${sectionKey(m.section || '')}  →  ${preview}…`);
    }
    console.log('');
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(opts.dir)) fail(`Source dir does not exist: ${opts.dir}`);

  let files = fs.readdirSync(opts.dir)
    .filter(f => f.endsWith('.md') && !f.endsWith('.bak'))
    .sort()
    .map(f => path.join(opts.dir, f));

  if (opts.onlySlugs) {
    const want = new Set(opts.onlySlugs);
    files = files.filter(f => want.has(path.basename(f, '.md')));
    if (files.length === 0) fail(`No .md files matched --slugs ${opts.onlySlugs.join(',')}`);
  }

  console.log(`\n🍷 SipLocal — winery-sources ingest`);
  console.log(`   Source dir:  ${opts.dir}`);
  console.log(`   Namespace:   ${NAMESPACE}`);
  console.log(`   Embed model: ${EMBED_MODEL}`);
  console.log(`   Region ID:   ${opts.regionId}`);
  console.log(`   Files:       ${files.length}`);
  console.log(`   Mode:        ${opts.dryRun ? 'DRY RUN' : 'live'}\n`);

  // 1. Parse + chunk every file. Builds the full record list and per-file
  //    skip summary so we can print stats before paying for embeddings.
  console.log('  Parsing source files...');
  const allRecords = [];
  const perFile = [];
  for (const f of files) {
    const r = buildRecordsForFile(f, opts);
    perFile.push(r);
    allRecords.push(...r.records);
  }

  // 2. Print parse summary.
  console.log(`\n📋 Chunk summary across ${files.length} files:`);
  console.log(`   Total chunks to embed:  ${allRecords.length}`);
  const skipCounts = {};
  for (const f of perFile) {
    for (const s of f.skips) {
      const key = s.reason.replace(/:\d+w$/, ':<short>');
      skipCounts[key] = (skipCounts[key] || 0) + 1;
    }
  }
  if (Object.keys(skipCounts).length > 0) {
    console.log(`   Sections skipped:`);
    for (const [reason, count] of Object.entries(skipCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`     ${reason.padEnd(28)} ${count}`);
    }
  }

  // Distribution: chunks per winery — exposes wineries with thin coverage.
  const sorted = perFile.slice().sort((a, b) => a.records.length - b.records.length);
  const thinnest = sorted.slice(0, 5);
  const richest = sorted.slice(-5).reverse();
  console.log(`\n   Chunks per winery — thinnest 5:`);
  for (const f of thinnest) console.log(`     ${f.wineryId.padEnd(36)} ${f.records.length} chunks`);
  console.log(`   Chunks per winery — richest 5:`);
  for (const f of richest) console.log(`     ${f.wineryId.padEnd(36)} ${f.records.length} chunks`);

  // 3. Embed (or dry-run preview).
  if (opts.dryRun) {
    console.log(`\n🧪 DRY RUN — would embed ${allRecords.length} chunks into namespace "${NAMESPACE}".`);
    console.log(`   Estimated Voyage cost: ~$${((allRecords.length * 300 / 4) / 1_000_000 * 0.02).toFixed(4)} (≈ 300 tokens/chunk avg)`);
    console.log(`   Sample records:`);
    console.log(`\n   ─── FIRST record in FULL — exactly what gets embedded + stored ───`);
    {
      const r = allRecords[0];
      console.log(`     id: ${r.id}`);
      console.log(`     metadata.section: ${r.metadata.section}`);
      console.log(`     metadata.wordCount: ${r.metadata.wordCount}`);
      console.log(`     metadata.region: ${r.metadata.region}`);
      console.log(`     metadata.regionId: ${r.metadata.regionId}`);
      console.log(`     metadata.text (FULL — this is what the AI sees at retrieval time):`);
      console.log(`       ${r.metadata.text.replace(/\n/g, '\n       ')}`);
      console.log(`     embedText (FULL — this is what Voyage embeds into the vector):`);
      console.log(`       ${r.embedText.replace(/\n/g, '\n       ')}`);
    }
    if (allRecords.length > 1) {
      console.log(`\n   ─── Next 2 records (truncated preview only) ───`);
      for (const r of allRecords.slice(1, 3)) {
        console.log(`     id: ${r.id}  (section: ${r.metadata.section}, ${r.metadata.wordCount} words)`);
        console.log(`       ${r.metadata.text.slice(0, 200).replace(/\n/g, '\n       ')}…`);
      }
    }
    console.log(`\n   Re-run without --dry-run to actually embed and upsert.\n`);
    return;
  }

  if (allRecords.length === 0) {
    console.log('\n⚠️  No chunks to ingest. Nothing to do.\n');
    return;
  }

  console.log(`\n🧮 Embedding ${allRecords.length} chunks with ${EMBED_MODEL}...`);
  const { totalTokens } = await embedAllRecords(allRecords);
  const estCost = (totalTokens / 1_000_000) * 0.02;
  console.log(`   ~${totalTokens.toLocaleString()} tokens embedded (~$${estCost.toFixed(4)} on Voyage)`);

  console.log(`\n📤 Upserting to Upstash namespace "${NAMESPACE}"...`);
  await upsertAllRecords(allRecords);

  console.log(`\n✅ Ingest complete: ${allRecords.length} vectors in namespace "${NAMESPACE}".`);

  // 4. Optional sanity check — runs a couple of canned queries.
  if (opts.sanityCheck) {
    await sanityCheck(opts);
  }

  console.log('💡 Inspect the new namespace any time:');
  console.log('   node --env-file=.env scripts/inspect-embeddings.js --namespace winery_sources --samples 5\n');
}

// ─── Utility ───────────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
