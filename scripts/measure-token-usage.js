// scripts/measure-token-usage.js
//
// Sends ONE realistic concierge-style query to Claude Haiku 4.5 and prints a
// full breakdown: token usage, dollar cost, what fraction of each rate-limit
// tier a single call consumes, and how many calls/minute each tier supports
// at scale.
//
// USAGE:
//   node scripts/measure-token-usage.js
//   node scripts/measure-token-usage.js --prompt "your custom prompt here"
//
// REQUIREMENTS:
//   - ANTHROPIC_API_KEY environment variable (already set in .env)
//
// Notes on the numbers in this file:
//   - Pricing as of 2026-05 for claude-haiku-4-5: $1/MTok input, $5/MTok output.
//     If Anthropic changes pricing, update PRICING below.
//   - Rate limits are per-account, per-model-family. The numbers below are the
//     published Haiku 4.5 limits for Tiers 1-4. Verify against
//     https://console.claude.com/settings/limits for your account.

'use strict';

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

// ─── Config ────────────────────────────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5';

// Default prompt — a short, realistic concierge-style query a SipLocal user
// might ask in-app. Override with: node scripts/measure-token-usage.js --prompt "..."
const DEFAULT_PROMPT =
  "I'm visiting Tasmania for a long weekend with my dog. Recommend two dog-friendly wineries near Hobart with a restaurant on site. Keep it under 80 words.";

// Haiku 4.5 pricing — dollars per 1 million tokens.
const PRICING = {
  inputPerMTok: 1.00,
  outputPerMTok: 5.00,
};

// Haiku 4.5 rate limits per tier (RPM = requests/min, ITPM = input tokens/min,
// OTPM = output tokens/min). Sourced from third-party tier tables and Anthropic
// docs (May 2026). Tier 2 ITPM/OTPM had a minor discrepancy between sources —
// using the conservative numbers here.
const TIERS = [
  { name: 'Tier 1', spendThreshold: '$5',   rpm: 50,    itpm: 50_000,    otpm: 10_000  },
  { name: 'Tier 2', spendThreshold: '$40',  rpm: 1_000, itpm: 450_000,   otpm: 90_000  },
  { name: 'Tier 3', spendThreshold: '$200', rpm: 2_000, itpm: 1_000_000, otpm: 200_000 },
  { name: 'Tier 4', spendThreshold: '$400', rpm: 4_000, itpm: 4_000_000, otpm: 800_000 },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parsePromptFromArgs() {
  const i = process.argv.indexOf('--prompt');
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return DEFAULT_PROMPT;
}

function fmtUsd(n) {
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1)    return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtInt(n) {
  return n.toLocaleString('en-US');
}

function pad(s, len) {
  s = String(s);
  return s + ' '.repeat(Math.max(0, len - s.length));
}

function divider(char = '─', len = 76) {
  console.log(char.repeat(len));
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY is not set. Add it to .env first.');
    process.exit(1);
  }

  const anthropic = new Anthropic({ maxRetries: 6, timeout: 60_000 });
  const prompt = parsePromptFromArgs();

  console.log();
  divider('═');
  console.log(`Token-usage probe — model: ${MODEL}`);
  divider('═');
  console.log();
  console.log('PROMPT:');
  console.log(`  ${prompt}`);
  console.log();

  const t0 = Date.now();
  let res;
  try {
    res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    if (err.status === 401) {
      console.error('Error: ANTHROPIC_API_KEY is invalid (401 Unauthorized).');
      console.error('The key in .env appears to have been revoked. Rotate it at:');
      console.error('  https://console.anthropic.com/settings/keys');
      console.error('Then update ANTHROPIC_API_KEY in .env and rerun.');
      process.exit(1);
    }
    if (err.message && err.message.includes('Connection error')) {
      console.error('Error: Network connection failed. Check your internet connection.');
      console.error('If this persists, the underlying cause is often:');
      console.error('  - DNS resolution issue (try again in a moment)');
      console.error('  - Firewall/VPN blocking api.anthropic.com');
      console.error('  - Invalid API key (run: curl -s -o /dev/null -w "%{http_code}\\n" \\');
      console.error('      -H "x-api-key: $ANTHROPIC_API_KEY" \\');
      console.error('      -H "anthropic-version: 2023-06-01" \\');
      console.error('      -H "content-type: application/json" \\');
      console.error('      -d \'{"model":"claude-haiku-4-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}\' \\');
      console.error('      https://api.anthropic.com/v1/messages)');
      process.exit(1);
    }
    throw err;
  }
  const elapsedMs = Date.now() - t0;

  const responseText = res.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  console.log('RESPONSE:');
  console.log(responseText.split('\n').map(l => `  ${l}`).join('\n'));
  console.log();
  console.log(`Latency: ${elapsedMs} ms`);
  console.log();

  // ─── Token usage ──────────────────────────────────────────────────────────
  const usage = res.usage || {};
  const inputTokens  = usage.input_tokens  || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheReadTokens   = usage.cache_read_input_tokens   || 0;
  const cacheWriteTokens  = usage.cache_creation_input_tokens || 0;
  const totalTokens = inputTokens + outputTokens;

  divider();
  console.log('TOKEN USAGE');
  divider();
  console.log(`  Input tokens:        ${fmtInt(inputTokens)}`);
  console.log(`  Output tokens:       ${fmtInt(outputTokens)}`);
  if (cacheReadTokens)  console.log(`  Cache read tokens:   ${fmtInt(cacheReadTokens)}`);
  if (cacheWriteTokens) console.log(`  Cache write tokens:  ${fmtInt(cacheWriteTokens)}`);
  console.log(`  TOTAL:               ${fmtInt(totalTokens)}`);
  console.log();

  // ─── Cost ────────────────────────────────────────────────────────────────
  const inputCost  = (inputTokens  / 1_000_000) * PRICING.inputPerMTok;
  const outputCost = (outputTokens / 1_000_000) * PRICING.outputPerMTok;
  const totalCost  = inputCost + outputCost;

  divider();
  console.log('COST (this single call)');
  divider();
  console.log(`  Input:   ${fmtInt(inputTokens)} tok × $${PRICING.inputPerMTok}/MTok  = ${fmtUsd(inputCost)}`);
  console.log(`  Output:  ${fmtInt(outputTokens)} tok × $${PRICING.outputPerMTok}/MTok  = ${fmtUsd(outputCost)}`);
  console.log(`  TOTAL:                                  = ${fmtUsd(totalCost)}`);
  console.log();
  console.log(`  Equivalent: ~${Math.round(1 / totalCost).toLocaleString()} of these calls per $1 spent.`);
  console.log();

  // ─── Rate-limit impact per tier ──────────────────────────────────────────
  divider();
  console.log('RATE-LIMIT IMPACT — what one call consumes (% of per-minute budget)');
  divider();
  console.log(
    '  ' +
    pad('Tier', 8) + pad('Spend', 8) +
    pad('% of RPM', 12) + pad('% of ITPM', 12) + pad('% of OTPM', 12) +
    'Bottleneck'
  );
  console.log('  ' + '-'.repeat(74));
  for (const t of TIERS) {
    const pctRpm  = (1 / t.rpm)  * 100;
    const pctItpm = (inputTokens  / t.itpm) * 100;
    const pctOtpm = (outputTokens / t.otpm) * 100;
    const maxByRpm  = t.rpm;
    const maxByItpm = inputTokens  > 0 ? t.itpm / inputTokens  : Infinity;
    const maxByOtpm = outputTokens > 0 ? t.otpm / outputTokens : Infinity;
    const maxQpm    = Math.min(maxByRpm, maxByItpm, maxByOtpm);
    let bottleneck;
    if (maxQpm === maxByRpm)        bottleneck = 'RPM';
    else if (maxQpm === maxByItpm)  bottleneck = 'ITPM (input)';
    else                            bottleneck = 'OTPM (output)';
    console.log(
      '  ' +
      pad(t.name, 8) + pad(t.spendThreshold, 8) +
      pad(pctRpm.toFixed(2) + '%', 12) +
      pad(pctItpm.toFixed(3) + '%', 12) +
      pad(pctOtpm.toFixed(3) + '%', 12) +
      bottleneck
    );
  }
  console.log();

  // ─── Scaling ─────────────────────────────────────────────────────────────
  divider();
  console.log('SCALE — max sustained queries-per-minute (whichever limit hits first)');
  divider();
  console.log(
    '  ' +
    pad('Tier', 8) +
    pad('Max QPM', 12) + pad('Max QPH', 14) + pad('Max QPD', 16) +
    pad('$/hour', 12) + '$/day'
  );
  console.log('  ' + '-'.repeat(74));
  for (const t of TIERS) {
    const maxByRpm  = t.rpm;
    const maxByItpm = inputTokens  > 0 ? t.itpm / inputTokens  : Infinity;
    const maxByOtpm = outputTokens > 0 ? t.otpm / outputTokens : Infinity;
    const maxQpm    = Math.floor(Math.min(maxByRpm, maxByItpm, maxByOtpm));
    const maxQph    = maxQpm * 60;
    const maxQpd    = maxQph * 24;
    const costPerHour = totalCost * maxQph;
    const costPerDay  = totalCost * maxQpd;
    console.log(
      '  ' +
      pad(t.name, 8) +
      pad(fmtInt(maxQpm), 12) +
      pad(fmtInt(maxQph), 14) +
      pad(fmtInt(maxQpd), 16) +
      pad(fmtUsd(costPerHour), 12) +
      fmtUsd(costPerDay)
    );
  }
  console.log();

  // ─── Realistic SipLocal scenarios ────────────────────────────────────────
  divider();
  console.log('SCENARIOS — projected monthly cost (30 days) at SipLocal usage levels');
  divider();
  const scenarios = [
    { label: '100 active users, 2 queries/day',     queriesPerDay: 100 * 2 },
    { label: '1,000 active users, 2 queries/day',   queriesPerDay: 1_000 * 2 },
    { label: '10,000 active users, 2 queries/day',  queriesPerDay: 10_000 * 2 },
    { label: '50,000 active users, 5 queries/day',  queriesPerDay: 50_000 * 5 },
  ];
  for (const s of scenarios) {
    const monthly = s.queriesPerDay * 30 * totalCost;
    const peakQpm = s.queriesPerDay / (24 * 60); // even distribution
    console.log(`  ${pad(s.label, 42)} → ${fmtUsd(monthly)}/mo  (~${peakQpm.toFixed(1)} QPM avg)`);
  }
  console.log();
  console.log('  Note: peak QPM is the AVERAGE assuming uniform spread. Real apps');
  console.log('  spike 5-20x at peak hours, so size your tier accordingly.');
  console.log();

  divider('═');
  console.log('Done.');
  divider('═');
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
