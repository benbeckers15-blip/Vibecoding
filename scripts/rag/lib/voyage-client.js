// scripts/rag/lib/voyage-client.js
// Voyage AI embeddings. We use voyage-3-lite (512-dim) to match the
// existing Upstash index (which embed-wineries.js created at 512-dim).
// voyage-3 (1024-dim) would require a new Upstash database.
//
// IMPORTANT: Voyage produces *asymmetric* embeddings — you pass
// `input_type: 'document'` when indexing and `input_type: 'query'` when
// searching. Mixing them up degrades recall.
'use strict';

const { VoyageAIClient } = require('voyageai');

const MODEL = 'voyage-3-lite';

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY is not set in .env');
  }
  _client = new VoyageAIClient({ apiKey });
  return _client;
}

/** Embed N chunks of source text. Returns Array<number[]> in input order. */
async function embedDocuments(texts) {
  if (!texts.length) return [];
  const res = await getClient().embed({
    model: MODEL,
    input: texts,
    inputType: 'document',
  });
  return res.data.map(d => d.embedding);
}

/** Embed a single user query. Returns number[]. */
async function embedQuery(text) {
  const res = await getClient().embed({
    model: MODEL,
    input: [text],
    inputType: 'query',
  });
  return res.data[0].embedding;
}

module.exports = { embedDocuments, embedQuery, MODEL };
