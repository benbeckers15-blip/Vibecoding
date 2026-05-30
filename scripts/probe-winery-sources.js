// scripts/probe-winery-sources.js
// ─────────────────────────────────────────────────────────────────────────────
// Standalone diagnostic for the `winery_sources` Upstash namespace.
// Embeds an arbitrary query, hits the namespace directly, prints
// top-N hits with scores and metadata. Use this to answer "why
// didn't <expected chunk> surface for <query>?" questions without
// having to spin up the full orchestrator.
//
// SHOWS:
//   • Top-N raw cosine results (pre-rerank), with score + winery +
//     section + a prose preview
//   • Top-N reranked results (post Voyage rerank), with rerank
//     relevance scores
//
// Comparing the two columns surfaces whether the issue is:
//   • Pre-rerank — the chunk isn't in the cosine pool at all
//   • Rerank-stage — the chunk made it to cosine top-K but the cross-
//     encoder pushed it down
//   • Both — chunk is just plain hard to surface for this query
//
// USAGE:
//   # Quick lookup against the whole namespace
//   node --env-file=.env scripts/probe-winery-sources.js "Who founded Pooley?"
//
//   # Scope to specific wineries (mirrors what the orchestrator does
//   # when the router identifies candidate wineries — useful for
//   # debugging WHY a specific_winery turn missed an expected chunk)
//   node --env-file=.env scripts/probe-winery-sources.js \
//       --wineries tolpuddle-vineyard,pooley-wines,frogmore-creek-cellar-door--restaurant \
//       "What's the vineyard size at Tolpuddle in hectares?"
//
//   # More candidates returned (default 10)
//   node --env-file=.env scripts/probe-winery-sources.js --top 20 "your query"
//
//   # Different namespace (defaults to winery_sources)
//   node --env-file=.env scripts/probe-winery-sources.js --namespace knowledge "..."
//
// NOTE:
//   Read-only — does NOT modify the namespace. Safe to run as many
//   times as you like. Cost: one Voyage embed (~$0.00001) + one
//   Voyage rerank (~$0.00007) + one Upstash query. Less than a cent
//   for typical use.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { Index } = require('@upstash/vector');
const { VoyageAIClient } = require('voyageai');

// ─── Config ────────────────────────────────────────────────────────────────────

const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const UPSTASH_URL = process.env.UPSTASH_VECTOR_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_VECTOR_TOKEN;

if (!VOYAGE_KEY) fail('VOYAGE_API_KEY is not set in .env');
if (!UPSTASH_URL) fail('UPSTASH_VECTOR_URL is not set in .env');
if (!UPSTASH_TOKEN) fail('UPSTASH_VECTOR_TOKEN is not set in .env');

const voyage = new VoyageAIClient({ apiKey: VOYAGE_KEY });
const indexRoot = new Index({ url: UPSTASH_URL, token: UPSTASH_TOKEN });

// ─── Args ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    query: null,
    namespace: 'winery_sources',
    wineries: null,
    regionId: process.env.CONCIERGE_REGION_ID || 'tasmania',
    top: 10,
    rerankModel: 'rerank-lite-1',
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--namespace' && argv[i + 1]) out.namespace = argv[++i];
    else if (a === '--wineries' && argv[i + 1]) out.wineries = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--region' && argv[i + 1]) out.regionId = argv[++i];
    else if (a === '--top' && argv[i + 1]) out.top = parseInt(argv[++i], 10);
    else if (a === '--rerank-model' && argv[i + 1]) out.rerankModel = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node --env-file=.env scripts/probe-winery-sources.js "your query" [--wineries a,b,c] [--top N] [--namespace NAME] [--region ID]');
      process.exit(0);
    } else if (!a.startsWith('--')) {
      positional.push(a);
    }
  }
  out.query = positional.join(' ');
  if (!out.query) {
    console.error('Usage: node --env-file=.env scripts/probe-winery-sources.js "your query"');
    process.exit(1);
  }
  return out;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildFilter(opts) {
  const clauses = [];
  clauses.push(`regionId = '${opts.regionId.replace(/'/g, "''")}'`);
  if (opts.wineries && opts.wineries.length > 0) {
    const list = opts.wineries.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
    clauses.push(`wineryId IN (${list})`);
  }
  return clauses.join(' AND ');
}

function preview(text, max = 180) {
  if (!text) return '';
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1) + '…';
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const ns = indexRoot.namespace(opts.namespace);
  const filter = buildFilter(opts);

  console.log(`\n🔬 winery_sources retrieval probe`);
  console.log(`   Query:      "${opts.query}"`);
  console.log(`   Namespace:  ${opts.namespace}`);
  console.log(`   Filter:     ${filter}`);
  console.log(`   Top N:      ${opts.top} (cosine) → rerank to ${opts.top}\n`);

  // 1. Embed the query (inputType: 'query' to match the document-side
  //    embeddings the ingest script wrote)
  const embedResp = await voyage.embed({
    input: [opts.query],
    model: 'voyage-3-lite',
    inputType: 'query',
  });
  const vector = embedResp?.data?.[0]?.embedding;
  if (!vector) fail('Voyage returned no embedding');

  // 2. Pull top-N raw cosine hits — this is the candidate pool the
  //    orchestrator's reranker normally works on. We fetch the same
  //    width the orchestrator does (15) by default but show whatever
  //    --top requests.
  const fetchK = Math.max(opts.top, 15);
  const cosineHits = await ns.query({
    vector,
    topK: fetchK,
    includeMetadata: true,
    filter,
  });

  console.log(`📊 RAW COSINE RESULTS (top ${cosineHits.length}):`);
  console.log(`─────────────────────────────────────────────────────────────────`);
  if (cosineHits.length === 0) {
    console.log('   (no hits — filter may be excluding everything; check --wineries/--region)\n');
    return;
  }
  cosineHits.forEach((h, i) => {
    const m = h.metadata || {};
    console.log(`   ${String(i + 1).padStart(2)}. score ${h.score.toFixed(3)}  ${m.wineryId}__${slugify(m.section || '')}`);
    console.log(`       ${m.wineryName} / ${m.section}`);
    console.log(`       ${preview(m.text)}\n`);
  });

  // 3. Run Voyage rerank on the cosine results and show the new ordering.
  //    This is exactly what the orchestrator does (see rerank.ts).
  if (cosineHits.length === 0) return;
  const documents = cosineHits.map(h => {
    const m = h.metadata || {};
    // Mirror the ingest-time embedding-text shape so rerank sees what
    // the orchestrator sees.
    return `${m.wineryName || ''} (${m.region || ''}) — ${m.section || ''}\n${m.text || ''}`;
  });
  const rerankResp = await voyage.rerank({
    query: opts.query,
    documents,
    model: opts.rerankModel,
    topK: opts.top,
  });

  console.log(`📊 RERANKED RESULTS (top ${opts.top}):`);
  console.log(`─────────────────────────────────────────────────────────────────`);
  const rerankData = rerankResp?.data || [];
  if (rerankData.length === 0) {
    console.log('   (rerank returned no data — falling back to cosine ordering)\n');
    return;
  }
  rerankData.forEach((entry, i) => {
    const origIdx = entry.index;
    const h = cosineHits[origIdx];
    if (!h) return;
    const m = h.metadata || {};
    const rerankScore = entry.relevanceScore ?? entry.relevance_score ?? 0;
    const moved = origIdx === i ? '' : (origIdx > i ? `  ⬆ from #${origIdx + 1}` : `  ⬇ from #${origIdx + 1}`);
    console.log(`   ${String(i + 1).padStart(2)}. rerank ${rerankScore.toFixed(3)}  (cosine ${h.score.toFixed(3)})${moved}`);
    console.log(`       ${m.wineryId}__${slugify(m.section || '')}`);
    console.log(`       ${m.wineryName} / ${m.section}`);
    console.log(`       ${preview(m.text)}\n`);
  });

  console.log(`💡 The orchestrator in production fetches top-15 from cosine,`);
  console.log(`   reranks to top-5 (specific_winery) or top-4 (other intents),`);
  console.log(`   then applies a per-winery diversity cap.\n`);
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
