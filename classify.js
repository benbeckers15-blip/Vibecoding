const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const client = new Anthropic();
const INPUT_FILE = './margswineryreviews2.json';       // ← rename to match your file
const RESULTS_FILE = './winery_classifications.json';
const DELAY_MS = 600;

const KEYWORDS = [
  'dog','pup','puppy','pet','canine','leash','furry','pooch','four-legged',
  'organic','natural wine','pesticide','biodynamic',
  'wifi','wi-fi','wireless','internet',
  'restaurant','menu','chef','lunch','dinner','dine',
  'dining','food','kitchen','meal','ate','eat','course','cuisine','bistro'
];

function extractRelevantSentences(reviews) {
  const hits = [];
  for (const review of reviews) {
    if (!review.text) continue;
    const sentences = review.text.split(/[.!?\n]+/);
    for (const s of sentences) {
      if (KEYWORDS.some(kw => s.toLowerCase().includes(kw))) {
        const clean = s.trim();
        if (clean.length > 10) hits.push(clean);
      }
    }
  }
  return [...new Set(hits)];
}

// Groups the flat array into a map of placeId → { title, placeId, reviews[] }
function groupByWinery(rawData) {
  const map = {};
  for (const entry of rawData) {
    const id = entry.placeId;
    if (!map[id]) {
      map[id] = {
        placeId: id,
        title: entry.title,
        reviews: []
      };
    }
    if (entry.text) {
      map[id].reviews.push({ text: entry.text, stars: entry.stars });
    }
  }
  return Object.values(map);
}

async function classifyWinery(winery) {
  const sentences = extractRelevantSentences(winery.reviews);

  if (sentences.length === 0) {
    return {
      placeId: winery.placeId,
      title: winery.title,
      firestore_doc_id: null,
      dog_friendly: false, dog_friendly_confidence: 1,
      organic: false, organic_confidence: 1,
      biodynamic: false, biodynamic_confidence: 1,
      wifi: false, wifi_confidence: 1,
      has_restaurant: false, has_restaurant_confidence: 1,
      note: 'No relevant sentences found — manual review recommended'
    };
  }

  const prompt = `You are classifying a winery based on real customer review excerpts.

Winery: ${winery.title}

Review excerpts (pre-filtered for relevance):
${sentences.map((s, i) => `${i + 1}. "${s}"`).join('\n')}

Classify this winery on 5 attributes. Rules:
- dog_friendly: true only if dogs/pets are explicitly welcomed or allowed on premises
- organic: true only if reviews explicitly mention organic wine or certified organic practices
- biodynamic: true only if reviews explicitly use the word biodynamic
- wifi: true only if wifi is explicitly mentioned as available
- has_restaurant: true only if a proper sit-down restaurant with a food menu is clearly described (cheese/charcuterie boards alone do not count)

Confidence scores:
- 8-10: Multiple reviews clearly confirm this
- 4-7: One or two reviews suggest it
- 1-3: Weak or ambiguous signal (treat as false)

Return ONLY this exact JSON, no other text:
{
  "dog_friendly": false,
  "dog_friendly_confidence": 1,
  "organic": false,
  "organic_confidence": 1,
  "biodynamic": false,
  "biodynamic_confidence": 1,
  "wifi": false,
  "wifi_confidence": 1,
  "has_restaurant": false,
  "has_restaurant_confidence": 1
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = response.content[0].text.trim();
const cleaned = raw.replace(/^```json\n?/, '').replace(/```$/, '').trim();
const parsed = JSON.parse(cleaned);
  return {
    placeId: winery.placeId,
    title: winery.title,
    firestore_doc_id: null,   // ← you fill this in after reviewing
    ...parsed
  };
}

function loadExisting() {
  if (fs.existsSync(RESULTS_FILE)) {
    return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  }
  return [];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const rawData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const wineries = groupByWinery(rawData);
  const existing = loadExisting();
  const doneIds = new Set(existing.map(r => r.placeId));
  const results = [...existing];

  console.log(`📋 Total wineries: ${wineries.length}`);
  console.log(`✅ Already classified: ${doneIds.size}`);
  console.log(`⏳ Remaining: ${wineries.length - doneIds.size}\n`);

  for (const winery of wineries) {
    if (doneIds.has(winery.placeId)) {
      console.log(`⏭️  Skipping: ${winery.title}`);
      continue;
    }

    process.stdout.write(`🔍 Classifying: ${winery.title} (${winery.reviews.length} reviews)...`);
    try {
      const result = await classifyWinery(winery);
      results.push(result);
      fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
      console.log(` ✅`);
      console.log(`   🐶 dog:${result.dog_friendly}(${result.dog_friendly_confidence}) 🌿 organic:${result.organic}(${result.organic_confidence}) 🍇 bio:${result.biodynamic}(${result.biodynamic_confidence}) 📶 wifi:${result.wifi}(${result.wifi_confidence}) 🍽️  restaurant:${result.has_restaurant}(${result.has_restaurant_confidence})`);
    } catch (err) {
      console.log(` ❌ Error: ${err.message}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n🎉 Classification complete!`);
  console.log(`📄 Review winery_classifications.json`);
  console.log(`👉 Fill in firestore_doc_id for each winery, then run: node update_firestore.js`);
}

main().catch(console.error);