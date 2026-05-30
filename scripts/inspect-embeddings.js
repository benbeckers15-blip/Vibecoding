// scripts/inspect-embeddings.js
// ─────────────────────────────────────────────────────────────────────────────
// Inspector for the SipLocal vector indexes.
//
// Three places hold embedded data today:
//
//   1. Upstash Vector — default namespace
//        ↳ One vector per WINERY. Written by scripts/embed-wineries.js.
//          Embedding text = name + region + tags + description + pull quote.
//          Metadata = name, slug, region, rating, tag booleans.
//          Used by the concierge for semantic shortlisting.
//
//   2. Upstash Vector — `knowledge` namespace
//        ↳ One vector per CHUNK of editorial Markdown prose (regional
//          history, etiquette, food, seasons, etc.). Written by
//          scripts/rag/ingest.js.
//          Metadata = type, seasons, months, regions, sentiment, taxonomy_new,
//                     sourcePath, regionId. (Text lives in Firestore — see
//                     functions/src/concierge/knowledgeRetrieve.ts.)
//
//   3. Upstash Vector — `wines` namespace
//        ↳ One vector per TASTING NOTE (per-bottle). Written by
//          scripts/rag/ingest-tasting-notes.js. Metadata carries the full
//          notes text inline (no Firestore join needed).
//
// USAGE:
//   # Default: structure overview + 3 sample vectors per namespace
//   node --env-file=.env scripts/inspect-embeddings.js
//
//   # More samples per namespace
//   node --env-file=.env scripts/inspect-embeddings.js --samples 10
//
//   # Inspect a single namespace
//   node --env-file=.env scripts/inspect-embeddings.js --namespace knowledge
//   node --env-file=.env scripts/inspect-embeddings.js --namespace wines
//   node --env-file=.env scripts/inspect-embeddings.js --namespace default
//
//   # Dump ALL metadata to JSON for offline review (no vector floats —
//   # those are huge and not useful for human review)
//   node --env-file=.env scripts/inspect-embeddings.js --export embeddings.json
//
//   # Filter samples by prefix on the ID (handy with the wines namespace
//   # where IDs are stable wine slugs)
//   node --env-file=.env scripts/inspect-embeddings.js --prefix frogmore
//
//   # Show ALL vectors in a single namespace (no sample cap). Combine
//   # with --namespace to keep it scoped.
//   node --env-file=.env scripts/inspect-embeddings.js --namespace wines --all
//
// NOTE:
//   This script reads vectors via index.range() with includeMetadata:true
//   but NOT includeVectors:true — the 512-dim float arrays are useless
//   for human inspection and would make the report unreadable. If you
//   genuinely need to see a vector (e.g. debugging an embedding bug),
//   add `--include-vectors` and only run with a small --samples N.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Index } = require('@upstash/vector');

// ─── Config ────────────────────────────────────────────────────────────────────

const UPSTASH_URL = process.env.UPSTASH_VECTOR_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_VECTOR_TOKEN;

if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error('❌ UPSTASH_VECTOR_URL and UPSTASH_VECTOR_TOKEN must be set in .env');
  process.exit(1);
}

const index = new Index({ url: UPSTASH_URL, token: UPSTASH_TOKEN });

// The default namespace is implicit in the Upstash SDK — passing
// undefined to .namespace() gets you the root index. We treat it as
// "" for display purposes.
const DEFAULT_NAMESPACE_LABEL = '(default)';

// Human-friendly descriptions of what each namespace holds. Keyed by
// namespace name as returned by listNamespaces(); the default
// namespace is keyed as "".
const NAMESPACE_DESCRIPTIONS = {
  '':         'WINERIES — one vector per winery. Written by scripts/embed-wineries.js.',
  knowledge:  'KNOWLEDGE CHUNKS — editorial prose (regions/etiquette/food/seasons). Text in Firestore.',
  wines:      'TASTING NOTES — one vector per bottle. Written by scripts/rag/ingest-tasting-notes.js.',
};

// ─── Args ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    namespace: null,
    samples: 3,
    prefix: null,
    export: null,
    all: false,
    includeVectors: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--namespace' && argv[i + 1]) out.namespace = argv[++i];
    else if (a === '--samples' && argv[i + 1]) out.samples = parseInt(argv[++i], 10);
    else if (a === '--prefix' && argv[i + 1]) out.prefix = argv[++i];
    else if (a === '--export' && argv[i + 1]) out.export = path.resolve(argv[++i]);
    else if (a === '--all') out.all = true;
    else if (a === '--include-vectors') out.includeVectors = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node --env-file=.env scripts/inspect-embeddings.js [--namespace NAME] [--samples N] [--prefix STR] [--export PATH] [--all] [--include-vectors]');
      process.exit(0);
    }
  }
  return out;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getNamespaceHandle(name) {
  // The default namespace is what you get when you call methods on the
  // root index. The SDK's .namespace("") behaviour is inconsistent across
  // versions — call against root for the default.
  return name === '' || name == null ? index : index.namespace(name);
}

function nsLabel(name) {
  return name === '' || name == null ? DEFAULT_NAMESPACE_LABEL : name;
}

async function fetchVectors(ns, { limit, prefix, includeVectors }) {
  // Range-paginate. Upstash's cursor is a string; first page passes
  // cursor 0 (or '' in some SDK versions — 0 is what their docs use).
  const out = [];
  let cursor = '0';
  const pageSize = Math.min(100, limit || 100);
  while (true) {
    const req = {
      cursor,
      limit: pageSize,
      includeMetadata: true,
      includeVectors: !!includeVectors,
    };
    if (prefix) req.prefix = prefix;
    const res = await ns.range(req);
    if (!res || !Array.isArray(res.vectors)) break;
    out.push(...res.vectors);
    if (limit && out.length >= limit) break;
    if (!res.nextCursor || res.nextCursor === '0' || res.nextCursor === cursor) break;
    cursor = res.nextCursor;
  }
  return limit ? out.slice(0, limit) : out;
}

function truncate(s, max = 220) {
  if (!s) return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

function fmtMetadata(meta, depth = 0) {
  if (!meta || typeof meta !== 'object') return '';
  const lines = [];
  const indent = '    '.repeat(depth + 1);
  for (const [k, v] of Object.entries(meta)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      lines.push(`${indent}${k}: [${v.slice(0, 6).map(x => JSON.stringify(x)).join(', ')}${v.length > 6 ? `, +${v.length - 6}` : ''}]`);
    } else if (typeof v === 'object') {
      lines.push(`${indent}${k}:`);
      lines.push(fmtMetadata(v, depth + 1));
    } else if (typeof v === 'string') {
      lines.push(`${indent}${k}: "${truncate(v, 140)}"`);
    } else {
      lines.push(`${indent}${k}: ${v}`);
    }
  }
  return lines.join('\n');
}

// ─── Inspection routines ──────────────────────────────────────────────────────

async function printOverview() {
  console.log('\n🔬 Upstash Vector — structure overview\n');
  const info = await index.info();
  console.log(`  Index URL:           ${UPSTASH_URL}`);
  console.log(`  Total vectors:       ${info.vectorCount.toLocaleString()}`);
  if (info.pendingVectorCount) {
    console.log(`  Pending vectors:     ${info.pendingVectorCount.toLocaleString()}`);
  }
  console.log(`  Index size:          ${formatBytes(info.indexSize)}`);
  console.log(`  Dimensions:          ${info.dimension}`);
  console.log(`  Similarity function: ${info.similarityFunction}`);
  console.log(`\n  Namespaces:`);
  const names = Object.keys(info.namespaces).sort();
  for (const name of names) {
    const ns = info.namespaces[name];
    const desc = NAMESPACE_DESCRIPTIONS[name] || '(no description registered in this inspector)';
    const label = nsLabel(name);
    console.log(`    • ${label.padEnd(15)} ${String(ns.vectorCount).padStart(6)} vectors  — ${desc}`);
  }
  console.log();
  return info;
}

async function printSamples(namespaceName, args) {
  const label = nsLabel(namespaceName);
  console.log(`\n── ${label} ──`);
  const ns = getNamespaceHandle(namespaceName);

  const limit = args.all ? undefined : args.samples;
  const t0 = Date.now();
  const vectors = await fetchVectors(ns, {
    limit,
    prefix: args.prefix,
    includeVectors: args.includeVectors,
  });
  const ms = Date.now() - t0;

  if (vectors.length === 0) {
    console.log(`  (no vectors matched${args.prefix ? ` prefix="${args.prefix}"` : ''})\n`);
    return;
  }
  console.log(`  Fetched ${vectors.length} vector(s) in ${ms}ms${args.prefix ? ` (prefix="${args.prefix}")` : ''}${args.all ? '' : ` — pass --samples N or --all for more`}`);
  console.log();

  for (const v of vectors) {
    console.log(`  ─── id: ${v.id}`);
    if (args.includeVectors && Array.isArray(v.vector)) {
      console.log(`      vector[${v.vector.length}]: [${v.vector.slice(0, 6).map(n => n.toFixed(4)).join(', ')}, …]`);
    }
    if (v.metadata && Object.keys(v.metadata).length > 0) {
      console.log(`      metadata:`);
      console.log(fmtMetadata(v.metadata, 1));
    } else {
      console.log(`      (no metadata)`);
    }
    console.log();
  }
}

async function exportAll(filePath, args) {
  console.log(`\n📦 Exporting all metadata to ${filePath} (no vectors — keeps file size sane)...`);
  const info = await index.info();
  const out = {
    exportedAt: new Date().toISOString(),
    indexUrl: UPSTASH_URL,
    totalVectorCount: info.vectorCount,
    dimension: info.dimension,
    similarityFunction: info.similarityFunction,
    namespaces: {},
  };
  const names = Object.keys(info.namespaces).sort();
  for (const name of names) {
    const label = nsLabel(name);
    process.stdout.write(`  ${label}: `);
    const ns = getNamespaceHandle(name);
    const vectors = await fetchVectors(ns, { limit: undefined, prefix: args.prefix, includeVectors: false });
    out.namespaces[label] = {
      description: NAMESPACE_DESCRIPTIONS[name] || null,
      vectorCount: vectors.length,
      vectors: vectors.map(v => ({ id: v.id, metadata: v.metadata || null })),
    };
    console.log(`${vectors.length} vectors`);
  }
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n✅ Wrote ${filePath}\n`);
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Export mode short-circuits.
  if (args.export) {
    await exportAll(args.export, args);
    return;
  }

  const info = await printOverview();

  // If a single namespace was requested, only show that one.
  const namespaceNames = Object.keys(info.namespaces).sort();
  const toInspect = args.namespace == null
    ? namespaceNames
    : namespaceNames.filter(n => (n || DEFAULT_NAMESPACE_LABEL) === args.namespace || n === args.namespace);

  if (toInspect.length === 0) {
    console.error(`No namespace matching "${args.namespace}". Available: ${namespaceNames.map(nsLabel).join(', ')}`);
    process.exit(1);
  }

  for (const name of toInspect) {
    await printSamples(name, args);
  }

  console.log('💡 Tips:');
  console.log('   • Pass --samples 10 to see more per namespace.');
  console.log('   • Pass --all (with --namespace NAME) to dump every vector in one namespace.');
  console.log('   • Pass --export embeddings.json to write a full metadata dump for offline review.');
  console.log('   • Pass --prefix STR to filter by id prefix (e.g. --prefix frogmore).');
  console.log();
})().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
