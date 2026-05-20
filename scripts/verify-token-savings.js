// scripts/verify-token-savings.js
// ────────────────────────────────────────────────────────────────────────────────
// Quantify the token-cost delta from removing the cached "world index" block
// in the concierge.
//
// Asks Anthropic's count-tokens API to count tokens for:
//   A) OLD cached system block: buildSystemPrompt() + renderWorldIndex()
//   B) NEW cached system block: buildSystemPrompt() only
//
// Projects per-turn and per-month savings at Haiku and Sonnet cached-read
// rates (May 2026 prices).
//
// The buildSystemPrompt() and renderWorldIndex() implementations are
// re-imported from the TS sources by reading them as text and pulling out
// the string constants — no transpiler required. If you change the TS
// source significantly, mirror the changes here.
//
// USAGE:
//   node --env-file=.env scripts/verify-token-savings.js
// ────────────────────────────────────────────────────────────────────────────────

'use strict';

const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');

// ─── Init ──────────────────────────────────────────────────────────────────────

const serviceAccount = require('../service-account-tasmania.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const ANTHROPIC_KEY =
  process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) {
  console.error('❌ ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) is not set');
  process.exit(1);
}
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ─── Replicas of the TS string-builders ────────────────────────────────────────
// Mirrors services/concierge/buildContext.ts compactIndexEntry / renderWorldIndex.
// These are pure string functions — kept in sync by hand, not at runtime.

function tagsOf(w) {
  const t = [];
  if (w.dogFriendly)   t.push('dog-friendly');
  if (w.hasRestaurant) t.push('restaurant');
  if (w.isOrganic)     t.push('organic');
  if (w.isBiodynamic)  t.push('biodynamic');
  if (w.walkinWelcome) t.push('walk-ins');
  if (w.featured)      t.push('featured');
  return t;
}

function compactIndexEntry(w) {
  const fields = [];
  fields.push(`id:${w.slug || w.id}`);
  fields.push(`name:${w.name || '(unnamed)'}`);
  if (w.region) fields.push(`r:${w.region}`);
  if (typeof w.rating === 'number') fields.push(`★${w.rating.toFixed(1)}`);
  const t = tagsOf(w);
  if (t.length) fields.push(`t:${t.join(',')}`);
  return fields.join(' | ');
}

function renderWorldIndex(wineries) {
  if (!wineries.length) return '';
  const sorted = [...wineries].sort((a, b) => {
    const ra = a.region || '~';
    const rb = b.region || '~';
    if (ra !== rb) return ra.localeCompare(rb);
    return (a.name || '').localeCompare(b.name || '');
  });
  return [
    '## Complete winery index',
    '',
    'Every winery in the SipLocal corpus is listed below in compact form.',
    "Use this index to confirm a winery's existence, its region, and its",
    'basic tags. For HOURS, full DESCRIPTIONS, COORDS and other detail',
    "fields, you must rely on the per-turn 'Detail slice' that arrives in",
    'a separate user message — those fields are NOT in this index.',
    '',
    'Row format: id | name | r:region | ★rating | t:tag1,tag2',
    '',
    ...sorted.map(compactIndexEntry),
    '',
    `Total: ${wineries.length} wineries indexed.`,
  ].join('\n');
}

// ─── System-prompt extractor ───────────────────────────────────────────────────
// Pull buildSystemPrompt()'s output by reading the TS source and concatenating
// its template literals. We do this rather than reimplement to avoid drift.

const fs = require('fs');
const path = require('path');

function buildSystemPromptFromSource() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'concierge', 'systemPrompt.ts'),
    'utf8'
  );

  // Each top-level constant is `const NAME = \`...\`;` — extract the
  // template-literal body. We're matching against the file we control,
  // so the regex doesn't need to be bulletproof.
  const constants = [
    'BRAND_VOICE', 'TASK_AND_SCOPE', 'HARD_RULES', 'HOURS_RULE',
    'STYLE_NOTES', 'LENGTH_DISCIPLINE', 'FEW_SHOT', 'HOURS_FEW_SHOT',
    'REGIONAL_PRIMER', 'DATASET_FORMAT',
  ];

  const parts = [];
  for (const name of constants) {
    const re = new RegExp(`const\\s+${name}\\s*=\\s*\`([\\s\\S]*?)\`;`);
    const m = src.match(re);
    if (!m) {
      console.error(`❌ couldn't extract ${name} from systemPrompt.ts`);
      process.exit(1);
    }
    parts.push(m[1]);
  }
  return parts.join('\n\n');
}

// ─── Token counting via Anthropic ──────────────────────────────────────────────

async function countTokens(model, text) {
  const resp = await client.messages.countTokens({
    model,
    system: text,
    messages: [{ role: 'user', content: 'hi' }],
  });
  return resp.input_tokens;
}

// ─── Pricing (May 2026, USD per 1M tokens) ────────────────────────────────────
// Update these if Anthropic adjusts pricing.

const PRICING = {
  'claude-haiku-4-5': {
    input:        1.0,    // full input rate
    cachedRead:   0.10,   // 90% off for cached reads
    cacheCreate:  1.25,   // 25% premium on first write to cache
  },
  'claude-sonnet-4-6': {
    input:        3.0,
    cachedRead:   0.30,
    cacheCreate:  3.75,
  },
};

// ─── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n📏 SipLocal — measuring concierge token-cost delta\n');

  // 1. Load corpus.
  const snap = await db.collection('wineries').get();
  const wineries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`  → loaded ${wineries.length} wineries`);

  // 2. Build the two cached-block versions.
  const baseSystem  = buildSystemPromptFromSource();
  const worldIndex  = renderWorldIndex(wineries);
  const oldBlock    = baseSystem + '\n\n' + worldIndex;
  const newBlock    = baseSystem;

  console.log(`\n  → counting tokens (this hits Anthropic's count-tokens API)...`);

  // 3. Count for each model. We count separately because tokenization can
  //    differ slightly between model families.
  for (const model of Object.keys(PRICING)) {
    const oldTok = await countTokens(model, oldBlock);
    const newTok = await countTokens(model, newBlock);
    const indexTok = await countTokens(model, worldIndex);
    const delta = oldTok - newTok;

    const p = PRICING[model];

    // Per-turn cached-read savings (after cache is warm).
    const savingsPerCachedTurn = (delta * p.cachedRead) / 1_000_000;
    // First-turn-in-window savings (cache creation pays the premium).
    const savingsPerFirstTurn  = (delta * p.cacheCreate) / 1_000_000;

    console.log(`\n  ${model}`);
    console.log(`    cached system block, OLD (with world index): ${oldTok.toLocaleString()} tokens`);
    console.log(`    cached system block, NEW (no world index):   ${newTok.toLocaleString()} tokens`);
    console.log(`    world-index block alone:                     ${indexTok.toLocaleString()} tokens`);
    console.log(`    delta:                                       ${delta.toLocaleString()} tokens (-${((delta/oldTok)*100).toFixed(1)}%)`);
    console.log('');
    console.log(`    Savings per cached turn:  $${savingsPerCachedTurn.toFixed(6)}  ($${(savingsPerCachedTurn * 1000).toFixed(4)} / 1K turns)`);
    console.log(`    Savings per FIRST turn:   $${savingsPerFirstTurn.toFixed(6)}  ($${(savingsPerFirstTurn * 1000).toFixed(4)} / 1K turns)`);
  }

  console.log(`
  Notes:
  • These are TOKEN-cost deltas only. The bigger wins from RAG are quality
    (semantic matching > keyword scoring) and the ability to support a
    growing corpus without ballooning cache size.
  • Per-turn savings scale linearly with corpus size. At 73 wineries the
    delta is modest; at 500+ it becomes meaningful.
  • The detail-slice tokens (per-turn, uncached) may also drop because
    semantic search picks tighter candidates — that's not measured here
    but is observable in the in-app usage logs.
`);
}

run().catch((err) => {
  console.error('\n❌ Verification failed:');
  console.error(err);
  process.exit(1);
});
