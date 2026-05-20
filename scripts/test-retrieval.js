// scripts/test-retrieval.js
// ────────────────────────────────────────────────────────────────────────────────
// Smoke-test the live Upstash Vector index with a handful of representative
// queries. No Firestore or LLM involved — just embed → query → print.
//
// Use this to sanity-check that semantic retrieval is producing sensible
// rankings BEFORE wiring it into the concierge. If results look weird here
// (wrong winery, missing obvious matches), that's a signal to revisit the
// embedding text in scripts/embed-wineries.js or to upgrade the embedding
// model.
//
// USAGE:
//   node --env-file=.env scripts/test-retrieval.js
//   node --env-file=.env scripts/test-retrieval.js "your custom query"
//
//   With hard filters (mirrors what the Haiku router will pass at runtime):
//   node --env-file=.env scripts/test-retrieval.js --require biodynamic "pinot with a view"
//   node --env-file=.env scripts/test-retrieval.js --region "Coal River Valley" "great lunch spot"
//   node --env-file=.env scripts/test-retrieval.js --require dogFriendly,hasRestaurant "long lunch with the dog"
//
// FLAGS (must come BEFORE the query string):
//   --require <tag1,tag2>   Comma-separated metadata flags that MUST be true.
//                           Allowed: dogFriendly, hasRestaurant, isOrganic,
//                                    isBiodynamic, walkinWelcome, featured.
//                           Bare names like "biodynamic" are accepted too.
//   --region "<name>"       Restrict to a single region (case-sensitive,
//                           matches `region` field exactly).
//
// REQUIREMENTS (in .env): same three keys the indexer uses.
// ────────────────────────────────────────────────────────────────────────────────

'use strict';

const { VoyageAIClient } = require('voyageai');
const { Index } = require('@upstash/vector');

// ─── Init ──────────────────────────────────────────────────────────────────────

const VOYAGE_KEY    = process.env.VOYAGE_API_KEY;
const UPSTASH_URL   = process.env.UPSTASH_VECTOR_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_VECTOR_TOKEN;

if (!VOYAGE_KEY)    fail('VOYAGE_API_KEY is not set');
if (!UPSTASH_URL)   fail('UPSTASH_VECTOR_URL is not set');
if (!UPSTASH_TOKEN) fail('UPSTASH_VECTOR_TOKEN is not set');

const voyage = new VoyageAIClient({ apiKey: VOYAGE_KEY });
const index = new Index({ url: UPSTASH_URL, token: UPSTASH_TOKEN });

const TOP_K = 5;

// A spread of representative concierge queries. Each is annotated with what
// "good" looks like, so when you eyeball results you know whether retrieval
// is doing its job.

const QUERIES = [
  {
    q: 'biodynamic pinot with a view',
    note: 'fuzzy / semantic — should surface biodynamic + pinot producers, scenery a plus',
  },
  {
    q: 'where can I take my dog?',
    note: 'feature — should surface dog-friendly cellar doors',
  },
  {
    q: 'best place for lunch in Coal River Valley',
    note: 'region + restaurant — Coal River Valley wineries with on-site food',
  },
  {
    q: 'sparkling wine specialist',
    note: 'varietal expertise — should surface Pipers River / Tamar Valley sparkling houses',
  },
  {
    q: 'small family-run cellar door, no pretense',
    note: 'vibe — should surface boutique / lower-key producers',
  },
];

// ─── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const { customQuery, requireTags, region } = parseArgs(process.argv.slice(2));

  const queries = customQuery
    ? [{ q: customQuery, note: '(custom query from CLI)' }]
    : QUERIES;

  const filterStr = buildFilter({ requireTags, region });

  console.log(`\n🔎 Testing retrieval against ${queries.length} ${queries.length === 1 ? 'query' : 'queries'} (top ${TOP_K} each)`);
  if (filterStr) console.log(`   Hard filter: ${filterStr}`);
  console.log('');

  for (const { q, note } of queries) {
    console.log(`\n──────────────────────────────────────────────────────────────────`);
    console.log(`Query: "${q}"`);
    console.log(`Goal:  ${note}`);
    console.log(`──────────────────────────────────────────────────────────────────`);

    // Embed the query (inputType: 'query', not 'document').
    const embed = await voyage.embed({
      input:     [q],
      model:     'voyage-3-lite',
      inputType: 'query',
    });
    const vector = embed?.data?.[0]?.embedding;
    if (!vector) { console.log('  (no embedding returned)'); continue; }

    const results = await index.query({
      vector,
      topK: TOP_K,
      includeMetadata: true,
      ...(filterStr ? { filter: filterStr } : {}),
    });

    if (!results || results.length === 0) {
      console.log('  (no hits)');
      continue;
    }

    for (const r of results) {
      const m = r.metadata || {};
      const tags = [
        m.dogFriendly   && 'dog',
        m.hasRestaurant && 'restaurant',
        m.isOrganic     && 'organic',
        m.isBiodynamic  && 'biodynamic',
        m.walkinWelcome && 'walk-ins',
        m.featured      && 'featured',
      ].filter(Boolean).join(', ') || '—';

      const score = typeof r.score === 'number' ? r.score.toFixed(3) : '?';
      console.log(`  ${score}  ${m.name || r.id}`);
      console.log(`         region: ${m.region || '?'}  |  tags: ${tags}`);
    }
  }

  console.log('\n');
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Map bare-name aliases to canonical metadata field names (matches what
// scripts/embed-wineries.js wrote to Upstash).
const TAG_ALIASES = {
  dog:           'dogFriendly',
  'dog-friendly':'dogFriendly',
  dogfriendly:   'dogFriendly',
  restaurant:    'hasRestaurant',
  hasrestaurant: 'hasRestaurant',
  organic:       'isOrganic',
  isorganic:     'isOrganic',
  biodynamic:    'isBiodynamic',
  isbiodynamic:  'isBiodynamic',
  walkins:       'walkinWelcome',
  'walk-ins':    'walkinWelcome',
  walkinwelcome: 'walkinWelcome',
  featured:      'featured',
};

const VALID_TAG_FIELDS = new Set([
  'dogFriendly', 'hasRestaurant', 'isOrganic',
  'isBiodynamic', 'walkinWelcome', 'featured',
]);

function parseArgs(argv) {
  const out = { customQuery: '', requireTags: [], region: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--require') {
      const raw = argv[++i] || '';
      for (const t of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
        const canonical = TAG_ALIASES[t.toLowerCase()] || t;
        if (!VALID_TAG_FIELDS.has(canonical)) {
          fail(`Unknown --require tag "${t}". Allowed: ${[...VALID_TAG_FIELDS].join(', ')} (or aliases like "biodynamic", "dog").`);
        }
        out.requireTags.push(canonical);
      }
    } else if (argv[i] === '--region') {
      out.region = argv[++i] || null;
    } else {
      rest.push(argv[i]);
    }
  }
  out.customQuery = rest.join(' ').trim();
  return out;
}

function buildFilter({ requireTags, region }) {
  const clauses = [];
  if (region) clauses.push(`region = '${String(region).replace(/'/g, "''")}'`);
  for (const tag of requireTags || []) clauses.push(`${tag} = true`);
  return clauses.length ? clauses.join(' AND ') : '';
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

run().catch((err) => {
  console.error('\n❌ Test failed:');
  console.error(err);
  process.exit(1);
});
