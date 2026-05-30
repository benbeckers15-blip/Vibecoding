// scripts/audit-winery-sources.js
// ─────────────────────────────────────────────────────────────────────────────
// Health-check pass over the markdown files produced by
// scripts/collect-winery-sources.js. Reads every .md in
// scripts/winery-sources/, computes per-file metrics, surfaces
// red-flag files, and emits a single audit report you can read in
// two minutes instead of opening 73 files.
//
// WHAT IT DETECTS:
//
//   • Word count of the actual research prose (excludes the
//     "Grounding metadata" + "Cost telemetry" footer added by the
//     collector script — those would otherwise inflate counts).
//   • Number of inline [N] citation references in the prose.
//   • Number of source URLs in the ## Sources section.
//   • Which of the 11 expected sections are present, populated, or
//     marked as "No reliable information found".
//   • Red flags:
//       - duplicate section headers (the bug we fixed; would resurface
//         if Gemini regresses)
//       - very short files (< 250 words — possible script failure or
//         extremely sparse winery)
//       - zero citations (grounding didn't fire or returned nothing)
//       - missing the ## Sources list at the end (truncation)
//       - >5 empty sections (winery has thin online presence — useful
//         to know before we build on top of it)
//
// USAGE:
//   # Stdout summary (quick scan)
//   node scripts/audit-winery-sources.js
//
//   # Markdown report written to disk for sharing
//   node scripts/audit-winery-sources.js --out audit-report.md
//
//   # Only show files with red flags
//   node scripts/audit-winery-sources.js --flagged-only
//
//   # Different source dir
//   node scripts/audit-winery-sources.js --dir path/to/sources
//
// WHAT TO DO WITH THE OUTPUT:
//
//   • Files in the red-flag list → spot-check manually; if they're
//     genuinely thin-presence wineries that's fine, if they're script
//     failures re-run `collect-winery-sources.js --slugs <slug> --force`.
//   • Section coverage stats → tell you which sections are reliably
//     populated across the corpus (useful for deciding which sections
//     to ALWAYS chunk for the RAG vs. which to skip).
//   • Word count + citation distribution → confirms you have a realistic
//     spread (some thin, most healthy, none truncated).
//
// This script doesn't write to Firestore or call any APIs — purely
// local file inspection. Safe to run repeatedly.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ─── Config ────────────────────────────────────────────────────────────────────

// Sections we expect every cleaned source file to have. "Wines" used
// to be here but was intentionally removed — bottle-level data lives
// in a separate RAG pipeline (the `wines` Upstash namespace), and
// strip-citations.js removes the "## Wines" section from every file
// by default. The collector prompt has been updated to skip it too.
// If a Wines section is found in a file, that's now a regression
// worth investigating, not an expected state.
const EXPECTED_SECTIONS = [
  'Founding & History',
  'People',
  'Vineyard & Site',
  'Cellar Door Experience',
  'Food & Hospitality',
  'Awards & Recognition',
  'Sustainability & Certifications',
  'Visiting Practical Info',
  'Notable / Distinctive',
  'Sources',
];

const NO_INFO_MARKER = /no reliable information found from public sources/i;

// ─── Args ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    dir: path.resolve(__dirname, 'winery-sources'),
    out: null,
    flaggedOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' && argv[i + 1]) out.dir = path.resolve(argv[++i]);
    else if (a === '--out' && argv[i + 1]) out.out = path.resolve(argv[++i]);
    else if (a === '--flagged-only') out.flaggedOnly = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/audit-winery-sources.js [--dir PATH] [--out PATH] [--flagged-only]');
      process.exit(0);
    }
  }
  return out;
}

// ─── File analysis ─────────────────────────────────────────────────────────────

/**
 * Pull the prose body (between the first `---` after the front-matter
 * and the trailing "## Grounding metadata" footer). This is what we
 * actually want to measure — the rest is collector-added telemetry
 * that would distort word counts and section detection.
 */
function extractProseBody(text) {
  // Find the first `---` line after the header block.
  const firstDivider = text.indexOf('\n---\n');
  if (firstDivider === -1) return text;
  const afterHeader = text.slice(firstDivider + 5);

  // The collector script appends a `## Grounding metadata` footer at
  // the end, preceded by another `---`. Strip from that divider to EOF.
  const footerDivider = afterHeader.lastIndexOf('\n---\n');
  if (footerDivider === -1) return afterHeader;
  return afterHeader.slice(0, footerDivider);
}

function countWords(s) {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Find every `## <section>` heading in the prose body. Returns an array
 * of { name, contentLength, isEmpty } in the order they appear.
 *
 * `isEmpty` means the section consists ONLY of the "no reliable
 * information found" marker (or nothing) — i.e. the model honestly
 * reported it had nothing to say. That's different from `missing`,
 * which means the section header doesn't appear at all.
 */
function analyseSections(prose) {
  const lines = prose.split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^## (.+)$/);
    if (m) {
      if (current) sections.push(current);
      current = { name: m[1].trim(), content: '' };
    } else if (current) {
      current.content += line + '\n';
    }
  }
  if (current) sections.push(current);

  return sections.map(s => {
    const trimmed = s.content.trim();
    const wordCount = countWords(trimmed);
    const isEmpty = wordCount === 0 || NO_INFO_MARKER.test(trimmed);
    return {
      name: s.name,
      wordCount,
      isEmpty,
      duplicate: false, // filled in below
    };
  });
}

function flagDuplicateSections(sections) {
  const seen = new Set();
  for (const s of sections) {
    if (seen.has(s.name)) s.duplicate = true;
    else seen.add(s.name);
  }
}

function findInlineCitations(prose) {
  // Match [N] where N is one or more digits, but NOT inside ## Sources
  // (where they're list items, not in-text citations). Easy proxy:
  // strip everything from the `## Sources` heading onwards.
  const sourcesIdx = prose.indexOf('## Sources');
  const body = sourcesIdx >= 0 ? prose.slice(0, sourcesIdx) : prose;
  const matches = body.match(/\[\d+\]/g) || [];
  const unique = new Set(matches);
  return { total: matches.length, unique: unique.size };
}

function countSourcesListEntries(prose) {
  const sourcesIdx = prose.indexOf('## Sources');
  if (sourcesIdx === -1) return 0;
  const sourcesBlock = prose.slice(sourcesIdx);
  // A "1. " or "12. " at the start of a line counts as an entry.
  const entries = sourcesBlock.match(/^\d+\.\s/gm) || [];
  return entries.length;
}

function auditFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const slug = path.basename(filePath, '.md');
  const prose = extractProseBody(text);
  const wordCount = countWords(prose);
  const sections = analyseSections(prose);
  flagDuplicateSections(sections);

  const presentNames = new Set(sections.map(s => s.name));
  const missing = EXPECTED_SECTIONS.filter(n => !presentNames.has(n));
  const empty = sections.filter(s => s.isEmpty && !s.duplicate);
  const duplicates = sections.filter(s => s.duplicate);
  const populated = sections.filter(s => !s.isEmpty && !s.duplicate);

  const citations = findInlineCitations(prose);
  const sourceEntries = countSourcesListEntries(prose);

  // Red flags — heuristics, not verdicts.
  const flags = [];
  if (wordCount < 250) flags.push(`short:${wordCount}w`);
  if (citations.total === 0) flags.push('no-citations');
  if (sourceEntries === 0) flags.push('no-sources-list');
  if (duplicates.length > 0) flags.push(`duplicates:${duplicates.length}`);
  if (missing.length > 2) flags.push(`missing-sections:${missing.length}`);
  if (empty.length > 5) flags.push(`mostly-empty:${empty.length}`);
  // Truncation indicators — common patterns when the model got cut off
  if (/\[cite:\s*\d+,?\s*\d*,?\s*$/m.test(prose)) flags.push('truncated-cite');
  if (/[a-z],\s*$/m.test(prose.trim().split('\n').slice(-3).join('\n'))) flags.push('truncated-end');

  return {
    slug,
    wordCount,
    citationsInline: citations.total,
    citationsUnique: citations.unique,
    sourceEntries,
    sectionsPopulated: populated.length,
    sectionsEmpty: empty.length,
    sectionsMissing: missing,
    sectionsDuplicate: duplicates.map(d => d.name),
    flags,
    sections,
  };
}

// ─── Aggregate stats ───────────────────────────────────────────────────────────

function buildAggregate(audits) {
  const wordCounts = audits.map(a => a.wordCount).sort((a, b) => a - b);
  const citationCounts = audits.map(a => a.citationsUnique).sort((a, b) => a - b);
  const sectionPopulation = {};
  for (const name of EXPECTED_SECTIONS) sectionPopulation[name] = { populated: 0, empty: 0, missing: 0 };
  for (const a of audits) {
    const presentNames = new Set(a.sections.map(s => s.name));
    for (const name of EXPECTED_SECTIONS) {
      if (!presentNames.has(name)) {
        sectionPopulation[name].missing++;
      } else {
        const sec = a.sections.find(s => s.name === name);
        if (sec.isEmpty) sectionPopulation[name].empty++;
        else sectionPopulation[name].populated++;
      }
    }
  }
  return {
    fileCount: audits.length,
    totalWords: audits.reduce((s, a) => s + a.wordCount, 0),
    totalUniqueCitations: audits.reduce((s, a) => s + a.citationsUnique, 0),
    wordCountMedian: median(wordCounts),
    wordCountMin: wordCounts[0] ?? 0,
    wordCountMax: wordCounts[wordCounts.length - 1] ?? 0,
    citationMedian: median(citationCounts),
    citationMin: citationCounts[0] ?? 0,
    citationMax: citationCounts[citationCounts.length - 1] ?? 0,
    flaggedCount: audits.filter(a => a.flags.length > 0).length,
    sectionPopulation,
  };
}

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function bucketHistogram(values, buckets) {
  const counts = buckets.map(() => 0);
  for (const v of values) {
    for (let i = 0; i < buckets.length; i++) {
      const [lo, hi] = buckets[i];
      if (v >= lo && v <= hi) { counts[i]++; break; }
    }
  }
  return counts;
}

// ─── Report rendering ─────────────────────────────────────────────────────────

function renderReport(audits, args) {
  const agg = buildAggregate(audits);
  const lines = [];
  lines.push('# Winery Sources — Audit Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Source dir: \`${args.dir}\``);
  lines.push('');
  lines.push('## Headline numbers');
  lines.push('');
  lines.push(`- **Files audited:** ${agg.fileCount}`);
  lines.push(`- **Total prose words:** ${agg.totalWords.toLocaleString()}`);
  lines.push(`- **Total unique citations across the corpus:** ${agg.totalUniqueCitations.toLocaleString()}`);
  lines.push(`- **Word count per winery:** median ${agg.wordCountMedian}, range ${agg.wordCountMin}–${agg.wordCountMax}`);
  lines.push(`- **Unique citations per winery:** median ${agg.citationMedian}, range ${agg.citationMin}–${agg.citationMax}`);
  lines.push(`- **Files with at least one red flag:** ${agg.flaggedCount} of ${agg.fileCount} (${Math.round(agg.flaggedCount / Math.max(1, agg.fileCount) * 100)}%)`);
  lines.push('');

  // Word count distribution
  const wordBuckets = [
    [0, 249], [250, 499], [500, 999], [1000, 1499], [1500, 2499], [2500, 9999],
  ];
  const wordCounts = bucketHistogram(audits.map(a => a.wordCount), wordBuckets);
  lines.push('## Word count distribution');
  lines.push('');
  lines.push('| Range | Count | Bar |');
  lines.push('|---|---:|---|');
  const maxBar = 30;
  const maxCount = Math.max(...wordCounts, 1);
  for (let i = 0; i < wordBuckets.length; i++) {
    const [lo, hi] = wordBuckets[i];
    const label = hi >= 9999 ? `${lo}+` : `${lo}–${hi}`;
    const bar = '█'.repeat(Math.round((wordCounts[i] / maxCount) * maxBar));
    lines.push(`| ${label} | ${wordCounts[i]} | ${bar} |`);
  }
  lines.push('');

  // Section population
  lines.push('## Section coverage');
  lines.push('');
  lines.push('How many wineries have populated content for each expected section. "Empty" means the section header exists but the body is "No reliable information found" or blank (model honestly reported having nothing) — not a failure, just signal.');
  lines.push('');
  lines.push('| Section | Populated | Empty | Missing |');
  lines.push('|---|---:|---:|---:|');
  for (const name of EXPECTED_SECTIONS) {
    const s = agg.sectionPopulation[name];
    lines.push(`| ${name} | ${s.populated} | ${s.empty} | ${s.missing} |`);
  }
  lines.push('');

  // Flagged files
  const flagged = audits.filter(a => a.flags.length > 0);
  if (flagged.length > 0) {
    lines.push(`## 🚩 Flagged files (${flagged.length})`);
    lines.push('');
    lines.push('Flags are heuristics, not failures. Inspect manually before deciding to re-run. Common interpretations:');
    lines.push('- `short:Nw` — file under 250 words. Either a tiny-presence winery (fine) OR a script failure (re-run with `--force --slugs <slug>`).');
    lines.push('- `no-citations` / `no-sources-list` — grounding didn\'t fire; re-run.');
    lines.push('- `duplicates:N` — Gemini wrote a section twice. The prompt fix should prevent this; re-run with `--force`.');
    lines.push('- `missing-sections:N` — model skipped sections. Often fine for tiny wineries; problem if a well-known winery shows this.');
    lines.push('- `mostly-empty:N` — many "No reliable information found" sections. Genuine signal that this winery has limited online presence.');
    lines.push('- `truncated-cite` / `truncated-end` — model got cut off mid-sentence. Re-run with `--force`.');
    lines.push('');
    lines.push('| Slug | Words | Citations | Sources | Sections (pop/empty/missing) | Flags |');
    lines.push('|---|---:|---:|---:|---|---|');
    flagged
      .sort((a, b) => b.flags.length - a.flags.length || a.wordCount - b.wordCount)
      .forEach(a => {
        const sec = `${a.sectionsPopulated}/${a.sectionsEmpty}/${a.sectionsMissing.length}`;
        lines.push(`| \`${a.slug}\` | ${a.wordCount} | ${a.citationsInline} (${a.citationsUnique} unique) | ${a.sourceEntries} | ${sec} | ${a.flags.join(', ')} |`);
      });
    lines.push('');
  } else {
    lines.push('## ✅ No red flags');
    lines.push('');
    lines.push('Every file passed all heuristic checks. Still worth spot-checking a few manually for prose quality and citation accuracy.');
    lines.push('');
  }

  // Full file table (skip if --flagged-only)
  if (!args.flaggedOnly) {
    lines.push('## All files (sorted by word count, ascending)');
    lines.push('');
    lines.push('Shortest first — that\'s where script failures or genuinely-thin-presence wineries surface.');
    lines.push('');
    lines.push('| Slug | Words | Citations | Sources | Sections (pop/empty/missing) | Flags |');
    lines.push('|---|---:|---:|---:|---|---|');
    audits
      .slice()
      .sort((a, b) => a.wordCount - b.wordCount)
      .forEach(a => {
        const sec = `${a.sectionsPopulated}/${a.sectionsEmpty}/${a.sectionsMissing.length}`;
        const flagStr = a.flags.length > 0 ? `🚩 ${a.flags.join(', ')}` : '';
        lines.push(`| \`${a.slug}\` | ${a.wordCount} | ${a.citationsInline} (${a.citationsUnique} unique) | ${a.sourceEntries} | ${sec} | ${flagStr} |`);
      });
    lines.push('');
  }

  lines.push('## What to do next');
  lines.push('');
  lines.push('1. **Look at the flagged-files table.** For each, decide: is this a tiny winery with genuinely thin online presence (leave it), or is it a script failure (re-run with `node --env-file=.env scripts/collect-winery-sources.js --slugs <slug> --force`)?');
  lines.push('2. **Spot-check 3-5 healthy files** manually for prose quality, citation accuracy, and editorial texture. The audit can\'t judge prose; only you can.');
  lines.push('3. **Note any sections with low population rates** in the section-coverage table. If "Awards & Recognition" is empty in 60+ files, you might want to drop it from the expected list OR enrich those wineries with manual research.');
  lines.push('4. **When you\'re satisfied with the corpus quality, the next pipeline step is chunking + embedding** into a new Upstash namespace. That\'s the next script to build.');
  return lines.join('\n');
}

// ─── stdout summary (always rendered) ─────────────────────────────────────────

function printStdoutSummary(audits, args) {
  const agg = buildAggregate(audits);
  console.log(`\n📋 Audited ${agg.fileCount} winery source files in ${args.dir}\n`);
  console.log(`   Words per winery:      median ${agg.wordCountMedian}, range ${agg.wordCountMin}–${agg.wordCountMax}`);
  console.log(`   Citations per winery:  median ${agg.citationMedian}, range ${agg.citationMin}–${agg.citationMax}`);
  console.log(`   Total prose words:     ${agg.totalWords.toLocaleString()}`);
  console.log(`   Flagged files:         ${agg.flaggedCount} of ${agg.fileCount}\n`);

  const flagged = audits.filter(a => a.flags.length > 0);
  if (flagged.length > 0) {
    console.log(`🚩 Flagged files (review before building on top of them):\n`);
    flagged
      .sort((a, b) => b.flags.length - a.flags.length || a.wordCount - b.wordCount)
      .forEach(a => {
        console.log(`   ${a.slug.padEnd(36)} ${String(a.wordCount).padStart(5)}w  ${a.flags.join(', ')}`);
      });
    console.log('');
  } else {
    console.log(`✅ No files flagged — but still spot-check a few for prose quality.\n`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.dir)) {
    console.error(`❌ Source dir does not exist: ${args.dir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(args.dir).filter(f => f.endsWith('.md'));
  if (files.length === 0) {
    console.error(`❌ No .md files in ${args.dir}`);
    process.exit(1);
  }

  const audits = files.map(f => auditFile(path.join(args.dir, f)));

  printStdoutSummary(audits, args);

  if (args.out) {
    const md = renderReport(audits, args);
    fs.writeFileSync(args.out, md, 'utf8');
    console.log(`📝 Detailed report → ${args.out}\n`);
  } else {
    console.log(`💡 Pass --out audit-report.md to write a detailed markdown report.\n`);
  }
})().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
