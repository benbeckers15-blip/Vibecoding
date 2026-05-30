#!/usr/bin/env node
// scripts/concierge/eval-v2.js
// ─────────────────────────────────────────────────────────────────────────────
// V2 concierge eval harness. Runs the 16-query set from
// docs/concierge-rewrite-spec.md §10 against a configurable concierge
// endpoint, captures raw SSE transcripts, and writes:
//
//   • <output>/eval-results.json  — every raw turn (routed intent,
//                                    anchor, candidate count, emitted
//                                    markers, reply text, usage, cost)
//   • <output>/eval-summary.md    — Claude-readable summary with a
//                                    pass/fail line per case and the
//                                    structural diagnostics that
//                                    matter most.
//
// USAGE
//   # Against local Firebase emulator with v2 flag on:
//   CONCIERGE_USE_V2=true firebase emulators:start --only functions &
//   node scripts/concierge/eval-v2.js \
//     --url http://127.0.0.1:5001/winery-tourism-tasmania/us-central1/concierge \
//     --output scripts/concierge/eval-v2-output/
//
//   # Against a deployed function (e.g. for parity comparison):
//   node scripts/concierge/eval-v2.js \
//     --url https://us-central1-winery-tourism-tasmania.cloudfunctions.net/concierge
//
// The harness is HTTP-level — it doesn't know about v1 vs v2 directly.
// The function's CONCIERGE_USE_V2 env var decides which orchestrator
// runs. Run it once with the flag OFF (v1 baseline), once with the
// flag ON (v2 candidate), and diff the JSON outputs to see the
// behavioural delta.
//
// Cost note: 16 turns × ~$0.001-0.003/turn = roughly $0.02-0.05 per
// run. Cheap, but don't loop it.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs = require('fs');
const path = require('path');

// ─── CLI args ──────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const URL = args.url || 'http://127.0.0.1:5001/winery-tourism-tasmania/us-central1/concierge';
const OUTPUT_DIR = args.output || path.join(__dirname, 'eval-v2-output');
const REGION_ID = args.region || 'tasmania';
const SESSION_ID = args.session || `eval-${Date.now()}`;
const ONLY = args.only
  ? new Set(args.only.split(',').map((s) => parseInt(s.trim(), 10)))
  : null;
// Optional GPS coordinates the harness forwards in the userLocation
// field of the SSE request. Use this to exercise the location-aware
// DISCOVERY override (stipulation #12) without simulating a phone.
// Format: --location lat,lon (e.g. --location -42.88,147.32 for Hobart).
const USER_LOCATION = args.location
  ? (() => {
      const [lat, lon] = args.location.split(',').map(Number);
      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        console.error(
          `Invalid --location "${args.location}". Expected lat,lon (e.g. -42.88,147.32).`
        );
        process.exit(1);
      }
      return { latitude: lat, longitude: lon };
    })()
  : null;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--region') out.region = argv[++i];
    else if (a === '--session') out.session = argv[++i];
    else if (a === '--only') out.only = argv[++i];
    else if (a === '--location') out.location = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node eval-v2.js [--url URL] [--output DIR] [--region ID] [--session ID] [--only 13,14,16] [--location lat,lon]'
      );
      process.exit(0);
    }
  }
  return out;
}

// ─── The 16-query set (spec §10) ──────────────────────────────────────────

const QUERY_SET = [
  {
    id: 1,
    query: 'Wines from Bangor Vineyard Shed',
    expectedBranch: 'WINERY_FOCUS',
    expectations: [
      'intent should be WINERY_FOCUS',
      'anchorWinerySlug should be bangor-vineyard-shed',
      'reply should only mention Bangor wines — NO neighbour winery',
      'should emit a winery_card for bangor-vineyard-shed only',
    ],
  },
  {
    id: 2,
    query: 'abel tasman pinot noir',
    expectedBranch: 'WINERY_FOCUS',
    expectations: [
      'intent should be WINERY_FOCUS (wine name implicitly anchors)',
      'anchorWinerySlug should be bangor-vineyard-shed',
      'anchorWineId should match the Abel Tasman wine doc',
      'reply should describe Abel Tasman Pinot Noir using the actual tasting notes',
    ],
  },
  {
    id: 3,
    query: 'abel tasman pinot noir bangor vineyard shed',
    expectedBranch: 'WINERY_FOCUS',
    expectations: [
      'intent should be WINERY_FOCUS',
      'anchorWinerySlug should be bangor-vineyard-shed (winery wins over wine)',
      'anchorWineId should be null (winery-name hit populated the anchor, not the wine)',
      'same answer as #2 in substance',
    ],
  },
  {
    id: 4,
    query: 'Is Tolpuddle open Sunday?',
    expectedBranch: 'WINERY_FOCUS',
    expectations: [
      'intent should be WINERY_FOCUS',
      'anchorWinerySlug should be tolpuddle-vineyard',
      'reply should answer from hours data — no fabrication',
      'winery_card for Tolpuddle',
    ],
  },
  {
    id: 5,
    query: 'Tell me about House of Arras',
    expectedBranch: 'WINERY_FOCUS',
    expectations: [
      'intent should be WINERY_FOCUS',
      'anchorWinerySlug should be null (off-corpus)',
      'diagnostics.offCorpusWineryNamed should be true',
      'reply should be encyclopedic about House of Arras',
      'reply should include one short "not a SipLocal cellar door" line',
      'no winery_card (House of Arras not in corpus)',
    ],
  },
  {
    id: 6,
    query: 'Tell me about Velvet & Willow Riesling',
    expectedBranch: 'WINERY_FOCUS',
    expectations: [
      'intent should be WINERY_FOCUS',
      'anchorWinerySlug should be null',
      'reply should speak about Tasmanian Riesling style generically',
      'reply should NOT invent a fake winery card or tasting notes',
    ],
  },
  {
    id: 7,
    query: 'Dog-friendly cellar doors with a restaurant',
    expectedBranch: 'DISCOVERY',
    expectations: [
      'intent should be DISCOVERY',
      'tags should include dog-friendly and restaurant',
      'wineWords should be empty',
      'no tasting_notes block in envelope',
      'reply should name multiple wineries that match both filters',
      'winery_card should include every named corpus winery',
    ],
  },
  {
    id: 8,
    query: 'Skin-contact riesling producers in Tasmania',
    expectedBranch: 'DISCOVERY',
    expectations: [
      'intent should be DISCOVERY',
      'wineWords should include skin-contact and riesling',
      'tasting_notes retrieval runs against the WHOLE wines namespace',
      'returned wines anchor to specific wineries which get cards',
    ],
  },
  {
    id: 9,
    query: 'Who makes the best Tasmanian chardonnay?',
    expectedBranch: 'DISCOVERY',
    expectations: [
      'intent should be DISCOVERY',
      'wineWords should include chardonnay',
      'top chardonnays from notes; their wineries get cards',
    ],
  },
  {
    id: 10,
    query: 'Why is Tasmania so good for sparkling?',
    expectedBranch: 'KNOWLEDGE',
    expectations: [
      'intent should be KNOWLEDGE',
      'knowledge_base block populated',
      'reply should explain the climate/region answer in prose',
      'no winery cards UNLESS the model names a specific corpus winery',
    ],
  },
  {
    id: 11,
    query: 'Plan a Saturday from Hobart, partner and I, love pinot',
    expectedBranch: 'TRIP',
    expectations: [
      'intent should be TRIP',
      'regions should include Coal River Valley, Derwent Valley, or Huon Valley',
      'wineWords should include pinot',
      'dayOfWeek should be Sat',
      'reply should sketch a 3-4 stop itinerary',
      'should emit <<TRIP_PLAN>> with valid slugs and 2-4 stops',
    ],
  },
  {
    id: 12,
    query: 'Plan a 3-day Tasmania wine trip',
    expectedBranch: 'TRIP',
    expectations: [
      'intent should be TRIP',
      'reply should propose 5-6 stops across multiple regions',
      'reply should include a prose note about splitting across days',
      'single <<TRIP_PLAN>> block (multi-day handled in prose, not the marker)',
    ],
  },
  {
    id: 13,
    query: 'Plan a day from Hobart',
    expectedBranch: 'TRIP',
    expectations: [
      'intent should be TRIP',
      'clarifyingQuestion should be populated (no day, no preferences, region is broad)',
      'reply should ask one focused follow-up before recommending',
      'no winery_card, no trip_plan',
    ],
  },
  {
    id: 14,
    query: "What's good?",
    expectedBranch: 'DISCOVERY',
    expectations: [
      'intent should be DISCOVERY',
      'clarifyingQuestion should be null (NARROWED rule per stipulation #12)',
      'reply should give a confident default recommendation',
    ],
  },
  {
    id: 15,
    query: 'Help me write an email',
    expectedBranch: 'OUT_OF_SCOPE',
    expectations: [
      'intent should be OUT_OF_SCOPE',
      'reply should be a warm deflection',
      'no cards, no trip plan',
    ],
  },
  {
    id: 16,
    multiTurn: true,
    turns: [
      { query: 'Suggest a Coal River pinot day' },
      { query: "actually let's do sparkling" },
    ],
    expectedBranch: 'TRIP',
    expectations: [
      'turn 2 selfContainedQuery should be a coref rewrite (e.g. "Plan a sparkling-focused Coal River day instead of pinot")',
      'turn 2 should emit a fresh trip plan with sparkling producers',
    ],
  },
];

// ─── SSE client ────────────────────────────────────────────────────────────

async function postConciergeTurn(query, history) {
  const body = {
    message: query,
    history,
    regionId: REGION_ID,
    sessionId: SESSION_ID,
  };
  if (USER_LOCATION) body.userLocation = USER_LOCATION;

  let res;
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Surface the real network-level cause. "fetch failed" by itself is
    // useless — usually it's ECONNREFUSED (emulator not ready), ENOTFOUND
    // (wrong host), or ETIMEDOUT (emulator started but bound to a
    // different port).
    const cause = err.cause || err;
    throw new Error(
      `network: ${cause.code || cause.errno || 'unknown'} — ${cause.message || err.message}` +
      `\n  URL: ${URL}` +
      `\n  hint: make sure the emulator is running and printed "ready" before launching this script,` +
      ` and that functions/.secret.local has all the secrets declared in functions/src/index.ts.`
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  // Read the SSE stream.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let deltaText = '';
  let doneEvent = null;
  let errorEvent = null;

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
      try {
        parsed = JSON.parse(dataLine);
      } catch {
        continue;
      }
      if (eventName === 'delta') deltaText += parsed.text || '';
      else if (eventName === 'done') doneEvent = parsed;
      else if (eventName === 'error') errorEvent = parsed;
    }
  }

  if (errorEvent) throw new Error(errorEvent.message || 'Server error');
  if (!doneEvent) throw new Error('Stream ended without done event');

  return { streamedText: deltaText, done: doneEvent };
}

// ─── Runner ────────────────────────────────────────────────────────────────

async function runCase(testCase) {
  const turns = testCase.multiTurn
    ? testCase.turns
    : [{ query: testCase.query }];

  const transcript = [];
  let history = [];

  for (const turn of turns) {
    const start = Date.now();
    let result;
    try {
      result = await postConciergeTurn(turn.query, history);
    } catch (err) {
      transcript.push({
        query: turn.query,
        error: err.message,
        elapsedMs: Date.now() - start,
      });
      return { id: testCase.id, transcript, error: err.message };
    }
    const elapsedMs = Date.now() - start;

    transcript.push({
      query: turn.query,
      elapsedMs,
      streamedText: result.streamedText,
      done: result.done, // includes reply, routerDecision, candidateCount, cost, proposal, wineryCards, history
    });

    history = result.done.history || [];
  }

  return {
    id: testCase.id,
    expectedBranch: testCase.expectedBranch,
    expectations: testCase.expectations,
    multiTurn: !!testCase.multiTurn,
    transcript,
  };
}

async function waitForEndpoint(url, maxAttempts = 30, intervalMs = 1000) {
  // Poll the URL with OPTIONS until it responds, OR until we hit
  // maxAttempts. Stops the script firing 16 turns against a still-
  // booting emulator.
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { method: 'OPTIONS' });
      // Emulator returns 204 to OPTIONS; deployed function returns 204
      // or a CORS preflight 200. Anything that isn't a network failure
      // means the endpoint is reachable.
      if (res.status < 500) return true;
    } catch (_err) {
      // Connection refused → emulator not up yet. Sleep and retry.
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.log();
  return false;
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('eval-v2 against', URL);
  console.log('output dir', OUTPUT_DIR);
  console.log('region', REGION_ID, 'session', SESSION_ID);
  console.log();

  process.stdout.write('Waiting for endpoint to respond ');
  const ready = await waitForEndpoint(URL);
  if (!ready) {
    console.error(
      `\nEndpoint did not come up within 30s.\n  URL: ${URL}\n  Is the emulator running? Check the emulator console for errors.`
    );
    process.exit(1);
  }
  console.log(' ready.\n');

  const results = [];

  const filteredSet = ONLY
    ? QUERY_SET.filter((c) => ONLY.has(c.id))
    : QUERY_SET;

  if (ONLY) {
    console.log(`Running only cases: ${[...ONLY].sort((a, b) => a - b).join(', ')}\n`);
  }
  if (USER_LOCATION) {
    console.log(`Forwarding userLocation: ${JSON.stringify(USER_LOCATION)}\n`);
  }

  for (const testCase of filteredSet) {
    const label = testCase.multiTurn
      ? `Case ${testCase.id}: multi-turn (${testCase.turns.length} turns)`
      : `Case ${testCase.id}: "${testCase.query}"`;
    process.stdout.write(`▶ ${label} ... `);
    const result = await runCase(testCase);
    if (result.error) {
      console.log(`ERROR (${result.error})`);
    } else {
      const lastTurn = result.transcript[result.transcript.length - 1];
      const intent = lastTurn?.done?.routerDecision?.intent ?? 'n/a';
      const anchor =
        lastTurn?.done?.routerDecision?.anchorWinerySlug ?? 'null';
      const candidates = lastTurn?.done?.candidateCount ?? 0;
      const hasTrip = !!lastTurn?.done?.proposal;
      const hasCard = !!lastTurn?.done?.wineryCards;
      console.log(
        `intent=${intent} anchor=${anchor} candidates=${candidates}` +
          ` trip=${hasTrip ? 'Y' : 'N'} card=${hasCard ? 'Y' : 'N'}`
      );
    }
    results.push(result);
  }

  // Write raw JSON.
  const jsonPath = path.join(OUTPUT_DIR, 'eval-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ url: URL, regionId: REGION_ID, runAt: new Date().toISOString(), results }, null, 2));
  console.log(`\n📄 raw transcripts → ${jsonPath}`);

  // Write structural summary.
  const summaryPath = path.join(OUTPUT_DIR, 'eval-summary.md');
  fs.writeFileSync(summaryPath, buildStructuralSummary(results));
  console.log(`📄 structural summary → ${summaryPath}`);
}

function buildStructuralSummary(results) {
  const lines = [];
  lines.push('# V2 Concierge Eval — Structural Pass');
  lines.push('');
  lines.push(`URL: ${URL}`);
  lines.push(`Run at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('Each case below shows the routed intent, anchor, candidate');
  lines.push('count, and emitted markers. This is the structural pass — it');
  lines.push("answers \"did the router route correctly?\" but not \"is the");
  lines.push('reply good?". Claude reads the full eval-results.json and');
  lines.push('writes the qualitative judgement separately.');
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const r of results) {
    lines.push(`## Case ${r.id}${r.multiTurn ? ' (multi-turn)' : ''}`);
    lines.push('');
    if (r.error) {
      lines.push(`**ERROR:** ${r.error}`);
      lines.push('');
      continue;
    }

    lines.push(`**Expected branch:** ${r.expectedBranch ?? '—'}`);
    lines.push('');
    lines.push('**Expectations:**');
    for (const exp of r.expectations || []) lines.push(`- ${exp}`);
    lines.push('');

    for (let i = 0; i < r.transcript.length; i++) {
      const turn = r.transcript[i];
      const done = turn.done || {};
      const decision = done.routerDecision || {};
      lines.push(`### Turn ${i + 1}: "${turn.query}"`);
      lines.push('');
      lines.push(`- elapsed: ${turn.elapsedMs} ms`);
      lines.push(`- intent: \`${decision.intent ?? 'n/a'}\``);
      lines.push(`- anchorWinerySlug: \`${decision.anchorWinerySlug ?? 'null'}\``);
      lines.push(`- anchorWineId: \`${decision.anchorWineId ?? 'null'}\``);
      lines.push(`- regions: \`${JSON.stringify(decision.regions ?? [])}\``);
      lines.push(`- tags: \`${JSON.stringify(decision.tags ?? [])}\``);
      lines.push(`- wineWords: \`${JSON.stringify(decision.wineWords ?? [])}\``);
      lines.push(`- dayOfWeek: \`${decision.dayOfWeek ?? 'null'}\``);
      lines.push(`- clarifyingQuestion: \`${decision.clarifyingQuestion ?? 'null'}\``);
      lines.push(`- candidateCount: ${done.candidateCount ?? 'n/a'}`);
      lines.push(`- emitted TRIP_PLAN: ${!!done.proposal}${done.proposal ? ` (${done.proposal.slugs?.length ?? 0} slugs)` : ''}`);
      lines.push(`- emitted WINERY_CARD: ${!!done.wineryCards}${done.wineryCards ? ` (${done.wineryCards.slugs?.length ?? 0} slugs)` : ''}`);
      if (done.proposal) {
        lines.push(`- trip slugs: \`${JSON.stringify(done.proposal.slugs)}\``);
      }
      if (done.wineryCards) {
        lines.push(`- card slugs: \`${JSON.stringify(done.wineryCards.slugs)}\``);
      }
      lines.push('');
      lines.push('**Reply:**');
      lines.push('');
      lines.push('> ' + (done.reply ?? '').split('\n').join('\n> '));
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
