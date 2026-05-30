// scripts/concierge/test-gemini-live.js
// ─────────────────────────────────────────────────────────────────────────────
// END-TO-END production replay against the DEPLOYED concierge URL.
//
// Unlike scripts/concierge/ab-test-providers.js (which is a quality probe
// with fake winery context), this runner hits the deployed Cloud Function
// directly. That means every request goes through the real production
// pipeline:
//
//   1. resolveCoreference (gpt-5.4-nano, only on multi-turn sequences)
//   2. routeQuery         (gpt-5.4-mini)
//   3. retrieveCandidates (filter + boost + drive-time + rerank against
//                          your live Firestore corpus)
//   4. retrieveKnowledge  (Upstash knowledge namespace, intent-gated)
//   5. retrieveTastingNotes (Upstash wines namespace)
//   6. buildSystemPrompt + Gemini 2.5 Flash response
//
// So every red flag in the report is a REAL issue the next user could
// hit. Use this script to:
//
//   • Spot hallucinations (winery names / hours / vintages / awards
//     that don't exist in your Firestore data).
//   • Catch system-prompt regressions after every prompt edit.
//   • Iterate on prompt tightening: read report → edit systemPrompt.ts
//     → deploy → re-run → diff against the previous report.
//
// ITERATION LOOP (the workflow this script is built for):
//
//   1. Run baseline:    node --env-file=.env scripts/concierge/test-gemini-live.js
//   2. Identify issues: open scripts/concierge/live-test-report.md and read
//      the "🚨 Auto-detected quality flags" section first
//   3. Edit prompt:     functions/src/concierge/systemPrompt.ts
//   4. Deploy:          cd functions && npm run deploy
//   5. Re-run:          same command (defaults overwrite the report)
//   6. Diff:            git diff scripts/concierge/live-test-report.md
//      to see exactly which responses changed and how.
//
// CONTROLS:
//   --category <name>   only run a single category (hours/tags/specific/
//                       regional/itinerary/prose/edge/oos/followup)
//   --id <id>           run only a specific query by id (e.g. h1, fu2)
//   --skip-followups    skip the multi-turn sequences (faster)
//   --only-followups    only run the multi-turn sequences
//   --url <url>         override CONCIERGE_URL env (e.g. local emulator)
//   --out <path>        change output file
//   --max <n>           run only the first N queries (smoke test)
//
// COST: roughly $0.005 per turn × ~40 turns = ~$0.20 per full run.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SINGLE_TURN_QUERIES, FOLLOW_UP_SEQUENCES } = require('./test-queries-live');

// ─── Config ────────────────────────────────────────────────────────────────────

// Default to the production concierge URL for the Tasmania project. Mirror
// of services/concierge/concierge.ts's CONCIERGE_URL constant — same
// deterministic Firebase Functions v1-style URL that doesn't change
// across deploys. Override per run with --url.
const DEFAULT_CONCIERGE_URL =
  process.env.CONCIERGE_URL ||
  process.env.EXPO_PUBLIC_CONCIERGE_URL ||
  'https://us-central1-winery-tourism-tasmania.cloudfunctions.net/concierge';

const DEFAULT_REGION_ID = process.env.CONCIERGE_REGION_ID || 'tasmania';

// Optional user location to include in every request. Some queries
// ("anywhere near me", itineraries) behave differently with a location;
// this gives the test a stable baseline. Set to null to test the
// no-location path. Default: a point in central Hobart so location-aware
// branches fire predictably.
const DEFAULT_USER_LOCATION = { latitude: -42.8826, longitude: 147.3257 };

// Persistent fake session/user identifiers so all turns in this run
// group cleanly in Langfuse under a single dashboard thread, separate
// from real production traffic. Use a fresh UUID per run so successive
// test runs don't pollute the same Langfuse session.
function makeRunId() {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Args ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    category: null,
    id: null,
    skipFollowups: false,
    onlyFollowups: false,
    url: DEFAULT_CONCIERGE_URL,
    out: path.resolve(__dirname, 'live-test-report.md'),
    max: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--category' && argv[i + 1]) out.category = argv[++i];
    else if (a === '--id' && argv[i + 1]) out.id = argv[++i];
    else if (a === '--skip-followups') out.skipFollowups = true;
    else if (a === '--only-followups') out.onlyFollowups = true;
    else if (a === '--url' && argv[i + 1]) out.url = argv[++i];
    else if (a === '--out' && argv[i + 1]) out.out = path.resolve(argv[++i]);
    else if (a === '--max' && argv[i + 1]) out.max = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/concierge/test-gemini-live.js [--category NAME] [--id ID] [--skip-followups] [--only-followups] [--url URL] [--out PATH] [--max N]');
      process.exit(0);
    }
  }
  return out;
}

// ─── SSE client ────────────────────────────────────────────────────────────────

/**
 * POST to the concierge URL and consume the SSE stream. Returns the
 * final AskResult (the `done` event payload) plus the accumulated
 * streamed text. Throws on HTTP error or server-emitted `error` event.
 *
 * Mirrors services/concierge/concierge.ts's streamSse parser — kept
 * here as a standalone Node implementation so the script has zero
 * runtime dependency on the React Native client code.
 */
async function callConcierge(url, body) {
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Concierge HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamedText = '';
  let doneEvent = null;
  let serverError = null;
  let firstTokenMs = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const eventText = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let eventName = 'message';
      let dataLine = '';
      for (const line of eventText.split('\n')) {
        if (line.startsWith('event: ')) eventName = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataLine = line.slice(6);
      }
      if (!dataLine) continue;

      let parsed;
      try { parsed = JSON.parse(dataLine); } catch { continue; }

      if (eventName === 'delta') {
        if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
        streamedText += parsed.text || '';
      } else if (eventName === 'done') {
        doneEvent = parsed;
      } else if (eventName === 'error') {
        serverError = parsed.message || 'Server error';
      }
    }
  }

  if (serverError) throw new Error(serverError);
  if (!doneEvent) throw new Error('Stream ended without a `done` event');

  return {
    result: doneEvent,
    streamedText,
    totalMs: Date.now() - t0,
    firstTokenMs,
  };
}

// ─── Quality flags ─────────────────────────────────────────────────────────────

/**
 * Auto-detect common quality issues in a response. These are heuristics —
 * not every flag means a real failure, but they're high-signal enough to
 * be worth surfacing at the top of the report so a reviewer can triage
 * fast.
 */
function detectFlags(reply, result, sequenceContext) {
  const flags = [];

  // Markdown bold ` ** ... ** `
  if (/\*\*[^\s*][^*]*[^\s*]\*\*/.test(reply)) {
    flags.push('markdown-bold');
  }
  // Markdown italic ` * ... * ` or ` _..._ ` (excluding bold double-stars)
  if (/(^|[\s.])\*[^\s*][^*]*[^\s*]\*([\s.,!?]|$)/.test(reply) ||
      /(^|[\s.])_[^\s_][^_]*[^\s_]_([\s.,!?]|$)/.test(reply)) {
    flags.push('markdown-italic');
  }
  // Bullet point at start of any line
  if (/^[ \t]*[-*•][ \t]+\S/m.test(reply)) {
    flags.push('bullet-point');
  }
  // Numbered list at start of any line (e.g. "1. ")
  if (/^[ \t]*\d+\.[ \t]+\S/m.test(reply)) {
    flags.push('numbered-list');
  }
  // Marker leak — server should strip these but check anyway
  if (/<<TRIP_PLAN>>|<<WINERY_CARD>>|<<END_TRIP_PLAN>>|<<END_WINERY_CARD>>/i.test(reply)) {
    flags.push('marker-leak');
  }
  // Slug leak — winery slugs (lowercase-with-hyphens) sometimes sneak
  // into prose. False positives possible (real hyphenated phrases) but
  // worth a flag to review.
  if (/\b[a-z]{3,}-[a-z]{3,}(-[a-z]{2,})?\b/.test(reply)) {
    // Filter out false positives like "by-appointment", "follow-up", etc.
    // Common hyphenated English phrases that look slug-like but aren't slugs.
    // Add to this list when a new false-positive shows up in a report.
    const allowList = ['by-appointment', 'walk-in', 'walk-ins', 'follow-up', 'follow-ups', 'multi-stop', 'half-day', 'full-day', 'long-form', 'mid-morning', 'mid-afternoon', 'cool-climate', 'single-vineyard', 'single-vineyards', 'late-disgorged', 'all-round', 'all-rounder', 'all-rounders', 'dog-friendly', 'biodynamic', 'award-winning', 'small-producer', 'hobart-side', 'launceston-side', 'food-first', 'wine-first', 'cellar-door', 'tap-to-call', 'old-bones', 'family-run', 'estate-grown', 'farm-to-table', 'single-site', 'single-sites', 'highly-regarded', 'well-regarded', 'long-standing', 'much-loved', 'world-class', 'family-owned', 'family-run', 'multi-generational', 'present-day', 'second-generation', 'third-generation', 'fourth-generation', 'fifth-generation', 'sixth-generation', 'two-generation', 'three-generation', 'four-generation', 'five-generation', 'six-generation', 'family-estate', 'home-grown', 'farm-gate', 'machine-readable', 'human-readable', 'on-site', 'off-site', 'long-lunch', 'long-lunches'];
    const matches = reply.match(/\b[a-z]{3,}-[a-z]{3,}(-[a-z]{2,})?\b/g) || [];
    const suspect = matches.filter((m) => !allowList.includes(m.toLowerCase()));
    if (suspect.length > 0) {
      flags.push(`slug-suspect:${suspect.slice(0, 3).join(',')}`);
    }
  }
  // Retrieval-meta leak ("in my data" / "the slice" / "I don't have")
  if (/\bin (my|the) (data|slice|context|corpus|index|per-turn)\b/i.test(reply) ||
      /\bI don'?t have (X|that|its|the) (full )?(details|info)\b/i.test(reply) ||
      /\bdataset I have\b/i.test(reply)) {
    flags.push('meta-leak');
  }
  // Length discipline — flag long responses on non-itinerary intents
  const wordCount = reply.split(/\s+/).filter(Boolean).length;
  const intent = result?.routerDecision?.intent || '';
  if (intent !== 'itinerary' && wordCount > 180) {
    flags.push(`long:${wordCount}w`);
  }
  if (intent === 'itinerary' && wordCount > 280) {
    flags.push(`long-itinerary:${wordCount}w`);
  }
  // Missing winery card when one is plausibly expected
  // Specific_winery intent should usually emit a card.
  if (intent === 'specific_winery' && !result?.wineryCards?.slugs?.length) {
    flags.push('missing-winery-card');
  }
  // Missing trip plan on itinerary intent
  if (intent === 'itinerary' && !result?.proposal?.slugs?.length) {
    flags.push('missing-trip-plan');
  }
  // Stop reason "length" — model hit max_completion_tokens
  if (result?.stopReason === 'length') {
    flags.push('truncated');
  }
  // Empty / suspiciously short reply
  if (wordCount < 8) {
    flags.push(`too-short:${wordCount}w`);
  }
  // Filler phrase check (production prompt explicitly bans these)
  const bannedFiller = [
    'terroir-driven',
    'speaks to the land',
    'honest winemaking',
    'enough structure to keep it honest',
    'the vines don\'t lie',
  ];
  for (const phrase of bannedFiller) {
    if (reply.toLowerCase().includes(phrase.toLowerCase())) {
      flags.push(`filler:${phrase.slice(0, 20)}`);
    }
  }
  // Sycophantic openers
  if (/^(great question|wonderful|certainly|absolutely|of course)/i.test(reply.trim())) {
    flags.push('sycophant-open');
  }
  // Sequence-specific: follow-up references the wrong winery
  if (sequenceContext?.priorSlugs?.length > 0) {
    const cardSlugs = result?.wineryCards?.slugs || [];
    const overlap = cardSlugs.some((s) => sequenceContext.priorSlugs.includes(s));
    if (cardSlugs.length > 0 && !overlap) {
      flags.push('followup-slug-drift');
    }
  }

  // ── Hallucination-shape detection ──
  // These are heuristics for facts the dataset almost certainly does
  // NOT contain. False positives are real (a real founding date might
  // legitimately appear in the editorial description), but on the
  // hallucination-probe queries every match is suspicious enough to
  // warrant a human eye. Read the prose alongside the flag — the auto-
  // flag is a triage signal, not a verdict.

  // Founding year / "since YYYY" / "established YYYY"
  const foundingMatches = reply.match(
    /\b(?:founded|established|started|set up|planted|opened)\s+(?:in\s+)?(?:the\s+)?(?:early\s+|mid-?|late\s+)?(?:18|19|20)\d{2}s?\b/gi
  ) || [];
  if (foundingMatches.length > 0) {
    flags.push(`fact-founding:${foundingMatches[0].slice(0, 30)}`);
  }
  // "since 1997" / "first vintage 1999"
  if (/\bsince\s+(?:18|19|20)\d{2}\b/i.test(reply) ||
      /\bfirst vintage\s+(?:18|19|20)\d{2}\b/i.test(reply)) {
    flags.push('fact-year-since');
  }
  // Hectares / acres — specific vineyard size
  const sizeMatches = reply.match(/\b\d{1,4}(?:\.\d+)?\s*(?:hectares?|ha\b|acres?)\b/gi) || [];
  if (sizeMatches.length > 0) {
    flags.push(`fact-size:${sizeMatches[0]}`);
  }
  // Specific vintages — "2019 chardonnay", "2018 pinot", etc. We
  // tolerate "back to 2018" / "since 2018" (general history phrasing)
  // but flag vintage-attached-to-wine phrasings.
  const vintageMatches = reply.match(
    /\b(?:19|20)\d{2}\s+(?:vintage|pinot|chardonnay|riesling|cabernet|sauvignon|sparkling|cuv[ée]e|reserve|estate)\b/gi
  ) || [];
  if (vintageMatches.length > 0) {
    flags.push(`fact-vintage:${vintageMatches[0]}`);
  }
  // Dollar prices — "$45 a bottle", "around $30"
  const priceMatches = reply.match(/\$\s?\d{1,4}(?:\.\d{2})?(?:\s*(?:a|per|each))?(?:\s+(?:bottle|glass|tasting|head))?/g) || [];
  if (priceMatches.length > 0) {
    flags.push(`fact-price:${priceMatches[0]}`);
  }
  // Critic scores — "95 points", "scored 96", "Halliday-rated 95"
  if (/\b(?:scored|rated)\s+\d{2,3}\b/i.test(reply) ||
      /\b\d{2,3}\s+points?\b/i.test(reply) ||
      /\bHalliday[- ](?:rated|scored)\s+\d/i.test(reply)) {
    flags.push('fact-score');
  }
  // Elevation — "300m above sea level", "elevation of 250 metres"
  const elevationMatches = reply.match(/\b\d{2,4}\s*(?:m(?:etre|eter)?s?\s+(?:above|asl|elevation)|m\s+above\s+sea)\b/i) || [];
  if (elevationMatches.length > 0) {
    flags.push('fact-elevation');
  }
  // Specific named persons — "founded by John Smith", "winemaker is X"
  // Heuristic: "by/with [First Last]" or "[Title] [First Last]" — high
  // false-positive rate; check report carefully before treating as a
  // failure. Some descriptions DO name owners legitimately.
  const personMatches = reply.match(
    /\b(?:founded\s+by|owned\s+by|run\s+by|winemaker(?:\s+is)?|by\s+the)\s+([A-Z][a-z]+\s+(?:and|&)\s+[A-Z][a-z]+|[A-Z][a-z]+\s+[A-Z][a-z]+)\b/g
  ) || [];
  if (personMatches.length > 0) {
    flags.push(`fact-person:${personMatches[0].slice(0, 40)}`);
  }
  // Generations claim — "three generations of the family"
  if (/\b(?:three|four|five|six|second|third|fourth|fifth|2nd|3rd|4th|5th)[- ]?generation\b/i.test(reply)) {
    flags.push('fact-generations');
  }

  return flags;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(n) {
  if (n === 0) return '$0.0000';
  if (n < 0.0001) return '<$0.0001';
  return `$${n.toFixed(5)}`;
}
function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
function quote(text) {
  return text.replace(/\n/g, '\n> ');
}

// ─── Runner ────────────────────────────────────────────────────────────────────

async function runSingleQuery(url, q, runId) {
  const body = {
    message: q.query,
    history: [],
    userLocation: DEFAULT_USER_LOCATION,
    regionId: DEFAULT_REGION_ID,
    sessionId: `${runId}-${q.id}`,
    userId: runId,
  };
  const { result, streamedText, totalMs, firstTokenMs } = await callConcierge(url, body);
  const flags = detectFlags(result.reply ?? streamedText, result, null);
  return {
    kind: 'single',
    q,
    result,
    streamedText,
    totalMs,
    firstTokenMs,
    flags,
  };
}

async function runFollowupSequence(url, seq, runId) {
  // A follow-up sequence runs multiple turns in a single shared session.
  // We thread the history the server returns into the next request body,
  // exactly the way the chat UI does in production.
  const turns = [];
  let history = [];
  let priorSlugs = [];

  for (let i = 0; i < seq.turns.length; i++) {
    const message = seq.turns[i];
    const body = {
      message,
      history,
      userLocation: DEFAULT_USER_LOCATION,
      regionId: DEFAULT_REGION_ID,
      sessionId: `${runId}-${seq.id}`,
      userId: runId,
    };
    const { result, streamedText, totalMs, firstTokenMs } = await callConcierge(url, body);
    const flags = detectFlags(result.reply ?? streamedText, result, { priorSlugs });
    turns.push({ message, result, streamedText, totalMs, firstTokenMs, flags });

    // Thread server-returned history into the next turn.
    history = result.history || [];
    // Track winery slugs seen so far for follow-up-drift detection.
    const seenSlugs = [
      ...(result.wineryCards?.slugs || []),
      ...(result.proposal?.slugs || []),
    ];
    priorSlugs = [...new Set([...priorSlugs, ...seenSlugs])];
  }

  return { kind: 'followup', seq, turns };
}

// ─── Report rendering ─────────────────────────────────────────────────────────

function renderSingleSection(r) {
  const { q, result, flags, totalMs, firstTokenMs } = r;
  const reply = result.reply ?? '';
  const intent = result.routerDecision?.intent || '—';
  const candidateCount = result.candidateCount ?? 0;
  const cards = result.wineryCards?.slugs || [];
  const proposalName = result.proposal?.name || null;
  const proposalSlugs = result.proposal?.slugs || [];

  const lines = [];
  lines.push(`### ${q.id} — ${q.category} ${flags.length ? `🚩 ${flags.join(', ')}` : '✓'}`);
  lines.push('');
  lines.push(`> **${q.query}**`);
  lines.push('');
  lines.push(`| Cost | Latency (total / first token) | Intent | Cands | Stop |`);
  lines.push(`|---|---|---|---|---|`);
  lines.push(`| ${fmtUsd(result.cost?.total?.usd?.total ?? 0)} | ${fmtMs(totalMs)} / ${fmtMs(firstTokenMs)} | ${intent} | ${candidateCount} | ${result.stopReason || '—'} |`);
  if (cards.length) {
    lines.push(`> Winery cards: ${cards.join(', ')}`);
  }
  if (proposalName) {
    lines.push(`> Trip plan: **${proposalName}** → ${proposalSlugs.join(' → ')}`);
  }
  lines.push('');
  lines.push('> ' + quote(reply || '_(empty reply)_'));
  lines.push('');
  return lines.join('\n');
}

function renderFollowupSection(r) {
  const { seq, turns } = r;
  const totalCost = turns.reduce((s, t) => s + (t.result.cost?.total?.usd?.total ?? 0), 0);
  const allFlags = turns.flatMap((t) => t.flags);

  const lines = [];
  lines.push(`### ${seq.id} — followup ${allFlags.length ? `🚩 ${allFlags.join(', ')}` : '✓'}`);
  lines.push('');
  lines.push(`_${seq.label}_`);
  lines.push('');
  lines.push(`Total cost: **${fmtUsd(totalCost)}** across ${turns.length} turns.`);
  lines.push('');
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const intent = t.result.routerDecision?.intent || '—';
    const cards = t.result.wineryCards?.slugs || [];
    lines.push(`**Turn ${i + 1}** (${fmtUsd(t.result.cost?.total?.usd?.total ?? 0)}, ${fmtMs(t.totalMs)}, intent=${intent}, cands=${t.result.candidateCount ?? 0}${t.flags.length ? `, 🚩 ${t.flags.join(', ')}` : ''}):`);
    lines.push('');
    lines.push(`> **You:** ${t.message}`);
    lines.push('>');
    lines.push('> **Sommelier:** ' + quote(t.result.reply || '_(empty)_'));
    if (cards.length) lines.push(`> Winery cards: ${cards.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderReport(results, args, runId) {
  const lines = [];
  lines.push('# SipLocal Concierge — Live End-to-End Test (Gemini 2.5 Flash)');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Run ID: \`${runId}\` (search this in Langfuse to find these traces)`);
  lines.push(`URL: \`${args.url}\``);
  lines.push(`Region: \`${DEFAULT_REGION_ID}\``);
  if (args.category) lines.push(`Filter: category = ${args.category}`);
  if (args.id) lines.push(`Filter: id = ${args.id}`);
  lines.push('');

  // Aggregate cost + latency.
  let totalCost = 0;
  let totalLatency = 0;
  let turnCount = 0;
  const allFlags = [];

  for (const r of results) {
    if (r.kind === 'single') {
      totalCost += r.result.cost?.total?.usd?.total ?? 0;
      totalLatency += r.totalMs;
      turnCount += 1;
      allFlags.push(...r.flags.map((f) => ({ id: r.q.id, flag: f })));
    } else {
      for (const t of r.turns) {
        totalCost += t.result.cost?.total?.usd?.total ?? 0;
        totalLatency += t.totalMs;
        turnCount += 1;
        allFlags.push(...t.flags.map((f) => ({ id: `${r.seq.id}.turn${r.turns.indexOf(t) + 1}`, flag: f })));
      }
    }
  }

  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total turns:** ${turnCount}`);
  lines.push(`- **Total cost:** ${fmtUsd(totalCost)}`);
  lines.push(`- **Avg cost/turn:** ${fmtUsd(totalCost / Math.max(1, turnCount))}`);
  lines.push(`- **Avg latency/turn:** ${fmtMs(totalLatency / Math.max(1, turnCount))}`);
  lines.push(`- **Flag count:** ${allFlags.length} across ${new Set(allFlags.map((f) => f.id)).size} turns`);
  lines.push('');

  if (allFlags.length > 0) {
    lines.push('## 🚨 Auto-detected quality flags');
    lines.push('');
    lines.push('Flags are heuristics — not every one is a real failure, but they\'re worth eyeballing first. Each links to the turn section below.');
    lines.push('');
    // Group flags by type.
    const byType = {};
    for (const { id, flag } of allFlags) {
      const type = flag.split(':')[0];
      (byType[type] ??= []).push({ id, flag });
    }
    lines.push('| Flag | Count | Affected turns | Meaning |');
    lines.push('|---|---|---|---|');
    const FLAG_MEANINGS = {
      'markdown-bold':         'Used `**bold**` — production prompt forbids',
      'markdown-italic':       'Used `*italic*` or `_italic_` — production prompt forbids',
      'bullet-point':          'Used `- ` bullet list — production prompt forbids',
      'numbered-list':         'Used `1. ` numbered list — production prompt forbids',
      'marker-leak':           'Trip plan / winery card markers leaked into visible prose — server bug',
      'slug-suspect':          'Hyphenated slug-like word in prose — possible slug leak',
      'meta-leak':             'Mentioned "my data" / "the slice" / "I don\'t have" — retrieval-pipeline leak',
      'long':                  'Reply exceeded the per-intent word budget',
      'long-itinerary':        'Itinerary reply exceeded 280 words',
      'truncated':             'Hit max_completion_tokens — reply was cut off',
      'too-short':             'Reply suspiciously short (< 8 words) — possibly bad classification or truncation',
      'missing-winery-card':   'specific_winery intent but no <<WINERY_CARD>> emitted',
      'missing-trip-plan':     'itinerary intent but no <<TRIP_PLAN>> emitted',
      'filler':                'Used a banned filler phrase the prompt explicitly forbids',
      'sycophant-open':        'Opened with "Great question" / "Certainly" / etc. — prompt forbids',
      'followup-slug-drift':   'Follow-up mentioned different wineries than prior turn',
      'fact-founding':         'Mentioned a specific founding year — likely hallucinated unless in data',
      'fact-year-since':       'Used "since YYYY" or "first vintage YYYY" — likely hallucinated',
      'fact-size':             'Cited vineyard size in hectares / acres — likely hallucinated',
      'fact-vintage':          'Named a specific vintage of a wine — likely hallucinated unless in tasting notes',
      'fact-price':            'Quoted a specific dollar price — likely hallucinated',
      'fact-score':            'Cited a specific critic score / points — likely hallucinated',
      'fact-elevation':        'Cited vineyard elevation — likely hallucinated',
      'fact-person':           'Named a specific founder / owner / winemaker — possibly hallucinated; verify in description',
      'fact-generations':      'Claimed "Nth generation" — possibly hallucinated; verify in description',
    };
    for (const type of Object.keys(byType).sort()) {
      const ids = byType[type];
      const meaning = FLAG_MEANINGS[type] || '(custom)';
      const uniqueIds = [...new Set(ids.map((x) => x.id))];
      lines.push(`| \`${type}\` | ${ids.length} | ${uniqueIds.slice(0, 6).join(', ')}${uniqueIds.length > 6 ? `, +${uniqueIds.length - 6}` : ''} | ${meaning} |`);
    }
    lines.push('');
  } else {
    lines.push('## ✅ No auto-detected quality flags');
    lines.push('');
    lines.push('Doesn\'t mean every reply is great — heuristics catch formatting / length / leak issues but can\'t judge prose quality. Read the sections below.');
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Group by category for readability.
  const byCategory = {};
  for (const r of results) {
    const category = r.kind === 'single' ? r.q.category : 'followup';
    (byCategory[category] ??= []).push(r);
  }

  const categoryOrder = ['hallucination', 'hours', 'tags', 'specific', 'regional', 'itinerary', 'prose', 'edge', 'oos', 'followup'];
  const presentCategories = categoryOrder.filter((c) => byCategory[c]);
  for (const c of Object.keys(byCategory)) {
    if (!presentCategories.includes(c)) presentCategories.push(c);
  }

  for (const category of presentCategories) {
    lines.push(`## ${category}`);
    lines.push('');
    for (const r of byCategory[category]) {
      lines.push(r.kind === 'single' ? renderSingleSection(r) : renderFollowupSection(r));
      lines.push('---');
      lines.push('');
    }
  }

  lines.push('## How to iterate from this report');
  lines.push('');
  lines.push('1. **Triage the flags** at the top. Real failures usually fall into: invented hours/data (no flag for this — read manually), markdown formatting (`markdown-*`, `bullet-point`, `numbered-list`), retrieval leaks (`meta-leak`), missing markers (`missing-winery-card`, `missing-trip-plan`), or sloppy length (`long`, `truncated`).');
  lines.push('2. **For prompt fixes**, edit `functions/src/concierge/systemPrompt.ts` — usually the relevant block is one of: `BRAND_VOICE_TEMPLATE` (formatting / voice), `HARD_RULES_TEMPLATE` (data integrity / appointment rule), `LENGTH_DISCIPLINE` (filler / length), `FEW_SHOT` (tone calibration).');
  lines.push('3. **For routing or retrieval issues**, the fix is usually in `router.ts` (intent classifier) or `orchestrator.ts` (retrieve / gate logic), not the system prompt.');
  lines.push('4. **Deploy**: `cd functions && npm run deploy`. Wait ~2 min.');
  lines.push('5. **Re-run this script** with the same command. Output overwrites this file — `git diff scripts/concierge/live-test-report.md` shows you exactly which responses changed.');
  lines.push('');
  lines.push('Pro tip: commit the report after each prompt iteration so you have a paper trail of how the concierge\'s prose evolved.');
  return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = makeRunId();

  // Build the work list.
  let singles = SINGLE_TURN_QUERIES.slice();
  let followups = FOLLOW_UP_SEQUENCES.slice();

  if (args.category) {
    singles = singles.filter((q) => q.category === args.category);
    if (args.category !== 'followup') followups = [];
  }
  if (args.id) {
    singles = singles.filter((q) => q.id === args.id);
    followups = followups.filter((s) => s.id === args.id);
  }
  if (args.skipFollowups) followups = [];
  if (args.onlyFollowups) singles = [];
  if (args.max) {
    const allWork = [...singles, ...followups];
    if (allWork.length > args.max) {
      // Keep the proportion roughly even.
      singles = singles.slice(0, Math.ceil(args.max * singles.length / allWork.length));
      followups = followups.slice(0, Math.max(0, args.max - singles.length));
    }
  }

  const totalWork = singles.length + followups.length;
  if (totalWork === 0) {
    console.error('No queries to run after filters. Available categories:',
      [...new Set([
        ...SINGLE_TURN_QUERIES.map((q) => q.category),
        ...FOLLOW_UP_SEQUENCES.map((s) => s.category),
      ])]);
    process.exit(1);
  }

  console.log(`\n🍷 SipLocal live test — Gemini 2.5 Flash (deployed)`);
  console.log(`   URL: ${args.url}`);
  console.log(`   Region: ${DEFAULT_REGION_ID}`);
  console.log(`   Run ID: ${runId}`);
  console.log(`   ${singles.length} singles + ${followups.length} follow-up sequences`);
  console.log(`   Output: ${args.out}\n`);

  const results = [];

  // Singles first — they're independent and faster to triage.
  for (let i = 0; i < singles.length; i++) {
    const q = singles[i];
    process.stdout.write(`  [${i + 1}/${singles.length}] ${q.id} (${q.category}): ${q.query.slice(0, 60)}${q.query.length > 60 ? '…' : ''} `);
    try {
      const r = await runSingleQuery(args.url, q, runId);
      const flagStr = r.flags.length ? ` 🚩 ${r.flags.length}` : '';
      console.log(`✓ ${fmtMs(r.totalMs)} ${fmtUsd(r.result.cost?.total?.usd?.total ?? 0)}${flagStr}`);
      results.push(r);
    } catch (err) {
      console.log(`✗ ${err.message}`);
      results.push({ kind: 'single', q, error: err.message, flags: ['error'] });
    }
  }

  // Then follow-up sequences.
  for (let i = 0; i < followups.length; i++) {
    const seq = followups[i];
    console.log(`  [${i + 1}/${followups.length}] ${seq.id} (followup): ${seq.label}`);
    try {
      const r = await runFollowupSequence(args.url, seq, runId);
      for (let t = 0; t < r.turns.length; t++) {
        const turn = r.turns[t];
        const flagStr = turn.flags.length ? ` 🚩 ${turn.flags.length}` : '';
        console.log(`     turn ${t + 1}: ${fmtMs(turn.totalMs)} ${fmtUsd(turn.result.cost?.total?.usd?.total ?? 0)}${flagStr}`);
      }
      results.push(r);
    } catch (err) {
      console.log(`     ✗ ${err.message}`);
      results.push({ kind: 'followup', seq, error: err.message, turns: [], flags: ['error'] });
    }
  }

  // Skip error-only entries from the report so they don't break rendering.
  const renderable = results.filter((r) => !r.error);

  console.log('\n📝 Writing report...');
  const md = renderReport(renderable, args, runId);
  fs.writeFileSync(args.out, md, 'utf8');
  console.log(`   → ${args.out}\n`);

  // Stdout summary.
  const totalCost = renderable.reduce((s, r) => {
    if (r.kind === 'single') return s + (r.result.cost?.total?.usd?.total ?? 0);
    return s + r.turns.reduce((ts, t) => ts + (t.result.cost?.total?.usd?.total ?? 0), 0);
  }, 0);
  const turnCount = renderable.reduce((s, r) => s + (r.kind === 'single' ? 1 : r.turns.length), 0);
  const flagCount = renderable.reduce((s, r) => {
    if (r.kind === 'single') return s + r.flags.length;
    return s + r.turns.reduce((ts, t) => ts + t.flags.length, 0);
  }, 0);
  console.log(`💰 Total cost: ${fmtUsd(totalCost)} across ${turnCount} turns (${fmtUsd(totalCost / Math.max(1, turnCount))}/turn avg)`);
  console.log(`🚩 Flags: ${flagCount} auto-detected quality concerns to triage`);
  console.log(`🔍 Langfuse: search for sessions containing "${runId}" to find these traces\n`);
  console.log('✅ Done. Open the report and start with the "Auto-detected quality flags" section.\n');
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
