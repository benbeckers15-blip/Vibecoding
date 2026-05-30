// scripts/collect-winery-sources.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 0 of the source-grounded RAG architecture (see chat history).
//
// WHAT IT DOES:
//   Reads the first N wineries from Firestore (default 5), then for each
//   one asks Gemini 2.5 Flash WITH Google Search grounding enabled to
//   research the winery and compile a ~1500-word factual research
//   document. Saves one markdown file per winery to:
//
//     scripts/winery-sources/<slug>.md
//
//   Each file contains structured prose organized by topic (founding,
//   people, vineyard, wines, cellar door, food, awards, sustainability,
//   practical visiting info), followed by a citations list of the URLs
//   Google Search actually returned and Gemini actually grounded against.
//
// WHY GROUNDED SEARCH, NOT SCRAPING:
//   Gemini's googleSearch tool lets the model issue Google queries,
//   read the result pages, and synthesize a response with citations —
//   all inside Google's infrastructure, with no scraping by us. That
//   sidesteps the terms-of-service and robots.txt issues a homegrown
//   scraper would face, and the grounding metadata gives us provenance
//   (every fact links back to a URL we can audit).
//
//   The model is INSTRUCTED to only use grounded sources, never fall
//   back to general training knowledge. The prompt below is explicit
//   about this and tells the model to leave a section empty rather
//   than guess. If sections turn up sparse, that's a real signal
//   about a winery's online presence — useful information in itself.
//
// USAGE:
//   # Default: first 5 wineries by document id, fresh files only
//   node --env-file=.env scripts/collect-winery-sources.js
//
//   # More or fewer
//   node --env-file=.env scripts/collect-winery-sources.js --limit 10
//
//   # Specific wineries by slug
//   node --env-file=.env scripts/collect-winery-sources.js --slugs pooley,frogmore-creek,tolpuddle
//
//   # Re-run even if the markdown file already exists
//   node --env-file=.env scripts/collect-winery-sources.js --force
//
//   # Switch model (e.g. gemini-2.5-pro for slower/better/pricier research)
//   node --env-file=.env scripts/collect-winery-sources.js --model gemini-2.5-pro
//
// COST:
//   ~$0.005-0.02 per winery on gemini-2.5-flash with grounding (grounding
//   queries are charged; specifics on https://ai.google.dev/pricing).
//   5-winery pilot run: well under $0.10 total.
//
// AFTER RUNNING:
//   Open each .md file under scripts/winery-sources/ and READ IT. Decide:
//     • Is the information accurate? (spot-check a few citations)
//     • Is the depth proportional to the winery's real-world prominence?
//     • What's missing for sparse wineries that would need a manual
//       supplement before this becomes RAG-grade?
//     • Does the "Notable / Distinctive" section capture editorial
//       texture, or is it generic?
//   If yes: green light to build the RAG ingestion pipeline.
//   If no: tighten the prompt below and re-run with --force.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');

// ─── Init ──────────────────────────────────────────────────────────────────────

const serviceAccount = require('../service-account-tasmania.json');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!GEMINI_KEY) {
  console.error('❌ GEMINI_API_KEY (or GOOGLE_API_KEY) is not set in .env');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

// ─── Args ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    limit: 5,
    slugs: null,
    force: false,
    model: 'gemini-2.5-flash',
    outDir: path.resolve(__dirname, 'winery-sources'),
    regionId: process.env.CONCIERGE_REGION_ID || 'tasmania',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit' && argv[i + 1]) out.limit = parseInt(argv[++i], 10);
    else if (a === '--slugs' && argv[i + 1]) out.slugs = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--force') out.force = true;
    else if (a === '--model' && argv[i + 1]) out.model = argv[++i];
    else if (a === '--out' && argv[i + 1]) out.outDir = path.resolve(argv[++i]);
    else if (a === '--region' && argv[i + 1]) out.regionId = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node --env-file=.env scripts/collect-winery-sources.js [--limit N] [--slugs a,b,c] [--force] [--model NAME] [--out DIR] [--region ID]');
      process.exit(0);
    }
  }
  return out;
}

// ─── Prompt ────────────────────────────────────────────────────────────────────
// The whole game lives in this prompt. Edit it to change what kinds of
// information get gathered. The key disciplines:
//
//   1. SOURCED ONLY — no general training knowledge fills the gaps.
//      Empty sections are useful data; padded ones are a liability.
//   2. STRUCTURED — markdown headers so the file is auto-chunkable
//      later (when we wire the source material into Upstash, splitting
//      on `## ` boundaries gives natural retrieval-sized chunks).
//   3. PROSE NOT MARKETING — the model is told to be factual, plain,
//      and to avoid the flowery default voice. The editorial voice
//      pass happens later, by the concierge's own system prompt.
//   4. ANTI-PAD — explicit instruction that 500 sourced words beats
//      1500 padded words. This is the same instinct the user is
//      worried about for small wineries: better honest brevity than
//      faked depth.
function buildResearchPrompt(winery, regionDisplay) {
  const name = winery.name || winery.id;
  const region = winery.region ? `${winery.region}, ${regionDisplay}` : regionDisplay;
  const websiteHint = winery.website ? `\n  Their website (if helpful): ${winery.website}` : '';
  const phoneHint = winery.phone ? `\n  Their phone (in case it appears in business listings): ${winery.phone}` : '';

  return `You are a wine-tourism researcher compiling factual reference material on a specific cellar door. Use the googleSearch tool to find authoritative information from the open web, then output a single complete research document.

TARGET WINERY:
  Name: ${name}
  Region: ${region}, Australia${websiteHint}${phoneHint}

OUTPUT CONTRACT — read carefully, this controls what you produce:

You will output EXACTLY ONE document. The document begins with the first markdown header (## Founding & History) and ends with the last numbered source in the ## Sources list. There is no preamble, no "here is my research", no draft version followed by a final version, no commentary about the process. Just the document itself, in one pass, with citations embedded as you write each section.

Do NOT:
  - Write a draft and then rewrite it with citations added (this doubles the output and breaks the file)
  - Restate any section heading twice
  - Output your own commentary about what you researched
  - Wrap the document in any meta-narrative
The document IS your output. Begin it with "## Founding & History" and end it with the last entry under "## Sources".

ABSOLUTE FACTUAL RULES:

1. EVERY concrete fact must come from a Google Search result you actually retrieved. Do NOT supplement with general wine knowledge, generic regional context, or assumptions. If a section turns up nothing in search, write a single line: "No reliable information found from public sources." That is a useful signal, not a failure.

2. 500 well-sourced words beats 1500 padded words. The 1500 figure is a TARGET, not a quota. For wineries with limited online presence, write proportionally less. Do not fabricate texture to hit a word count.

3. No marketing language. Avoid words like "stunning", "passionate", "boutique", "world-class", "iconic" unless they appear in your source AND are attributed. Prefer concrete specifics: varietals, vintages, hectares, addresses, names.

4. If two sources conflict, note the conflict in the prose rather than picking one silently.

CITATION FORMAT — use exactly this style, no variations:

Reference sources using bracketed integers, e.g. [1] or [2] or [3]. Do NOT use the format [cite: 1, 2] or [^1] or (1) — only [1] style. Place a citation at the end of each sentence or claim that draws from a specific source. Reuse numbers when you re-cite the same source. The numbers map to the URLs you list in the final ## Sources section.

THE DOCUMENT (output begins below this line — produce these sections in this exact order):

## Founding & History
When was the winery established? By whom? Notable ownership transitions, founding story, significant milestones.

## People
Current owners, principal winemaker, key staff. Family generations if relevant. Background details if reported.

## Vineyard & Site
Hectares planted, elevation, aspect, soil type, varietals planted (and roughly when), farming approach (conventional, organic, biodynamic).

NOTE — DO NOT include a "Wines" section or any per-bottle / per-vintage / specific-cuvée tasting notes in this document. Wine-level data (varietals made, specific bottle names, vintages, tasting notes, scores, prices) is handled by a separate RAG pipeline. This research document is about the WINERY (history, people, vineyard, visiting experience, sustainability, distinctive character) — not the wines themselves. If you have something to say about general varietal focus or winemaking approach that's truly about the producer's philosophy rather than a specific bottle, fold it into the "Vineyard & Site" or "Notable / Distinctive" section instead. Do not output a "## Wines" header.

## Cellar Door Experience
Hours, walk-in vs by-appointment, tasting format, what a visit is like, what's distinctive.

## Food & Hospitality
Restaurant or kitchen if any, menu style or notable dishes, group capacity, separate events.

## Awards & Recognition
Specific awards, critic scores, Halliday ratings, notable mentions in wine media. Only specifics from sources, no generic "highly regarded".

## Sustainability & Certifications
Organic / biodynamic certification, sustainability practices, water/energy approach if reported.

## Visiting Practical Info
Address, distance from major town, phone, website, social, anything useful to a visitor planning a stop.

## Notable / Distinctive
What makes this winery genuinely different from others in the region? Quirks, stories, controversies, claims to fame.

## Sources
A numbered list mapping each [N] citation in the document above to its source URL and page title. One per line, in the exact format: "1. <Page title> — <URL>". List ALL distinct sources you cited; do not skip any.`;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtUsd(n) {
  if (n < 0.0001) return '<$0.0001';
  return `$${n.toFixed(4)}`;
}

// Pricing for gemini-2.5-flash with non-thinking config. Grounding
// costs are billed separately as ~$35/1000 grounded requests on most
// tiers; we'll surface the request count in the summary so you can
// estimate that side too. Confirm current rates at
// https://ai.google.dev/pricing.
const PRICING = {
  'gemini-2.5-flash':       { input: 0.075, output: 0.30 },
  'gemini-2.5-flash-lite':  { input: 0.04,  output: 0.15 },
  'gemini-2.5-pro':         { input: 1.25,  output: 10.00 },
};

function priceTurn(model, usage) {
  const p = PRICING[model];
  if (!p) return 0;
  const inUsd = ((usage.inputTokens || 0) / 1_000_000) * p.input;
  const outUsd = ((usage.outputTokens || 0) / 1_000_000) * p.output;
  return inUsd + outUsd;
}

// ─── Firestore ────────────────────────────────────────────────────────────────

async function loadWineries(opts) {
  const snap = await db
    .collection('wineries')
    .where('regionId', '==', opts.regionId)
    .get();

  let wineries = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Stable ordering so "first 5" is deterministic across runs.
  wineries.sort((a, b) => (a.slug || a.id).localeCompare(b.slug || b.id));

  if (opts.slugs && opts.slugs.length > 0) {
    const want = new Set(opts.slugs);
    wineries = wineries.filter(w => want.has(w.slug) || want.has(w.id));
    if (wineries.length !== opts.slugs.length) {
      const found = wineries.map(w => w.slug || w.id);
      const missing = opts.slugs.filter(s => !found.includes(s));
      console.warn(`⚠️  Could not find these slugs in Firestore: ${missing.join(', ')}`);
    }
  } else {
    wineries = wineries.slice(0, opts.limit);
  }
  return wineries;
}

// ─── Gemini grounded research ─────────────────────────────────────────────────

async function researchWinery(winery, opts) {
  const prompt = buildResearchPrompt(winery, opts.regionDisplay);
  const t0 = Date.now();

  // Note: we do NOT disable thinking here (unlike the concierge response
  // leg). Research benefits from the model reasoning across multiple
  // search results before producing a final document; the cost overhead
  // is small for a one-time setup script and we'd rather have higher-
  // quality synthesis. If you'd rather force speed/cost, add
  // thinkingConfig: { thinkingBudget: 0 } to the config below.
  const response = await ai.models.generateContent({
    model: opts.model,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.3,            // tight — we want fidelity, not creativity
      // 1500 words of prose ≈ 2000-2500 tokens. Add headers, citations,
      // and the Sources list and we're around 3500-4000. The previous
      // 4096 cap was burning out before the document finished when the
      // model occasionally tried to draft-then-rewrite. 12K is generous
      // headroom; the model only uses what it needs.
      maxOutputTokens: 12288,
    },
  });

  const elapsedMs = Date.now() - t0;
  const text = typeof response.text === 'function' ? response.text() : (response.text || '');

  // Pull grounding metadata. The first (and usually only) candidate
  // holds it on `groundingMetadata`. Web-source citations live under
  // `groundingChunks[].web`.
  const grounding = response.candidates?.[0]?.groundingMetadata || {};
  const searches = grounding.webSearchQueries || [];
  const chunks = grounding.groundingChunks || [];
  const webCitations = chunks
    .map(c => c.web)
    .filter(Boolean)
    .map(w => ({ uri: w.uri, title: w.title || '(no title)', domain: w.domain || null }));

  // Dedupe citations by URI — the same source page is often cited many
  // times across the document.
  const seen = new Set();
  const uniqueCitations = [];
  for (const c of webCitations) {
    if (!c.uri || seen.has(c.uri)) continue;
    seen.add(c.uri);
    uniqueCitations.push(c);
  }

  const usageMetadata = response.usageMetadata || {};
  const usage = {
    inputTokens: usageMetadata.promptTokenCount || 0,
    outputTokens: usageMetadata.candidatesTokenCount || 0,
  };

  return {
    text: String(text).trim(),
    searches,
    citations: uniqueCitations,
    usage,
    costUsd: priceTurn(opts.model, usage),
    elapsedMs,
  };
}

// ─── File output ──────────────────────────────────────────────────────────────

function renderMarkdown(winery, research, opts) {
  const lines = [];
  lines.push(`# ${winery.name || winery.id}`);
  lines.push('');
  lines.push(`> Auto-collected research material for the SipLocal source-grounded RAG pipeline.`);
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push(`> Model: \`${opts.model}\` with Google Search grounding`);
  lines.push(`> Winery slug: \`${winery.slug || winery.id}\``);
  if (winery.region) lines.push(`> Region: ${winery.region}`);
  if (winery.website) lines.push(`> Website on file: ${winery.website}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(research.text);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Grounding metadata');
  lines.push('');
  if (research.searches.length > 0) {
    lines.push(`**Searches Gemini ran:**`);
    lines.push('');
    for (const q of research.searches) lines.push(`- \`${q}\``);
    lines.push('');
  } else {
    lines.push('_(No search queries surfaced in grounding metadata — model may have answered without grounding, treat with extra scepticism.)_');
    lines.push('');
  }
  if (research.citations.length > 0) {
    lines.push(`**Sources Gemini grounded against** (${research.citations.length} unique URLs):`);
    lines.push('');
    research.citations.forEach((c, i) => {
      lines.push(`${i + 1}. [${c.title}](${c.uri})${c.domain ? ` — \`${c.domain}\`` : ''}`);
    });
    lines.push('');
  } else {
    lines.push('_(No web citations returned — this is unusual. Re-run with --force or try gemini-2.5-pro.)_');
    lines.push('');
  }
  lines.push('## Cost telemetry');
  lines.push('');
  lines.push(`- Input tokens: ${research.usage.inputTokens.toLocaleString()}`);
  lines.push(`- Output tokens: ${research.usage.outputTokens.toLocaleString()}`);
  lines.push(`- Estimated cost (text-tokens only — grounding billed separately): ${fmtUsd(research.costUsd)}`);
  lines.push(`- Latency: ${fmtMs(research.elapsedMs)}`);
  lines.push('');
  return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // Quick regionId → display-name lookup so the research prompt names the
  // region the same way the user would (e.g. "Tasmania" not "tasmania").
  // Falls back to a Title-Cased version of regionId if the doc is missing.
  let regionDisplay = opts.regionId.replace(/^./, c => c.toUpperCase());
  try {
    const regionDoc = await db.collection('regions').doc(opts.regionId).get();
    if (regionDoc.exists) regionDisplay = regionDoc.data().displayName || regionDisplay;
  } catch {}
  opts.regionDisplay = regionDisplay;

  ensureDir(opts.outDir);

  const wineries = await loadWineries(opts);
  if (wineries.length === 0) {
    console.error('❌ No wineries returned from Firestore. Check --region and --slugs values.');
    process.exit(1);
  }

  console.log(`\n🍷 SipLocal — source-collection script`);
  console.log(`   Model: ${opts.model} (with Google Search grounding)`);
  console.log(`   Region: ${regionDisplay} (id: ${opts.regionId})`);
  console.log(`   Wineries: ${wineries.length}`);
  console.log(`   Output dir: ${opts.outDir}\n`);

  let okCount = 0;
  let skipCount = 0;
  let errCount = 0;
  let totalCost = 0;
  let totalCitations = 0;

  for (let i = 0; i < wineries.length; i++) {
    const w = wineries[i];
    const slug = w.slug || w.id;
    const outPath = path.join(opts.outDir, `${slug}.md`);
    const exists = fs.existsSync(outPath);
    process.stdout.write(`  [${i + 1}/${wineries.length}] ${slug.padEnd(32)} `);

    if (exists && !opts.force) {
      console.log(`⏭  exists (pass --force to overwrite)`);
      skipCount++;
      continue;
    }

    try {
      const research = await researchWinery(w, opts);
      const md = renderMarkdown(w, research, opts);
      fs.writeFileSync(outPath, md, 'utf8');
      const wordCount = research.text.split(/\s+/).filter(Boolean).length;
      console.log(`✓ ${wordCount} words, ${research.citations.length} citations, ${fmtMs(research.elapsedMs)}, ${fmtUsd(research.costUsd)}`);
      okCount++;
      totalCost += research.costUsd;
      totalCitations += research.citations.length;

      // Be polite — don't hammer the API. Grounded calls can be slow on
      // their own, but a 1s buffer keeps us well under any rate limit
      // and gives the next request a clean slate.
      if (i < wineries.length - 1) await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.log(`✗ ${err.message}`);
      errCount++;
    }
  }

  console.log(`\n📊 Summary`);
  console.log(`   ✓ Written:  ${okCount}`);
  console.log(`   ⏭ Skipped:  ${skipCount} (already existed)`);
  console.log(`   ✗ Failed:   ${errCount}`);
  console.log(`   💰 Total cost (text tokens, excludes grounding fee): ${fmtUsd(totalCost)}`);
  console.log(`   🔗 Total unique citations gathered: ${totalCitations}`);
  console.log(`\n📂 Open ${opts.outDir} and read each .md file. Pay attention to:`);
  console.log(`   • Section depth — does it match the winery's real-world prominence?`);
  console.log(`   • Citation quality — click through a few links; do they actually support the claim?`);
  console.log(`   • Empty sections — "No reliable information found" is HONEST, not a failure.`);
  console.log(`   • The "Notable / Distinctive" section — is it editorial texture or generic filler?`);
  console.log(`\n🛠  If the prompt needs tightening, edit buildResearchPrompt() in this file and re-run with --force.\n`);
})().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
