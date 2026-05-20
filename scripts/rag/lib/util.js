// scripts/rag/lib/util.js
// Tiny shared helpers. Kept zero-dependency on purpose.
'use strict';

const crypto = require('crypto');

/**
 * Deterministic chunk ID. We hash the *normalised* chunk text so the same
 * paragraph produces the same ID across runs — which is what makes
 * re-ingestion idempotent. Tweak a comma and you get a new chunk; that's
 * fine, the old one stays in the index until you decide to prune.
 */
function chunkId(text) {
  return 'kb_' + crypto
    .createHash('sha256')
    .update(normaliseText(text))
    .digest('hex')
    .slice(0, 24);
}

/**
 * Strip noisy whitespace but preserve paragraph breaks (double newlines).
 * Used for hashing AND for the text we actually embed — we want both to
 * agree on what "the same chunk" means.
 */
function normaliseText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Approx word count — fine for chunk-size budgeting. */
function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Pretty-print byte/duration deltas in ingest logs. */
function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

module.exports = { chunkId, normaliseText, sleep, wordCount, fmtMs };
