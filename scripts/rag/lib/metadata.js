// scripts/rag/lib/metadata.js
// Ask Claude to tag a chunk with our metadata taxonomy.
//
// Strategy:
//   1. Send a tight system prompt with the closed taxonomies and JSON shape.
//   2. Parse the response. If it's not valid JSON, retry once with a nudge.
//   3. Validate the returned values against the closed sets. Anything in
//      `type` that isn't in the allow-list is kept but flagged with
//      `taxonomy_new: true` so the human can review it later.
'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';

// ─── Closed taxonomies ─────────────────────────────────────────────────────────

const ALLOWED_TYPES = [
  'travel_planning',
  'regional_guide',
  'varietal_education',
  'food_pairing',
  'winery_profile',
  'viticulture',
  'history',
  'flora_fauna',
];

const ALLOWED_SEASONS = ['summer', 'autumn', 'winter', 'spring', 'harvest', 'overview'];

const ALLOWED_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const ALLOWED_REGIONS = [
  'tamar_valley',
  'coal_river',
  'huon_valley',
  'east_coast',
  'derwent_valley',
  'tasmania_general',
];

const ALLOWED_SENTIMENTS = ['informational', 'positive_recommendation', 'cautionary', 'neutral'];

// ─── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a metadata tagger for a Tasmania wine-tourism knowledge base.

Given a chunk of prose, respond with a single JSON object — no preamble, no
markdown fences, just JSON. Schema:

{
  "type":      string          // see ALLOWED_TYPES, or invent a new snake_case label
  "topic":     string          // 2–8 word free-text summary, e.g. "Pinot Noir in Tamar Valley"
  "seasons":   string[]        // any of ALLOWED_SEASONS, [] if not season-specific
  "months":    string[]        // any of ALLOWED_MONTHS, [] if not month-specific
  "regions":   string[]        // any of ALLOWED_REGIONS, [] if not region-specific
  "tags":      string[]        // 3–8 short free-text tags, lowercase, snake_case
  "sentiment": string          // exactly one of ALLOWED_SENTIMENTS
}

ALLOWED_TYPES: ${ALLOWED_TYPES.join(', ')}
ALLOWED_SEASONS: ${ALLOWED_SEASONS.join(', ')}
ALLOWED_MONTHS: ${ALLOWED_MONTHS.join(', ')}
ALLOWED_REGIONS: ${ALLOWED_REGIONS.join(', ')}
ALLOWED_SENTIMENTS: ${ALLOWED_SENTIMENTS.join(', ')}

Rules:
- If the chunk doesn't cleanly fit any ALLOWED_TYPES, invent a new snake_case
  type that describes it accurately. Don't force a poor fit.
- Use "tasmania_general" for content about Tasmania as a whole rather than a
  named sub-region.
- Be conservative with seasons/months/regions — only include them if the
  chunk genuinely concerns that time or place.
- "sentiment" reflects the chunk's stance: informational (neutral facts),
  positive_recommendation (advocating something), cautionary (warning the
  reader), or neutral (descriptive, no stance).
- Output JSON only.`;

// ─── Client ────────────────────────────────────────────────────────────────────

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env');
  _client = new Anthropic({ apiKey });
  return _client;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generate metadata for one chunk. Returns:
 *   { type, topic, seasons, months, regions, tags, sentiment, taxonomy_new }
 */
async function generateMetadata(chunkText) {
  const raw = await callClaude(chunkText);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // One retry with an explicit "your last response wasn't JSON" nudge.
    const retry = await callClaude(chunkText, /* strictRetry */ true);
    parsed = JSON.parse(retry);
  }
  return validate(parsed);
}

async function callClaude(chunkText, strictRetry = false) {
  const userMessage = strictRetry
    ? `Your previous reply could not be parsed as JSON. Respond with ONLY a JSON object — no markdown, no explanation. Here is the chunk again:\n\n${chunkText}`
    : `Chunk:\n\n${chunkText}`;

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 600,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  // Concatenate any text blocks (almost always exactly one).
  return res.content
    .filter(b => b.type === 'text')
    .map(b => b.text.trim())
    .join('')
    // Strip accidental markdown fences if Claude slips them in.
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
}

// ─── Validation ────────────────────────────────────────────────────────────────

function validate(obj) {
  const inAllow = (val, allow) => typeof val === 'string' && allow.includes(val);
  const filterToAllow = (arr, allow) =>
    Array.isArray(arr) ? arr.filter(v => inAllow(v, allow)) : [];

  const rawType = typeof obj.type === 'string' ? obj.type.trim() : 'unknown';
  const taxonomyNew = !ALLOWED_TYPES.includes(rawType);

  return {
    type: rawType,
    topic: typeof obj.topic === 'string' ? obj.topic.trim() : '',
    seasons: filterToAllow(obj.seasons, ALLOWED_SEASONS),
    months: filterToAllow(obj.months, ALLOWED_MONTHS),
    regions: filterToAllow(obj.regions, ALLOWED_REGIONS),
    tags: Array.isArray(obj.tags)
      ? obj.tags
          .filter(t => typeof t === 'string')
          .map(t => t.trim().toLowerCase().replace(/\s+/g, '_'))
          .filter(Boolean)
          .slice(0, 12)
      : [],
    sentiment: inAllow(obj.sentiment, ALLOWED_SENTIMENTS) ? obj.sentiment : 'informational',
    taxonomy_new: taxonomyNew,
  };
}

module.exports = {
  generateMetadata,
  ALLOWED_TYPES,
  ALLOWED_SEASONS,
  ALLOWED_MONTHS,
  ALLOWED_REGIONS,
  ALLOWED_SENTIMENTS,
};
