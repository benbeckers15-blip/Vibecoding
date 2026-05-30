// scripts/concierge/ab-test-providers.js
// ─────────────────────────────────────────────────────────────────────────────
// A/B harness: runs the SipLocal Sommelier system prompt + a curated
// query set through BOTH OpenAI (gpt-5.4-mini, current production) and
// Google Gemini 2.5 Flash, then writes a side-by-side markdown report
// for human review.
//
// USAGE:
//   # Required env vars (add to .env):
//   #   OPENAI_API_KEY   — your OpenAI key (same one in production)
//   #   GEMINI_API_KEY   — get one free at https://aistudio.google.com/apikey
//
//   node --env-file=.env scripts/concierge/ab-test-providers.js
//
//   # Filter to a single intent:
//   node --env-file=.env scripts/concierge/ab-test-providers.js --intent itinerary
//
//   # Skip Gemini (cost-only OpenAI run) or vice versa:
//   node --env-file=.env scripts/concierge/ab-test-providers.js --skip gemini
//   node --env-file=.env scripts/concierge/ab-test-providers.js --skip openai
//
//   # Custom output path:
//   node --env-file=.env scripts/concierge/ab-test-providers.js --out report.md
//
// OUTPUT:
//   A markdown file (default: scripts/concierge/ab-test-report.md) with
//   one section per query, each showing:
//     • The query + intent + today
//     • Side-by-side responses from both providers
//     • Cost, latency, token counts per provider
//   And a summary table at the end with averages by intent.
//
// WHAT THIS IS / ISN'T:
//   IS: a focused quality probe for the warm-sommelier prose voice
//       SipLocal is tuned for. Same system prompt for both providers;
//       same fake winery context per turn. Lets you read 23 side-by-
//       side responses and decide if Gemini's prose is acceptable.
//   ISN'T: a production replay. The full retrieval pipeline (router,
//       knowledge chunks, tasting notes, drive-time sort) isn't wired
//       in here — that's Phase 2 work if quality looks promising.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const OpenAI = require('openai');
// Using @google/genai (the current SDK), NOT @google/generative-ai (the
// older one we tried first). The older SDK doesn't expose
// thinkingConfig, and Gemini 2.5 Flash has thinking mode enabled by
// default — that internal reasoning is billed as output tokens AND
// counts against maxOutputTokens, which silently truncated 12 of 23
// responses in the first A/B run to short or empty visible text. We
// disable thinking explicitly via thinkingConfig.thinkingBudget = 0
// so the comparison reflects prose quality, not budget exhaustion.
const { GoogleGenAI } = require('@google/genai');
const { QUERIES, WINERY_CONTEXT } = require('./test-queries');
const { SYSTEM_PROMPT, buildUserTurn } = require('./sommelier-prompt');

// ─── Config ────────────────────────────────────────────────────────────────────

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Pricing per 1M tokens (USD). Update when providers change rates.
// Verify at https://openai.com/api/pricing/ and
// https://ai.google.dev/pricing for current numbers.
const PRICING = {
  'gpt-5.4-mini':  { input: 0.75,  cachedInput: 0.075, output: 4.50 },
  'gpt-5.4-nano':  { input: 0.20,  cachedInput: 0.02,  output: 1.25 },
  'gpt-5.4':       { input: 2.50,  cachedInput: 0.25,  output: 15.00 },
  'gemini-2.5-flash':       { input: 0.075, cachedInput: 0.019, output: 0.30 },
  'gemini-2.5-flash-lite':  { input: 0.04,  cachedInput: 0.01,  output: 0.15 },
};

// Output budget per response. Mirrors production's tiered caps from
// orchestrator.ts. Tight on factual intents, generous on itinerary.
const MAX_TOKENS_BY_INTENT = {
  specific_winery: 350,
  feature:         300,
  regional:        400,
  itinerary:       650,
  general:         400,
  out_of_scope:    150,
};
const MAX_TOKENS_FALLBACK = 400;

// ─── Args ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    intent: null,
    skip: null,
    out: path.resolve(__dirname, 'ab-test-report.md'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--intent' && argv[i + 1]) out.intent = argv[++i];
    else if (a === '--skip' && argv[i + 1]) out.skip = argv[++i];
    else if (a === '--out' && argv[i + 1]) out.out = path.resolve(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/concierge/ab-test-providers.js [--intent NAME] [--skip openai|gemini] [--out PATH]');
      process.exit(0);
    }
  }
  return out;
}

// ─── Pricing helpers ───────────────────────────────────────────────────────────

function priceTurn(model, usage) {
  const p = PRICING[model];
  if (!p) {
    console.warn(`  ! no pricing for ${model}, returning 0`);
    return 0;
  }
  const fresh = (usage.inputTokens || 0) - (usage.cachedTokens || 0);
  const freshCost  = Math.max(0, fresh) * p.input / 1_000_000;
  const cachedCost = (usage.cachedTokens || 0) * p.cachedInput / 1_000_000;
  const outCost    = (usage.outputTokens || 0) * p.output / 1_000_000;
  return freshCost + cachedCost + outCost;
}

function fmtUsd(n) {
  if (n < 0.0001) return '<$0.0001';
  return `$${n.toFixed(5)}`;
}

function fmtMs(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ─── Provider: OpenAI ──────────────────────────────────────────────────────────

let _openai = null;
function getOpenAI() {
  if (_openai) return _openai;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

async function runOpenAI(query, today, maxTokens) {
  const client = getOpenAI();
  const userTurn = buildUserTurn(query, today, WINERY_CONTEXT);
  const t0 = Date.now();
  const resp = await client.chat.completions.create({
    model: OPENAI_MODEL,
    max_completion_tokens: maxTokens,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userTurn },
    ],
  });
  const elapsedMs = Date.now() - t0;
  const usage = {
    inputTokens:  resp.usage?.prompt_tokens || 0,
    cachedTokens: resp.usage?.prompt_tokens_details?.cached_tokens || 0,
    outputTokens: resp.usage?.completion_tokens || 0,
  };
  return {
    text:        (resp.choices[0]?.message?.content || '').trim(),
    finishReason: resp.choices[0]?.finish_reason || null,
    usage,
    elapsedMs,
    costUsd: priceTurn(OPENAI_MODEL, usage),
    model: OPENAI_MODEL,
  };
}

// ─── Provider: Gemini ──────────────────────────────────────────────────────────

let _gemini = null;
function getGemini() {
  if (_gemini) return _gemini;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) not set');
  _gemini = new GoogleGenAI({ apiKey });
  return _gemini;
}

async function runGemini(query, today, maxTokens) {
  const ai = getGemini();
  const userTurn = buildUserTurn(query, today, WINERY_CONTEXT);
  const t0 = Date.now();
  // New SDK shape: ai.models.generateContent(...) with config at the
  // top level (no more model wrapper). Two things matter for a fair
  // comparison with OpenAI:
  //   • systemInstruction — the cached system prompt.
  //   • thinkingConfig.thinkingBudget = 0 — DISABLES internal reasoning.
  //     Without this, Gemini 2.5 Flash burns the maxOutputTokens budget
  //     on hidden thinking tokens and the visible response gets truncated
  //     mid-sentence. We want to test prose quality, not reasoning depth.
  const resp = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: userTurn,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: maxTokens,
      temperature: 0.7,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  const elapsedMs = Date.now() - t0;
  const usageMetadata = resp.usageMetadata || {};
  const usage = {
    inputTokens:  usageMetadata.promptTokenCount || 0,
    cachedTokens: usageMetadata.cachedContentTokenCount || 0,
    outputTokens: usageMetadata.candidatesTokenCount || 0,
  };
  // New SDK: response text lives at resp.text (no longer a function);
  // candidates at resp.candidates.
  const text = typeof resp.text === 'function' ? resp.text() : (resp.text || '');
  return {
    text:        String(text).trim(),
    finishReason: resp.candidates?.[0]?.finishReason || null,
    usage,
    elapsedMs,
    costUsd: priceTurn(GEMINI_MODEL, usage),
    model: GEMINI_MODEL,
  };
}

// ─── Runner ────────────────────────────────────────────────────────────────────

async function runOne(q, skip) {
  const maxTokens = MAX_TOKENS_BY_INTENT[q.intent] || MAX_TOKENS_FALLBACK;

  const openaiResult = skip === 'openai'
    ? null
    : await runOpenAI(q.query, q.today, maxTokens).catch((err) => ({
        error: err.message,
      }));

  const geminiResult = skip === 'gemini'
    ? null
    : await runGemini(q.query, q.today, maxTokens).catch((err) => ({
        error: err.message,
      }));

  return { q, openaiResult, geminiResult, maxTokens };
}

function fmtUsage(u) {
  if (!u) return '—';
  return `${u.inputTokens} in (${u.cachedTokens} cached) / ${u.outputTokens} out`;
}

function buildMarkdown(results, args) {
  const lines = [];
  lines.push('# SipLocal Concierge A/B: OpenAI vs Gemini');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Models: \`${OPENAI_MODEL}\` (left) vs \`${GEMINI_MODEL}\` (right)`);
  if (args.intent) lines.push(`Filter: intent = ${args.intent}`);
  if (args.skip)   lines.push(`Skipped: ${args.skip}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Per-query sections.
  for (const r of results) {
    lines.push(`## ${r.q.id} — ${r.q.intent}`);
    lines.push('');
    lines.push(`> **${r.q.query}**`);
    lines.push(`> _(today: ${r.q.today}, max_tokens: ${r.maxTokens})_`);
    lines.push('');
    lines.push('| | OpenAI | Gemini |');
    lines.push('|---|---|---|');
    lines.push(`| Cost | ${r.openaiResult?.error ? '`ERR`' : (r.openaiResult ? fmtUsd(r.openaiResult.costUsd) : '—')} | ${r.geminiResult?.error ? '`ERR`' : (r.geminiResult ? fmtUsd(r.geminiResult.costUsd) : '—')} |`);
    lines.push(`| Latency | ${r.openaiResult?.elapsedMs ? fmtMs(r.openaiResult.elapsedMs) : '—'} | ${r.geminiResult?.elapsedMs ? fmtMs(r.geminiResult.elapsedMs) : '—'} |`);
    lines.push(`| Tokens | ${fmtUsage(r.openaiResult?.usage)} | ${fmtUsage(r.geminiResult?.usage)} |`);
    lines.push(`| Stop | ${r.openaiResult?.finishReason || '—'} | ${r.geminiResult?.finishReason || '—'} |`);
    lines.push('');

    lines.push('### OpenAI');
    lines.push('');
    if (r.openaiResult?.error) {
      lines.push('```');
      lines.push(`ERROR: ${r.openaiResult.error}`);
      lines.push('```');
    } else if (r.openaiResult) {
      lines.push('> ' + r.openaiResult.text.replace(/\n/g, '\n> '));
    } else {
      lines.push('_(skipped)_');
    }
    lines.push('');

    lines.push('### Gemini');
    lines.push('');
    if (r.geminiResult?.error) {
      lines.push('```');
      lines.push(`ERROR: ${r.geminiResult.error}`);
      lines.push('```');
    } else if (r.geminiResult) {
      lines.push('> ' + r.geminiResult.text.replace(/\n/g, '\n> '));
    } else {
      lines.push('_(skipped)_');
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Aggregate summary.
  lines.push('## Summary');
  lines.push('');
  const okayResults = results.filter((r) =>
    (!r.openaiResult || !r.openaiResult.error) &&
    (!r.geminiResult || !r.geminiResult.error)
  );

  const totals = okayResults.reduce(
    (acc, r) => {
      if (r.openaiResult) {
        acc.openaiCost  += r.openaiResult.costUsd;
        acc.openaiMs    += r.openaiResult.elapsedMs;
        acc.openaiCount += 1;
      }
      if (r.geminiResult) {
        acc.geminiCost  += r.geminiResult.costUsd;
        acc.geminiMs    += r.geminiResult.elapsedMs;
        acc.geminiCount += 1;
      }
      return acc;
    },
    { openaiCost: 0, openaiMs: 0, openaiCount: 0, geminiCost: 0, geminiMs: 0, geminiCount: 0 }
  );

  lines.push('| Metric | OpenAI | Gemini | Ratio |');
  lines.push('|---|---|---|---|');
  if (totals.openaiCount && totals.geminiCount) {
    const oAvgCost = totals.openaiCost / totals.openaiCount;
    const gAvgCost = totals.geminiCost / totals.geminiCount;
    const oAvgMs   = totals.openaiMs   / totals.openaiCount;
    const gAvgMs   = totals.geminiMs   / totals.geminiCount;
    lines.push(`| Avg cost/turn | ${fmtUsd(oAvgCost)} | ${fmtUsd(gAvgCost)} | **${(oAvgCost / gAvgCost).toFixed(1)}× cheaper on Gemini** |`);
    lines.push(`| Avg latency | ${fmtMs(oAvgMs)} | ${fmtMs(gAvgMs)} | ${oAvgMs > gAvgMs ? `${(oAvgMs / gAvgMs).toFixed(2)}× faster on Gemini` : `${(gAvgMs / oAvgMs).toFixed(2)}× faster on OpenAI`} |`);
    lines.push(`| Total turns | ${totals.openaiCount} | ${totals.geminiCount} | |`);

    // Scale projections.
    lines.push('');
    lines.push('### Cost at scale (4 turns/DAU/day)');
    lines.push('');
    lines.push('| DAU | OpenAI/mo | Gemini/mo | Savings/mo |');
    lines.push('|---|---|---|---|');
    for (const dau of [1000, 5000, 25000, 100000]) {
      const turnsPerMonth = dau * 4 * 30;
      const oMo = oAvgCost * turnsPerMonth;
      const gMo = gAvgCost * turnsPerMonth;
      lines.push(`| ${dau.toLocaleString()} | $${oMo.toFixed(0)} | $${gMo.toFixed(0)} | **$${(oMo - gMo).toFixed(0)}** |`);
    }
  } else if (totals.openaiCount) {
    lines.push(`| Avg cost/turn | ${fmtUsd(totals.openaiCost / totals.openaiCount)} | — | — |`);
  } else if (totals.geminiCount) {
    lines.push(`| Avg cost/turn | — | ${fmtUsd(totals.geminiCost / totals.geminiCount)} | — |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('### How to use this report');
  lines.push('');
  lines.push('1. **Read every query section side-by-side.** Pay attention to: voice match to current production, length discipline (~100 words / itinerary 2 paragraphs), banned filler ("terroir-driven," "honest winemaking" etc.), correct use of the per-day hours field, and whether the model invented hours/bottles/wineries.');
  lines.push('2. **Mark each turn pass/fail** in a copy of this report. A failure looks like: invented data, broken length discipline, leaked retrieval-meta ("in the data I have"), generic chatbot tone.');
  lines.push('3. **Headline metric**: % of turns where Gemini quality is acceptable. ≥80% is a green light to canary; <60% is a red light.');
  lines.push('4. **Cost delta is overwhelming** — if quality is acceptable, the migration math is a no-brainer at your scale.');

  return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const queries = args.intent
    ? QUERIES.filter((q) => q.intent === args.intent)
    : QUERIES;

  if (queries.length === 0) {
    console.error(`No queries match intent="${args.intent}". Known intents:`,
      [...new Set(QUERIES.map((q) => q.intent))]);
    process.exit(1);
  }

  console.log(`\n🍷 SipLocal A/B: ${OPENAI_MODEL} vs ${GEMINI_MODEL}`);
  console.log(`   ${queries.length} queries${args.intent ? ` (intent=${args.intent})` : ''}${args.skip ? ` skip=${args.skip}` : ''}`);
  console.log(`   Output: ${args.out}\n`);

  // Pre-flight: check the keys we need.
  if (args.skip !== 'openai' && !process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY is not set. Run with --skip openai to skip, or add it to .env.');
    process.exit(1);
  }
  if (args.skip !== 'gemini' && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    console.error('❌ GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. Get one at https://aistudio.google.com/apikey');
    process.exit(1);
  }

  // Run sequentially. Parallel would race rate limits and confuse latency
  // measurements on shared infrastructure. ~1-2 minutes for 23 queries.
  const results = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    process.stdout.write(`  [${i + 1}/${queries.length}] ${q.id} (${q.intent}): ${q.query.slice(0, 50)}${q.query.length > 50 ? '…' : ''} `);
    const t = Date.now();
    const r = await runOne(q, args.skip);
    process.stdout.write(`✓ ${fmtMs(Date.now() - t)}\n`);
    results.push(r);
  }

  console.log('\n📝 Writing report...');
  const md = buildMarkdown(results, args);
  fs.writeFileSync(args.out, md, 'utf8');
  console.log(`   → ${args.out}\n`);

  // Quick stdout summary so the user sees headline numbers without
  // having to open the file.
  const okay = results.filter((r) =>
    (!r.openaiResult || !r.openaiResult.error) &&
    (!r.geminiResult || !r.geminiResult.error)
  );
  if (okay.length > 0) {
    const totals = okay.reduce((acc, r) => {
      if (r.openaiResult) { acc.oC += r.openaiResult.costUsd; acc.oN++; }
      if (r.geminiResult) { acc.gC += r.geminiResult.costUsd; acc.gN++; }
      return acc;
    }, { oC: 0, oN: 0, gC: 0, gN: 0 });
    if (totals.oN && totals.gN) {
      console.log(`💰 Avg cost/turn: ${fmtUsd(totals.oC / totals.oN)} (OpenAI) vs ${fmtUsd(totals.gC / totals.gN)} (Gemini)`);
      console.log(`    → Gemini is ${((totals.oC / totals.oN) / (totals.gC / totals.gN)).toFixed(1)}× cheaper.`);
    }
  }
  console.log('\n✅ Done. Read the report and judge quality side-by-side.\n');
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
