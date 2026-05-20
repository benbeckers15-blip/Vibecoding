// scripts/rag/retrieve.js
// Importable retrieval function for the concierge.
//
// Flow:
//   1. Embed the user's query (Voyage, input_type='query').
//   2. Semantic-search Upstash (`knowledge` namespace), optionally filtered
//      by metadata.
//   3. Fetch full chunk text + all metadata from Firestore by ID.
//   4. Return an ordered array. Caller injects into the Claude system prompt.
'use strict';

const { embedQuery } = require('./lib/voyage-client');
const { searchVectors } = require('./lib/upstash-client');
const { getChunksByIds } = require('./lib/firestore-client');

/**
 * @param {object} opts
 * @param {string} opts.query   - user's natural-language question
 * @param {number} [opts.topK=6]
 * @param {string} [opts.filter] - Upstash metadata filter, e.g.
 *                                 "regions CONTAINS 'tamar_valley'"
 * @param {number} [opts.minScore=0] - drop hits below this similarity score
 * @returns {Promise<Array<RetrievedChunk>>}
 *
 * RetrievedChunk = {
 *   id, score, text, type, topic, seasons, months, regions, tags, sentiment,
 *   sourcePath, headingPath
 * }
 */
async function retrieveContext({ query, topK = 6, filter, minScore = 0 }) {
  if (!query || typeof query !== 'string') {
    throw new Error('retrieveContext: `query` must be a non-empty string');
  }

  // 1. Embed query.
  const vector = await embedQuery(query);

  // 2. Search Upstash.
  const hits = await searchVectors({ vector, topK, filter });
  const keptHits = hits.filter(h => h.score >= minScore);
  if (!keptHits.length) return [];

  // 3. Hydrate from Firestore. Preserve Upstash's ranking order.
  const ids = keptHits.map(h => h.id);
  const docs = await getChunksByIds(ids);
  const byId = new Map(docs.map(d => [d.id, d]));

  return keptHits
    .map(hit => {
      const doc = byId.get(hit.id);
      if (!doc) return null; // index drift — Upstash has a vector Firestore lost
      return {
        id: hit.id,
        score: hit.score,
        text: doc.text,
        type: doc.type,
        topic: doc.topic,
        seasons: doc.seasons || [],
        months: doc.months || [],
        regions: doc.regions || [],
        tags: doc.tags || [],
        sentiment: doc.sentiment,
        sourcePath: doc.sourcePath,
        headingPath: doc.headingPath || [],
      };
    })
    .filter(Boolean);
}

/**
 * Format retrieved chunks for direct injection into a Claude system prompt.
 * Each chunk gets a header with its source path + section + key tags so
 * Claude can cite naturally.
 */
function formatChunksForPrompt(chunks) {
  if (!chunks.length) return '';
  return chunks
    .map((c, i) => {
      const heading = c.headingPath.length ? c.headingPath.join(' › ') : '(top)';
      return [
        `<chunk index="${i + 1}" id="${c.id}" source="${c.sourcePath}" section="${heading}">`,
        c.text,
        `</chunk>`,
      ].join('\n');
    })
    .join('\n\n');
}

module.exports = { retrieveContext, formatChunksForPrompt };
