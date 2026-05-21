#!/usr/bin/env node
// scripts/rag/ingest.js
// ────────────────────────────────────────────────────────────────────────────────
// Build / update the SipLocal concierge knowledge base.
//
// Walks scripts/rag/content/**.md, chunks each file at paragraph boundaries
// (200–400 words), asks Claude to tag each chunk with metadata, embeds with
// Voyage, and writes:
//   - the embedding + lightweight metadata to Upstash Vector (namespace
//     "knowledge")
//   - the full chunk text + all metadata to Firestore (collection
//     "knowledge_chunks")
//
// Re-runs are safe: chunk IDs are sha256(text), so existing chunks are
// detected up front and skipped entirely — no Claude calls, no Voyage
// calls, no writes.
//
// Chunks where Claude invented a new `type` (outside the closed taxonomy)
// are appended to taxonomy_review.log for human review.
//
// USAGE
//   node --env-file=.env scripts/rag/ingest.js
//   node --env-file=.env scripts/rag/ingest.js --region tasmania  ← regionId tag
//                                                                   (default: tasmania)
//   node --env-file=.env scripts/rag/ingest.js --limit 3       ← cap chunks (debug)
//   node --env-file=.env scripts/rag/ingest.js --delay 500     ← ms between chunks
//   node --env-file=.env scripts/rag/ingest.js --dry-run       ← parse + chunk only,
//                                                                no API calls or writes
//   node --env-file=.env scripts/rag/ingest.js --force         ← re-tag/re-embed even
//                                                                if already ingested
//
// Multi-region note: every chunk gets a `regionId` metadata field on both the
// Upstash vector and the Firestore knowledge_chunks doc. The retrieval code
// (functions/src/concierge/knowledgeRetrieve.ts) filters on regionId — chunks
// without it will silently be excluded. Re-run with --force after upgrading
// from a pre-multi-region build to backfill the metadata onto existing
// chunks.
// ────────────────────────────────────────────────────────────────────────────────

'use strict';

const fs = require('fs');
const path = require('path');

const { chunkMarkdown } = require('./lib/chunker');
const { chunkId, sleep, fmtMs, wordCount } = require('./lib/util');
const { generateMetadata } = require('./lib/metadata');
const { embedDocuments } = require('./lib/voyage-client');
const { upsertVectors } = require('./lib/upstash-client');
const { chunkExists, saveChunk } = require('./lib/firestore-client');

const CONTENT_DIR = path.join(__dirname, 'content');
const TAXONOMY_LOG = path.join(__dirname, 'taxonomy_review.log');

// ─── CLI args ──────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const DELAY_MS = args.delay ?? 250;
const LIMIT = args.limit ?? Infinity;
const DRY_RUN = args.dryRun;
const FORCE = args.force;
const REGION_ID = args.region ?? 'tasmania';

if (!/^[a-z0-9-]+$/.test(REGION_ID)) {
  console.error(`Invalid --region "${REGION_ID}". Expected lowercase kebab-case (e.g. "tasmania", "margaret-river").`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--limit')  out.limit = parseInt(argv[++i], 10);
    else if (a === '--delay')  out.delay = parseInt(argv[++i], 10);
    else if (a === '--region') out.region = String(argv[++i] || '').trim();
  }
  return out;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async function main() {
  const t0 = Date.now();
  console.log(`📚 SipLocal RAG ingestion`);
  console.log(`   content:  ${CONTENT_DIR}`);
  console.log(`   region:   ${REGION_ID}`);
  console.log(`   dry-run:  ${DRY_RUN}`);
  console.log(`   force:    ${FORCE}`);
  console.log(`   delay:    ${DELAY_MS}ms`);

  const mdFiles = walkMarkdown(CONTENT_DIR);
  if (!mdFiles.length) {
    console.log('\nNo .md files found in content/. Drop some prose in there and re-run.');
    return;
  }
  console.log(`\nFound ${mdFiles.length} markdown file(s).`);

  // 1. Chunk every file.
  const allChunks = [];
  for (const file of mdFiles) {
    const rel = path.relative(CONTENT_DIR, file);
    const md = fs.readFileSync(file, 'utf8');
    const chunks = chunkMarkdown(md, { sourcePath: rel });
    const rawBytes = Buffer.byteLength(md, 'utf8');
    const trimmedLen = md.trim().length;
    let note = '';
    if (chunks.length === 0) {
      if (trimmedLen === 0) {
        note = ` ⚠️  empty file (${rawBytes} bytes, all whitespace)`;
      } else {
        note = ` ⚠️  ${trimmedLen} chars of content but 0 chunks — possible chunker bug, please share this file`;
      }
    }
    console.log(`  • ${rel} → ${chunks.length} chunk(s)${note}`);
    for (const c of chunks) {
      allChunks.push({
        id: chunkId(c.text),
        text: c.text,
        sourcePath: c.sourcePath,
        headingPath: c.headingPath,
      });
    }
  }
  console.log(`\nTotal candidate chunks: ${allChunks.length}`);

  if (DRY_RUN) {
    console.log('\n--dry-run — exiting before API calls. First chunk preview:');
    if (allChunks[0]) {
      console.log('─'.repeat(60));
      console.log(allChunks[0].text.slice(0, 400));
      console.log('─'.repeat(60));
      console.log(`(${wordCount(allChunks[0].text)} words, id=${allChunks[0].id})`);
    }
    return;
  }

  // 2. Skip already-ingested chunks (unless --force).
  const toProcess = [];
  if (FORCE) {
    toProcess.push(...allChunks);
  } else {
    for (const c of allChunks) {
      if (await chunkExists(c.id)) {
        process.stdout.write('.');
      } else {
        toProcess.push(c);
      }
      if (toProcess.length >= LIMIT) break;
    }
    console.log(`\n${toProcess.length} new chunk(s) to ingest, ${allChunks.length - toProcess.length} already in Firestore.`);
  }

  if (!toProcess.length) {
    console.log('Nothing to do. ✅');
    return;
  }

  // 3. Process serially with a small delay (rate-limit-friendly).
  let ingested = 0;
  let taxonomyNewCount = 0;
  for (let i = 0; i < toProcess.length && i < LIMIT; i++) {
    const c = toProcess[i];
    const tag = `[${i + 1}/${Math.min(toProcess.length, LIMIT)}]`;
    try {
      // a. Claude tagger
      const meta = await generateMetadata(c.text);

      // b. Voyage embedding (batch of 1 — keeping the pipeline simple)
      const [vector] = await embedDocuments([c.text]);

      // c. Upstash upsert (lightweight metadata only).
      // regionId is the top-level partition key used by the retrieval
      // filter in functions/src/concierge/knowledgeRetrieve.ts. Distinct
      // from `regions`, which is the sub-region tag emitted by the
      // Claude tagger.
      await upsertVectors([{
        id: c.id,
        vector,
        metadata: {
          regionId:    REGION_ID,
          type:        meta.type,
          seasons:     meta.seasons,
          months:      meta.months,
          regions:     meta.regions,
          sentiment:   meta.sentiment,
          taxonomy_new: meta.taxonomy_new,
          sourcePath:  c.sourcePath,
        },
      }]);

      // d. Firestore full record
      await saveChunk({
        id: c.id,
        regionId: REGION_ID,
        text: c.text,
        sourcePath: c.sourcePath,
        headingPath: c.headingPath,
        wordCount: wordCount(c.text),
        ...meta,
      });

      if (meta.taxonomy_new) {
        appendTaxonomyReview(c.id, meta.type, c.text);
        taxonomyNewCount++;
      }

      ingested++;
      console.log(`${tag} ✓ ${c.id}  type=${meta.type}${meta.taxonomy_new ? ' (NEW)' : ''}  regions=[${meta.regions.join(',')}]`);
    } catch (err) {
      console.error(`${tag} ✗ ${c.id}  ${err.message}`);
    }

    if (DELAY_MS > 0 && i < toProcess.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nDone — ingested ${ingested}/${toProcess.length} chunk(s) in ${fmtMs(Date.now() - t0)}.`);
  if (taxonomyNewCount) {
    console.log(`⚠️  ${taxonomyNewCount} chunk(s) used a new type. See ${path.relative(process.cwd(), TAXONOMY_LOG)}.`);
  }
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function walkMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out.sort();
}

function appendTaxonomyReview(id, type, text) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    id,
    type,
    preview: text.replace(/\s+/g, ' ').slice(0, 100),
  }) + '\n';
  fs.appendFileSync(TAXONOMY_LOG, line);
}
