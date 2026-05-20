// scripts/rag/lib/upstash-client.js
// Upstash Vector — stores embeddings + lightweight metadata for filtering.
//
// We pin everything to the `knowledge` namespace so this knowledge base
// doesn't collide with the winery vectors that already live in this index.
'use strict';

const { Index } = require('@upstash/vector');

const NAMESPACE = 'knowledge';

let _ns = null;
function getNamespace() {
  if (_ns) return _ns;
  const url   = process.env.UPSTASH_VECTOR_URL;
  const token = process.env.UPSTASH_VECTOR_TOKEN;
  if (!url)   throw new Error('UPSTASH_VECTOR_URL is not set');
  if (!token) throw new Error('UPSTASH_VECTOR_TOKEN is not set');
  _ns = new Index({ url, token }).namespace(NAMESPACE);
  return _ns;
}

/**
 * Upsert a batch of vectors. Each item: { id, vector, metadata }.
 * Lightweight metadata only — the full chunk text lives in Firestore.
 */
async function upsertVectors(items) {
  if (!items.length) return;
  await getNamespace().upsert(items.map(({ id, vector, metadata }) => ({
    id,
    vector,
    metadata,
  })));
}

/**
 * Semantic search. Returns up to `topK` hits, optionally narrowed by an
 * Upstash metadata filter string.
 *
 *   filter examples (Upstash SQL-ish syntax):
 *     "type = 'varietal_education'"
 *     "regions CONTAINS 'tamar_valley' AND seasons CONTAINS 'autumn'"
 */
async function searchVectors({ vector, topK = 6, filter }) {
  const res = await getNamespace().query({
    vector,
    topK,
    includeMetadata: true,
    ...(filter ? { filter } : {}),
  });
  return res.map(r => ({
    id: r.id,
    score: r.score,
    metadata: r.metadata,
  }));
}

module.exports = { upsertVectors, searchVectors, NAMESPACE };
