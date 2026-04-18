// scripts/generate-descriptions.js
//
// Generates editorial winery descriptions + pull quotes for all Margaret River wineries.
// Replaces any existing description/pullQuote fields on Firestore winery documents.
//
// USAGE:
//   node scripts/generate-descriptions.js                         ← generate & save review files
//   node scripts/generate-descriptions.js --limit 3              ← process first 3 wineries only
//   node scripts/generate-descriptions.js --winery "Vasse Felix" ← single winery by name
//   node scripts/generate-descriptions.js --upload               ← upload latest review file to Firestore
//   node scripts/generate-descriptions.js --reset                ← clear progress file, start fresh
//
// FLOW (generate):
//   1. Fetch all wineries from Firestore
//   2. For each winery, try to scrape their About / Our Story page
//   3. If content is thin (<80 words), fall back to Claude web search
//   4. Generate 3-paragraph description + pull quote via Claude Sonnet
//   5. Save all results to scripts/review/ for human approval — nothing touches Firestore yet
//
// FLOW (upload):
//   1. Read the latest review JSON from scripts/review/
//   2. Batch-upload description + pullQuote to each Firestore winery document
//
// REQUIREMENTS:
//   - ANTHROPIC_API_KEY environment variable must be set
//   - service-account.json must be present in the project root

'use strict';

const admin     = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const fetch     = require('node-fetch');
const fs        = require('fs');
const path      = require('path');

// ─── Init ──────────────────────────────────────────────────────────────────────

const serviceAccount = require('../service-account.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY automatically

// ─── Config ────────────────────────────────────────────────────────────────────

const REVIEW_DIR        = path.join(__dirname, 'review');
const PROGRESS_FILE     = path.join(__dirname, 'descriptions-progress.json');
const DELAY_MS          = 2000;   // pause between wineries to respect rate limits
const FETCH_TIMEOUT_MS  = 8000;   // max wait per HTTP request
const MAX_CONTENT_CHARS = 6000;   // cap on scraped text passed to Claude
const MIN_USEFUL_WORDS  = 80;     // below this threshold, trigger web search fallback

// ─── Voice System Prompt ───────────────────────────────────────────────────────
//
// Derived from analysis of the author's own writing (fiction + academic essays).
// Core traits observed: economical, specific, direct, varied rhythm, understated
// emotion, confident judgment, no purple prose.

const VOICE_SYSTEM_PROMPT = `You are writing editorial descriptions for a premium wine tourism app covering the Margaret River wine region of Western Australia. Your job is to write short, intelligent, specific entries that give readers a genuine sense of each winery — without resorting to clichés, hollow adjectives, or the kind of overwrought prose that fills tourism brochures.

Here are examples of the writing style you must match. Study what is NOT in these passages as much as what is: no stacked adjectives, no breathless scene-setting, no metaphors doing the work that facts should do. The writing is grounded, specific, and earns its moments.

— PROSE EXAMPLE (scene-setting: grounded, particular, not ornate):
"Jacob walked over to the concession stand, grateful for the excuse to stretch his legs, and excited to watch the older kids play soccer. After this season he would be moving up. No more playing on the small fields, with their faded goalposts and fluorescent orange cones in place of sidelines. He was excited at the thought of leaving his younger teammates for the 14 and under division, but he still couldn't help but be nervous that the older boys wouldn't like him."

— PROSE EXAMPLE (emotional beat: understated, earns its weight):
"As Joshua stepped into his truck, Jacob choked up, and felt the weight of his responsibility as a brother take hold. He jogged over to the window and tapped on the glass."

— ANALYTICAL EXAMPLE (direct voice, confident judgment, no hedging):
"Too often authors like to focus on the sensationalist view of Huey Long. And why wouldn't they? The idea of one man having the ability to wield enormous power over the state is a fascinating tale. This tale is made all the better if the reader wants to participate in this idea that Long was an amoral, power hungry tyrant. In truth, Long himself participated in this sensationalizing of his own life during his campaign."

— ANALYTICAL EXAMPLE (plain, specific, fact-led, no inflation):
"Long's policies brought about progressive racial, educational, infrastructural, and healthcare reforms for the betterment of the common man, but the means he used to achieve these goals bring about Robert Warren's essential question: do these ends justify the means?"

WHAT THIS STYLE LOOKS LIKE IN PRACTICE FOR WINERY DESCRIPTIONS:
- Specific always beats vague. Name the grape variety, the vintage, the award, the founding year. One real detail is worth ten atmospheric sentences.
- Say it once, directly. Don't dress a simple fact in three adjectives when one will do.
- Short sentences land hardest. Mix them with longer ones for rhythm — but never write extended clause-stacking constructions.
- Earn any atmospheric moment with a single precise image. Then move on. Do not linger.
- Let facts carry emotional weight. Don't tell the reader how to feel.
- End each paragraph with a sentence that lands cleanly and has some finality to it.
- The pull quote should sound like something a knowledgeable wine person would actually say out loud — not a tagline, not a slogan, not aspirational marketing copy.

BANNED PHRASES AND APPROACHES — do not use these under any circumstances:
- "nestled among", "rolling hills", "sun-drenched", "world-class", "passion for winemaking"
- "journey", "tapestry", "testament to", "carefully crafted", "boutique"
- "steeped in tradition", "set against the backdrop of", "where the land meets the sea"
- "boasts" (meaning "has"), "liquid poetry", "art of winemaking"
- Generic openers about the landscape before saying anything specific about the winery
- Hollow compliments that could apply to any winery anywhere`;

// ─── Helpers ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function countWords(text) {
  return (text || '').split(/\s+/).filter(Boolean).length;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONTENT_CHARS);
}

function resolveUrl(base, href) {
  try { return new URL(href, base).toString(); }
  catch { return null; }
}

async function fetchRaw(url) {
  if (!url) return null;
  const withProtocol = url.startsWith('http') ? url.trim() : `https://${url.trim()}`;
  try {
    const res = await Promise.race([
      fetch(withProtocol, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WineryGuideBot/1.0)' },
        redirect: 'follow',
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), FETCH_TIMEOUT_MS)
      ),
    ]);
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

// ─── Website Scraper ───────────────────────────────────────────────────────────

/**
 * Fetches the best available text content from a winery's website.
 * Priority: About/Our Story page found via homepage links → common URL paths → homepage fallback.
 */
async function scrapeWineryContent(website) {
  if (!website || website === 'N/A' || website.trim() === '') return null;

  const baseUrl = website.startsWith('http') ? website.trim() : `https://${website.trim()}`;

  // Step 1: fetch homepage HTML for link-parsing
  const homepageHtml = await fetchRaw(baseUrl);
  if (!homepageHtml) return null;

  // Step 2: find links that look like About / Our Story pages
  const aboutKeywords = /about|our-story|our-winery|story|history|who-we-are|the-winery|heritage/i;
  const hrefRegex = /href="([^"#]*)"/gi;
  const foundLinks = [];
  let m;
  while ((m = hrefRegex.exec(homepageHtml)) !== null) {
    const href = m[1];
    if (aboutKeywords.test(href)) {
      const resolved = resolveUrl(baseUrl, href);
      if (resolved && resolved.startsWith('http') && !foundLinks.includes(resolved)) {
        foundLinks.push(resolved);
      }
    }
  }

  for (const url of foundLinks.slice(0, 3)) {
    const html = await fetchRaw(url);
    if (!html) continue;
    const text = stripHtml(html);
    if (countWords(text) >= MIN_USEFUL_WORDS) return text;
  }

  // Step 3: try common path patterns
  const commonPaths = ['/about', '/about-us', '/our-story', '/story', '/history', '/the-winery', '/winery'];
  for (const p of commonPaths) {
    const fullUrl = baseUrl.replace(/\/$/, '') + p;
    if (foundLinks.includes(fullUrl)) continue; // already tried above
    const html = await fetchRaw(fullUrl);
    if (!html) continue;
    const text = stripHtml(html);
    if (countWords(text) >= MIN_USEFUL_WORDS) return text;
  }

  // Step 4: fall back to homepage body text
  const homepageText = stripHtml(homepageHtml);
  return countWords(homepageText) >= MIN_USEFUL_WORDS ? homepageText : null;
}

// ─── Claude Web Search Fallback ────────────────────────────────────────────────

/**
 * Uses Claude with web search enabled to gather research on a winery from external sources.
 * Gracefully returns null if web search is unavailable or returns too little content.
 *
 * Requires Anthropic web search tool (web_search_20250305).
 * Fails silently so the caller can fall through to general knowledge mode.
 */
async function researchWithWebSearch(wineryName) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for information about ${wineryName} winery in Margaret River, Western Australia. Find facts about: their founding story and year, winemaking philosophy and style, signature or notable wines, any awards or critical recognition, what makes them distinctive among Margaret River producers, and what visitors can expect on-site. Check wine review sites, tourism directories, regional press, and wine publications. Give me a factual summary of what you find.`,
      }],
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    return countWords(text) >= MIN_USEFUL_WORDS ? text : null;
  } catch {
    return null; // web search unavailable — caller falls through to general knowledge
  }
}

// ─── Claude Generation ─────────────────────────────────────────────────────────

function buildPrompt(winery, sourceContent, sourceType) {
  const facts = [
    winery.rating        ? `Google rating: ${winery.rating}/5.0 (${(winery.userRatingsTotal || 0).toLocaleString()} reviews)` : null,
    winery.hours         ? `Hours: ${winery.hours}`       : null,
    winery.dogFriendly   ? 'Dog friendly'                 : null,
    winery.hasRestaurant ? 'Has on-site restaurant'       : null,
    winery.isOrganic     ? 'Certified organic'            : null,
    winery.isBiodynamic  ? 'Biodynamic'                   : null,
    winery.walkinWelcome ? 'Walk-ins welcome'             : null,
  ].filter(Boolean);

  const sourceLabel = {
    website: 'Content scraped from their website',
    search:  'Research gathered via web search',
    general: 'No website content available — use your general knowledge of this winery and the Margaret River region',
  }[sourceType] || 'Source unknown';

  const sourceSection = sourceContent
    ? `${sourceLabel}:\n"""\n${sourceContent}\n"""`
    : sourceLabel;

  return `Write an editorial entry for ${winery.name}, a winery in the Margaret River region of Western Australia.
${facts.length > 0 ? `\nKnown facts:\n${facts.map(f => `- ${f}`).join('\n')}` : ''}

${sourceSection}

─────────────────────────────────────────────────────────────

Your output must be valid JSON with exactly two fields: "description" and "pullQuote".

DESCRIPTION — a JSON array of exactly 3 strings (paragraphs). Combined word count: 300–400 words.

  Paragraph 1 — THE PLACE: Ground the reader in something specific about this winery. What is the character of the property? What makes the experience there distinct from the moment of arrival? This paragraph will be displayed in large italic Georgia typeface as the editorial lede, so it must hold up to that treatment. Do not open generically. Do not lead with a landscape description. Start with something real and particular to this place.

  Paragraph 2 — THE WINES: What do they make? Be specific: name grape varieties, wine styles, notable bottles or vintages, any awards or critical scores. Describe their winemaking approach — minimalist, terroir-driven, experimental, traditional? Mention organic or biodynamic credentials where applicable. If you lack specifics, describe what the style suggests honestly rather than inventing details.

  Paragraph 3 — THE STORY: Founding history, what gives this winery its particular identity in Margaret River. Notable milestones, the people behind it, what makes it significant in the region. Close with one concrete reason a visitor should make the trip.

PULL_QUOTE — a single sentence under 20 words. Should sound like an informed opinion from someone who actually knows these wines — not marketing copy, not a slogan.

Return ONLY this JSON. No markdown fences, no explanation, no extra text:
{
  "description": ["paragraph one", "paragraph two", "paragraph three"],
  "pullQuote": "A sentence here."
}`;
}

async function generateForWinery(winery, sourceContent, sourceType) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1400,
    system: VOICE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPrompt(winery, sourceContent, sourceType) }],
  });

  const raw = response.content[0].text.trim();
  const cleaned = raw
    .replace(/^```json\n?/, '')
    .replace(/^```\n?/, '')
    .replace(/```$/, '')
    .replace(/,\s*([}\]])/g, '$1') // strip trailing commas
    .trim();

  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed.description) || parsed.description.length < 3) {
    throw new Error(`Invalid description shape — got ${parsed.description?.length ?? 'none'} paragraphs, expected 3`);
  }
  if (typeof parsed.pullQuote !== 'string' || !parsed.pullQuote.trim()) {
    throw new Error('Missing or empty pullQuote in response');
  }

  return parsed;
}

// ─── Progress Tracking ─────────────────────────────────────────────────────────

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

// ─── Review Files ──────────────────────────────────────────────────────────────

function ensureReviewDir() {
  if (!fs.existsSync(REVIEW_DIR)) fs.mkdirSync(REVIEW_DIR, { recursive: true });
}

function saveReviewFiles(results) {
  ensureReviewDir();

  const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonPath = path.join(REVIEW_DIR, `descriptions-${ts}.json`);
  const mdPath   = path.join(REVIEW_DIR, `descriptions-${ts}.md`);

  // JSON — consumed by --upload
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

  // Markdown — human-readable review document
  const avgWords = Math.round(
    results.reduce((sum, r) => sum + countWords(r.description.join(' ')), 0) / results.length
  );

  const md = [
    `# Winery Descriptions — Review`,
    ``,
    `**Generated:** ${new Date().toLocaleString()}`,
    `**Wineries:** ${results.length}  ·  **Avg words:** ${avgWords}`,
    ``,
    `Once you're happy with these, run:`,
    `\`\`\``,
    `node scripts/generate-descriptions.js --upload`,
    `\`\`\``,
    ``,
    `---`,
    ``,
    ...results.map(r => {
      const words = countWords(r.description.join(' '));
      return [
        `## ${r.name}`,
        ``,
        `**Source:** ${r.sourceType}  ·  **Words:** ${words}  ·  **ID:** \`${r.id}\``,
        ``,
        `**Pull Quote:**`,
        `> ${r.pullQuote}`,
        ``,
        `**¶1 — The Place:**`,
        r.description[0],
        ``,
        `**¶2 — The Wines:**`,
        r.description[1],
        ``,
        `**¶3 — The Story:**`,
        r.description[2],
        ``,
        `---`,
        ``,
      ].join('\n');
    }),
  ].join('\n');

  fs.writeFileSync(mdPath, md);
  return { jsonPath, mdPath };
}

function getLatestReviewJson() {
  ensureReviewDir();
  const files = fs.readdirSync(REVIEW_DIR)
    .filter(f => f.startsWith('descriptions-') && f.endsWith('.json'))
    .sort()
    .reverse();
  return files.length > 0 ? path.join(REVIEW_DIR, files[0]) : null;
}

// ─── Generate ──────────────────────────────────────────────────────────────────

async function runGenerate({ limit, wineryFilter }) {
  console.log('\n🍷  Winery Description Generator');
  console.log('─────────────────────────────────────');
  if (limit)        console.log(`📏  Limit: first ${limit} wineries`);
  if (wineryFilter) console.log(`🔍  Filter: "${wineryFilter}"`);
  console.log('');

  console.log('📡  Fetching wineries from Firestore...');
  const snapshot = await db.collection('wineries').get();
  let wineries = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (wineryFilter) {
    wineries = wineries.filter(w => w.name.toLowerCase().includes(wineryFilter.toLowerCase()));
  }
  if (limit) wineries = wineries.slice(0, limit);

  console.log(`📋  ${wineries.length} winer${wineries.length === 1 ? 'y' : 'ies'} to process\n`);

  const progress = loadProgress();
  const results  = [];
  let completed = 0, skipped = 0, failed = 0;

  for (const winery of wineries) {
    // Skip already-completed wineries unless a specific --winery filter is active
    if (!wineryFilter && progress[winery.id]?.done) {
      console.log(`⏭️   ${winery.name} — already done`);
      skipped++;
      continue;
    }

    console.log(`\n📍  ${winery.name}`);

    // ── 1. Scrape website ──────────────────────────────────────────────────────
    let sourceContent = null;
    let sourceType    = 'general';

    process.stdout.write('    🌐  Scraping website...         ');
    const scraped = await scrapeWineryContent(winery.website);
    if (scraped && countWords(scraped) >= MIN_USEFUL_WORDS) {
      sourceContent = scraped;
      sourceType    = 'website';
      console.log(`✅  ${countWords(scraped)} words`);
    } else {
      console.log('⚠️   thin or unavailable');
    }

    // ── 2. Web search fallback ─────────────────────────────────────────────────
    if (!sourceContent) {
      process.stdout.write('    🔍  Web search via Claude...    ');
      const searched = await researchWithWebSearch(winery.name);
      if (searched && countWords(searched) >= MIN_USEFUL_WORDS) {
        sourceContent = searched;
        sourceType    = 'search';
        console.log(`✅  ${countWords(searched)} words`);
      } else {
        console.log('⚠️   no results — using general knowledge');
        sourceType = 'general';
      }
    }

    // ── 3. Generate ────────────────────────────────────────────────────────────
    process.stdout.write('    ✍️   Generating with Claude...   ');
    try {
      const result    = await generateForWinery(winery, sourceContent, sourceType);
      const wordCount = countWords(result.description.join(' '));

      console.log(`✅  ${wordCount} words [source: ${sourceType}]`);
      console.log(`    💬  "${result.pullQuote}"`);

      results.push({
        id:          winery.id,
        slug:        winery.slug || winery.id,
        name:        winery.name,
        sourceType,
        description: result.description,
        pullQuote:   result.pullQuote,
      });

      progress[winery.id] = { done: true, name: winery.name };
      saveProgress(progress);
      completed++;
    } catch (err) {
      console.log(`❌  ${err.message}`);
      progress[winery.id] = { done: false, error: err.message, name: winery.name };
      saveProgress(progress);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────');
  console.log(`✅  Completed: ${completed}`);
  if (skipped > 0) console.log(`⏭️   Skipped:   ${skipped}  (run --reset to regenerate)`);
  if (failed > 0)  console.log(`❌  Failed:    ${failed}  (re-run to retry)`);

  if (results.length > 0) {
    const { jsonPath, mdPath } = saveReviewFiles(results);
    console.log(`\n📄  Review file: ${path.relative(process.cwd(), mdPath)}`);
    console.log(`📦  JSON file:   ${path.relative(process.cwd(), jsonPath)}`);
    console.log('\n👉  Check the review file, then run:');
    console.log('    node scripts/generate-descriptions.js --upload\n');
  } else {
    console.log('\n⚠️   Nothing new to save.\n');
  }
}

// ─── Upload ────────────────────────────────────────────────────────────────────

async function runUpload() {
  console.log('\n🚀  Uploading descriptions to Firestore...');
  console.log('──────────────────────────────────────────────');

  const reviewFile = getLatestReviewJson();
  if (!reviewFile) {
    console.error('❌  No review file found in scripts/review/');
    console.error('    Run without --upload first to generate descriptions.');
    process.exit(1);
  }

  console.log(`📂  File: ${path.relative(process.cwd(), reviewFile)}\n`);
  const results = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));

  let uploaded = 0, failed = 0;

  for (const item of results) {
    process.stdout.write(`    📤  ${item.name}... `);
    try {
      await db.collection('wineries').doc(item.id).update({
        description: item.description,
        pullQuote:   item.pullQuote,
      });
      console.log('✅');
      uploaded++;
    } catch (err) {
      console.log(`❌  ${err.message}`);
      failed++;
    }
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(`✅  Uploaded: ${uploaded}`);
  if (failed > 0) console.log(`❌  Failed:   ${failed}`);
  if (uploaded > 0) console.log('\n🎉  Descriptions are live in Firestore!\n');
}

// ─── Entry ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--reset')) {
    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
      console.log('✅  Progress cleared. Run again without --reset to regenerate all wineries.');
    } else {
      console.log('ℹ️   No progress file found — nothing to clear.');
    }
    process.exit(0);
  }

  if (args.includes('--upload')) {
    await runUpload();
    process.exit(0);
  }

  const limitIdx     = args.indexOf('--limit');
  const wineryIdx    = args.indexOf('--winery');
  const limit        = limitIdx  !== -1 ? parseInt(args[limitIdx  + 1], 10) : null;
  const wineryFilter = wineryIdx !== -1 ? args[wineryIdx + 1] : null;

  await runGenerate({ limit, wineryFilter });
  process.exit(0);
}

main().catch(err => {
  console.error('\n💥  Fatal error:', err.message);
  process.exit(1);
});
