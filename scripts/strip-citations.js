// scripts/strip-citations.js
// ─────────────────────────────────────────────────────────────────────────────
// Local-only cleanup pass over the winery source .md files. No API
// calls, no cost. Does TWO things to the prose body:
//
//   1. Strips inline citation markers (in any common format).
//   2. Removes named sections entirely (default: the "Wines" section).
//
// WHY STRIP INLINE CITATIONS:
//   Inline per-sentence citations ([1], [cite: 3, 4], etc.) aren't needed
//   for the RAG architecture. What matters is that each chunk we feed to
//   the concierge is grounded in a known set of sources for that winery
//   — the per-winery Sources list at the bottom of each file already
//   serves that purpose. The inline markers just add visual noise and
//   make the prose harder to read.
//
// WHY REMOVE THE "WINES" SECTION:
//   SipLocal has a separate RAG pipeline (`wines` Upstash namespace,
//   populated by scripts/rag/ingest-tasting-notes.js) that holds
//   structured per-bottle tasting metadata — varietals, vintages,
//   tasting notes, etc. — for the wines a winery makes. The "## Wines"
//   section in the source files duplicates that information and would
//   add noisy retrieval hits to the source-grounded namespace. Removing
//   it keeps each pipeline cleanly scoped: source files describe the
//   WINERY (history, people, site, visiting); the wines namespace
//   describes the WINE.
//
//   You can override which sections get removed via --remove-sections
//   "Name1,Name2" if you decide differently later.
//
//   This script PRESERVES:
//     • The front-matter header at the top
//     • The full prose body (minus inline citations AND removed sections)
//     • The ## Sources section (per-winery general source list)
//     • The "## Grounding metadata" + "## Cost telemetry" footer added
//       by the collector script (useful for audit and re-running)
//
// WHAT GETS STRIPPED:
//   Five common formats. Order matters — the more permissive patterns
//   (e.g. `[cite: 1, 2, 3,` with trailing comma from truncation) run
//   first so simpler ones don't partially match them.
//
//     [cite: 1]                        ← Gemini's default format
//     [cite: 1, 2, 3]                  ← multi-cite
//     [cite: 1, 2,                     ← truncated (the original bug)
//     [1]                              ← simple
//     [1, 2, 3]                        ← bracketed multi
//     [^1]                             ← footnote-style
//
//   Plus a punctuation cleanup pass that collapses double spaces and
//   removes orphan spaces before sentence-ending punctuation that the
//   citation removal leaves behind.
//
// USAGE:
//   # Default — overwrites .md in place, creates .md.bak backups.
//   # Strips inline citations AND removes the "Wines" section.
//   node scripts/strip-citations.js
//
//   # See what would change without writing anything
//   node scripts/strip-citations.js --dry-run
//
//   # Keep the Wines section after all (overrides the default removal)
//   node scripts/strip-citations.js --remove-sections ""
//
//   # Remove multiple sections (comma-separated, case-insensitive)
//   node scripts/strip-citations.js --remove-sections "Wines,Awards & Recognition"
//
//   # Different source dir
//   node scripts/strip-citations.js --dir path/to/sources
//
//   # Don't make backups (you trust git)
//   node scripts/strip-citations.js --no-backup
//
// REVERT:
//   If you don't like the result and DID make backups, restore with:
//     for f in scripts/winery-sources/*.md.bak; do mv "$f" "${f%.bak}"; done
//
// SAFETY:
//   • No network calls.
//   • Writes .md.bak before overwriting .md (unless --no-backup).
//   • Stops the run if any single file produces a result MORE THAN 60%
//     shorter than the original — that would indicate the cleanup
//     accidentally swallowed prose. (Bumped from 30% to 60% because
//     removing the Wines section on a wine-heavy file can legitimately
//     reduce the body by 30-50%.)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ─── Args ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    dir: path.resolve(__dirname, 'winery-sources'),
    dryRun: false,
    backup: true,
    // Default sections to remove from each prose body. "Wines" goes
    // because the `wines` Upstash namespace already holds per-bottle
    // tasting data; see file header for rationale. Override with
    // --remove-sections "Name1,Name2" or --remove-sections "" to keep
    // everything.
    removeSections: ['Wines'],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' && argv[i + 1]) out.dir = path.resolve(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-backup') out.backup = false;
    else if (a === '--remove-sections' && argv[i + 1] !== undefined) {
      const raw = argv[++i];
      out.removeSections = raw === ''
        ? []
        : raw.split(',').map(s => s.trim()).filter(Boolean);
    }
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/strip-citations.js [--dir PATH] [--dry-run] [--no-backup] [--remove-sections "A,B"]');
      process.exit(0);
    }
  }
  return out;
}

// ─── Citation patterns ────────────────────────────────────────────────────────
// Each entry: { label, re, description }. Order matters — see file header.

const CITATION_PATTERNS = [
  {
    label: 'cite-bracket-truncated',
    // [cite: 1, 2, 3,    or    [cite: 1, 2,    (no closing bracket — common
    // truncation pattern from the original prompt bug)
    re: /\s*\[cite:\s*\d+(?:\s*,\s*\d+)*\s*,?\s*$/gim,
  },
  {
    label: 'cite-bracket',
    // [cite: 1]    [cite: 3, 4, 7]
    re: /\s*\[cite:\s*\d+(?:\s*,\s*\d+)*\s*\]/gi,
  },
  {
    label: 'bracket-multi',
    // [1, 2, 3]    [1,2,3]
    re: /\s*\[\d+(?:\s*,\s*\d+)+\s*\]/g,
  },
  {
    label: 'bracket-single',
    // [1]    [12]    [123]
    re: /\s*\[\d{1,3}\]/g,
  },
  {
    label: 'footnote',
    // [^1]    [^12]
    re: /\s*\[\^\d+\]/g,
  },
];

// ─── Core strip routine ────────────────────────────────────────────────────────

/**
 * Split the file into three zones:
 *   • frontMatter: everything up to and including the first `\n---\n`
 *     (the metadata header the collector writes)
 *   • body: the prose with inline citations, up to but not including
 *     the trailing `\n---\n## Grounding metadata` footer
 *   • footer: the collector-added `## Grounding metadata` and below
 *
 * We only strip inside `body`. The footer's reference URLs are kept
 * because that's where the actual provenance lives.
 */
function splitFile(text) {
  const firstDividerIdx = text.indexOf('\n---\n');
  if (firstDividerIdx === -1) {
    // Unexpected shape — treat whole file as body. Safer than crashing.
    return { frontMatter: '', body: text, footer: '' };
  }
  const frontMatter = text.slice(0, firstDividerIdx + 5);
  const rest = text.slice(firstDividerIdx + 5);

  const lastDividerIdx = rest.lastIndexOf('\n---\n');
  if (lastDividerIdx === -1) {
    return { frontMatter, body: rest, footer: '' };
  }
  // Confirm the footer is the collector's metadata block (not just any
  // `---` divider the model produced inside the prose). The marker is
  // unambiguous text the collector hard-codes.
  const possibleFooter = rest.slice(lastDividerIdx);
  if (!/## Grounding metadata/.test(possibleFooter)) {
    return { frontMatter, body: rest, footer: '' };
  }
  return {
    frontMatter,
    body: rest.slice(0, lastDividerIdx),
    footer: possibleFooter,
  };
}

function stripCitations(body) {
  let cleaned = body;
  const stripCounts = {};
  for (const pat of CITATION_PATTERNS) {
    const matches = cleaned.match(pat.re);
    if (matches) {
      stripCounts[pat.label] = matches.length;
      cleaned = cleaned.replace(pat.re, '');
    }
  }

  // Punctuation cleanup — strip orphan whitespace before sentence
  // punctuation, collapse double-spaces, normalise blank lines.
  cleaned = cleaned
    .replace(/[ \t]+([.,;:!?\)])/g, '$1') // " . " → ". "
    .replace(/[ \t]{2,}/g, ' ')           // collapse internal double spaces
    .replace(/[ \t]+$/gm, '')             // strip trailing whitespace per line
    .replace(/\n{3,}/g, '\n\n');          // no more than one blank line in a row

  return { cleaned, stripCounts };
}

/**
 * Remove all `## <name>` sections in `body` whose name matches one of
 * `sectionNames` (case-insensitive). A section runs from its `##` header
 * line up to (but not including) the next `##` header or the end of
 * body. Subsections (`### ...`) do NOT terminate a section — only
 * top-level `## ` headers do.
 *
 * Returns { cleaned, removedCounts } where removedCounts is a map of
 * sectionName → number-of-times-removed (a section should normally
 * appear at most once per file, but the count surfaces duplicate-bug
 * regressions in the collector).
 */
function removeSections(body, sectionNames) {
  if (sectionNames.length === 0) return { cleaned: body, removedCounts: {} };

  const targets = new Set(sectionNames.map(s => s.toLowerCase().trim()));
  const lines = body.split('\n');
  const result = [];
  const removedCounts = {};
  let skipping = false;
  let currentTarget = null;

  for (const line of lines) {
    const headerMatch = line.match(/^## (.+?)\s*$/);
    if (headerMatch) {
      const name = headerMatch[1].trim();
      if (targets.has(name.toLowerCase())) {
        // Entering a section to remove. Record the hit and start
        // skipping until the next ## header.
        if (!skipping || currentTarget !== name) {
          removedCounts[name] = (removedCounts[name] || 0) + 1;
        }
        skipping = true;
        currentTarget = name;
        continue;
      }
      // Any other ## header ends the skip block (we keep this header).
      skipping = false;
      currentTarget = null;
      result.push(line);
      continue;
    }
    if (!skipping) result.push(line);
  }

  // Collapse runs of blank lines that the removal may have introduced.
  const cleaned = result.join('\n').replace(/\n{3,}/g, '\n\n');
  return { cleaned, removedCounts };
}

function totalStrips(stripCounts) {
  return Object.values(stripCounts).reduce((a, b) => a + b, 0);
}

// ─── Per-file pipeline ─────────────────────────────────────────────────────────

function processFile(filePath, args) {
  const original = fs.readFileSync(filePath, 'utf8');
  const { frontMatter, body, footer } = splitFile(original);

  // Two-pass cleanup. Order matters slightly: strip citations first so
  // section detection doesn't trip on citation markers in a header
  // (unlikely but possible).
  const { cleaned: afterCites, stripCounts } = stripCitations(body);
  const { cleaned: afterSections, removedCounts } = removeSections(afterCites, args.removeSections);
  const cleaned = afterSections;

  const stripped = totalStrips(stripCounts);
  const removedSections = Object.keys(removedCounts);

  const originalLen = body.length;
  const cleanedLen = cleaned.length;
  const shrinkPct = originalLen > 0 ? Math.round((1 - cleanedLen / originalLen) * 100) : 0;

  // Safety check — if cleaning ate more than 60% of the body, abort
  // and surface what happened. (Bumped from 30% because legitimately
  // removing the Wines section on a wine-heavy file can shave 30-50%.)
  if (shrinkPct > 60) {
    return {
      filePath,
      error: `Body shrank by ${shrinkPct}% (${originalLen} → ${cleanedLen}). Possibly removing more than intended. Run --dry-run for details.`,
      stripCounts,
      removedCounts,
    };
  }

  const result = frontMatter + cleaned + footer;

  if (!args.dryRun) {
    if (args.backup) {
      fs.writeFileSync(filePath + '.bak', original, 'utf8');
    }
    fs.writeFileSync(filePath, result, 'utf8');
  }

  return {
    filePath,
    stripped,
    stripCounts,
    removedSections,
    removedCounts,
    shrinkPct,
    bodyBefore: originalLen,
    bodyAfter: cleanedLen,
  };
}

// ─── Reporting ────────────────────────────────────────────────────────────────

function fmtPct(n) {
  return `${n >= 0 ? '−' : '+'}${Math.abs(n)}%`;
}

function printSummary(results, args) {
  console.log('');
  if (args.dryRun) console.log('🧪 DRY RUN — no files modified.\n');

  const ok = results.filter(r => !r.error);
  const errors = results.filter(r => r.error);
  const totalStripped = ok.reduce((s, r) => s + r.stripped, 0);
  const filesWithStrips = ok.filter(r => r.stripped > 0).length;
  const filesWithSectionRemovals = ok.filter(r => (r.removedSections || []).length > 0).length;

  console.log(`📋 Processed ${results.length} files in ${args.dir}`);
  console.log(`   Files with citation markers stripped:    ${filesWithStrips}`);
  console.log(`   Files with sections removed:             ${filesWithSectionRemovals}${args.removeSections.length > 0 ? ` (targets: ${args.removeSections.join(', ')})` : ' (no sections targeted)'}`);
  console.log(`   Files unchanged (nothing to clean):      ${ok.filter(r => r.stripped === 0 && (r.removedSections || []).length === 0).length}`);
  console.log(`   Files with safety-abort errors:          ${errors.length}`);
  console.log(`   Total citation markers removed:          ${totalStripped}\n`);

  // Per-pattern breakdown — useful for debugging which formats were
  // actually present (we don't always know in advance).
  const byPattern = {};
  for (const r of ok) {
    for (const [label, count] of Object.entries(r.stripCounts || {})) {
      byPattern[label] = (byPattern[label] || 0) + count;
    }
  }
  if (Object.keys(byPattern).length > 0) {
    console.log('   Citation patterns matched:');
    for (const [label, count] of Object.entries(byPattern).sort((a, b) => b[1] - a[1])) {
      console.log(`     ${label.padEnd(28)} ${count}`);
    }
    console.log('');
  }

  // Per-section removal breakdown.
  const bySection = {};
  for (const r of ok) {
    for (const [name, count] of Object.entries(r.removedCounts || {})) {
      bySection[name] = (bySection[name] || 0) + count;
    }
  }
  if (Object.keys(bySection).length > 0) {
    console.log('   Sections removed across all files:');
    for (const [name, count] of Object.entries(bySection).sort((a, b) => b[1] - a[1])) {
      console.log(`     "${name}"`.padEnd(36) + `${count} occurrence(s)`);
    }
    console.log('');
  }

  if (errors.length > 0) {
    console.log(`🚨 ${errors.length} file(s) hit the safety abort — INSPECT before re-running:\n`);
    for (const e of errors) {
      console.log(`   ${path.basename(e.filePath)}: ${e.error}`);
    }
    console.log('');
  }

  // Top changes — show the biggest reshapers so user can spot-check.
  const movers = ok.filter(r => r.stripped > 0).sort((a, b) => b.stripped - a.stripped).slice(0, 10);
  if (movers.length > 0) {
    console.log('   Top 10 files by markers removed:');
    for (const r of movers) {
      console.log(`     ${path.basename(r.filePath).padEnd(40)} ${String(r.stripped).padStart(4)} markers   body ${fmtPct(r.shrinkPct)}`);
    }
    console.log('');
  }

  if (args.dryRun) {
    console.log(`💡 Re-run without --dry-run to actually clean the files.\n`);
  } else {
    if (args.backup) {
      console.log(`💾 Backups saved as <slug>.md.bak alongside each file.`);
      console.log(`   To revert all: for f in ${args.dir}/*.md.bak; do mv "$f" "\${f%.bak}"; done\n`);
    }
    console.log(`✅ Done. Re-run \`node scripts/audit-winery-sources.js\` to confirm citation count is now zero by design.\n`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.dir)) {
    console.error(`❌ Source dir does not exist: ${args.dir}`);
    process.exit(1);
  }

  // Glob .md but skip .bak files so we don't process backups from a
  // previous run. The .md.bak suffix would match the .md endsWith
  // check otherwise.
  const files = fs.readdirSync(args.dir)
    .filter(f => f.endsWith('.md') && !f.endsWith('.bak'))
    .map(f => path.join(args.dir, f));

  if (files.length === 0) {
    console.error(`❌ No .md files in ${args.dir}`);
    process.exit(1);
  }

  console.log(`\n🧹 SipLocal — strip-citations`);
  console.log(`   Source dir: ${args.dir}`);
  console.log(`   Files to process: ${files.length}`);
  console.log(`   Mode: ${args.dryRun ? 'DRY RUN' : (args.backup ? 'in-place (with .bak backups)' : 'in-place (no backups)')}`);

  const results = files.map(f => processFile(f, args));
  printSummary(results, args);
})().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
