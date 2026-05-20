/**
 * build-context.js — Turn the raw winery collection into a compact block
 * the language model can reason over.
 *
 * Why this exists:
 *   The raw Firestore documents have lots of fields we don't need at query
 *   time (image URLs, place IDs, full multi-paragraph descriptions). Shipping
 *   all of that to Claude on every request wastes tokens and money. This
 *   module distils each winery to the ~150 tokens that actually drive
 *   recommendations.
 *
 * Output is a plain string. We pass it as a single, cacheable system block
 * so subsequent queries pay the cached read rate (~90% discount).
 *
 * Run standalone to inspect the output:
 *   node src/build-context.js
 *   node src/build-context.js --json     # dump the structured form too
 */

require('dotenv').config();
const { fetchWineries, shutdown } = require('./firestore');

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

function tags(w) {
  const t = [];
  if (w.dogFriendly) t.push('dog-friendly');
  if (w.hasRestaurant) t.push('restaurant');
  if (w.isOrganic) t.push('organic');
  if (w.isBiodynamic) t.push('biodynamic');
  if (w.walkinWelcome) t.push('walk-ins');
  if (w.featured) t.push('featured');
  return t;
}

function firstSentence(text) {
  if (!text) return '';
  const m = text.match(/^[^.!?]*[.!?]/);
  return (m ? m[0] : text).trim();
}

function blurb(w) {
  // Pull the editorial lede from description[0] if it's an array, else use it raw.
  let raw = '';
  if (Array.isArray(w.description) && w.description.length > 0) {
    raw = w.description[0];
  } else if (typeof w.description === 'string') {
    raw = w.description;
  }
  // Trim to ~200 chars so we don't bloat context.
  const sentence = firstSentence(raw);
  return sentence.length > 220 ? sentence.slice(0, 217) + '...' : sentence;
}

// Map any incoming day token to a canonical short label. Handles "Monday",
// "Mon", "Mon – Fri", "Daily", "Hours" fallbacks, etc.
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL_TO_SHORT = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
  mon: 'Mon', tue: 'Tue', tues: 'Tue', wed: 'Wed', thu: 'Thu', thur: 'Thu', thurs: 'Thu',
  fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

function normaliseDayLabel(rawDay) {
  if (!rawDay) return null;
  const d = String(rawDay).trim().toLowerCase();
  if (d === 'daily' || d === 'open daily' || d === 'every day') return 'Daily';
  if (d === 'hours') return null; // fallback bucket — not a real day
  // Range like "Mon – Fri" or "Friday – Sunday"
  const rangeMatch = d.match(/^(\w+)\s*[–\-]\s*(\w+)$/);
  if (rangeMatch) {
    const a = DAY_FULL_TO_SHORT[rangeMatch[1]];
    const b = DAY_FULL_TO_SHORT[rangeMatch[2]];
    if (a && b) return `${a}-${b}`;
  }
  return DAY_FULL_TO_SHORT[d] || rawDay;
}

// Compact a time string: "10:00 AM – 5:00 PM" → "10-5", "Closed" → "Closed".
function compactTime(t) {
  if (!t) return '';
  let s = String(t).trim();
  if (/^closed$/i.test(s)) return 'Closed';
  // Strip :00, AM/PM and whitespace; keep the dash.
  s = s.replace(/\s*(?::00)?\s*(am|pm)/gi, '').replace(/\s+/g, '');
  s = s.replace(/[–—]/g, '-');
  return s;
}

// Build a per-day hours string. Prefers structured array; falls back to raw.
// Output examples:
//   "Mon=Closed; Tue=Closed; Wed=Closed; Thu=Closed; Fri=10-5; Sat=10-5; Sun=10-5"
//   "Daily=10-5"
//   "raw='By appointment only'"  ← only when structured isn't usable
function formatHours(w) {
  const arr = Array.isArray(w.hoursStructured) ? w.hoursStructured : null;
  if (arr && arr.length > 0) {
    // Build an entries list, expanding ranges into individual days.
    const dayMap = {};      // shortDay -> time string
    const extras = [];      // anything we couldn't bucket per-day

    for (const entry of arr) {
      const label = normaliseDayLabel(entry.day);
      const time = compactTime(entry.time);
      if (!label) {
        // Fallback bucket ("Hours") — keep the raw time as-is
        extras.push(`raw='${entry.time}'`);
        continue;
      }
      if (label === 'Daily') {
        for (const d of DAY_ORDER) dayMap[d] = time;
        continue;
      }
      // Range like "Mon-Fri"
      const range = label.match(/^([A-Z][a-z]{2})-([A-Z][a-z]{2})$/);
      if (range) {
        const start = DAY_ORDER.indexOf(range[1]);
        const end = DAY_ORDER.indexOf(range[2]);
        if (start !== -1 && end !== -1) {
          // Handle wrap-around (e.g. Fri-Sun is fine; Sat-Mon wraps)
          let i = start;
          while (true) {
            dayMap[DAY_ORDER[i]] = time;
            if (i === end) break;
            i = (i + 1) % 7;
          }
          continue;
        }
      }
      // Single day
      if (DAY_ORDER.includes(label)) {
        dayMap[label] = time;
      } else {
        extras.push(`${label}=${time}`);
      }
    }

    const orderedParts = DAY_ORDER
      .filter(d => dayMap[d] !== undefined)
      .map(d => `${d}=${dayMap[d]}`);

    const all = [...orderedParts, ...extras];
    if (all.length > 0) return all.join('; ');
  }

  // Last resort: ship the raw string, flagged so the model knows it's unparsed.
  if (w.hours) return `raw='${String(w.hours).replace(/\n/g, ' ').replace(/'/g, "\\'")}'`;
  return '';
}

/**
 * Turn one winery doc into a single compact line.
 * Format chosen so the model can scan dozens of entries quickly and so the
 * hours field is unambiguous per day.
 */
function compactWinery(w) {
  const fields = [];
  fields.push(`id:${w.slug || w.id}`);
  fields.push(`name:${w.name || '(unnamed)'}`);
  if (w.region) fields.push(`region:${w.region}`);
  if (typeof w.rating === 'number') fields.push(`rating:${w.rating.toFixed(1)}`);
  const h = formatHours(w);
  if (h) fields.push(`hours:${h}`);
  const t = tags(w);
  if (t.length) fields.push(`tags:${t.join(',')}`);
  if (typeof w.latitude === 'number' && typeof w.longitude === 'number') {
    fields.push(`coords:${w.latitude.toFixed(3)},${w.longitude.toFixed(3)}`);
  }
  const b = blurb(w);
  if (b) fields.push(`note:${b}`);
  return fields.join(' | ');
}

/**
 * Build a single string of all wineries, plus a small Tasmania primer.
 * This is what we'll ship as the cached system context.
 */
function buildContextString(wineries) {
  const lines = wineries.map(compactWinery);

  const header = [
    '# Tasmania Winery Dataset',
    '',
    'You have full knowledge of every cellar door in this list. Each line is one',
    'winery with pipe-separated key:value fields. Use the `id` value when',
    'referring to a winery internally; use `name` when talking to the user.',
    '',
    '## Hours field format (read this carefully)',
    '',
    'The `hours:` field gives per-day cellar-door hours in shorthand:',
    '  hours:Mon=Closed; Tue=Closed; Wed=10-5; Thu=10-5; Fri=10-5; Sat=10-5; Sun=10-5',
    '',
    'A day is OPEN if its value is a time range (e.g. `10-5`, `11-4`, `10:30-4`).',
    'A day is CLOSED if its value is `Closed`.',
    'A day NOT LISTED means hours are unknown for that day — never assume open or closed.',
    'Times are 24h-style without minutes when whole, e.g. `10-5` = 10am to 5pm.',
    'If you see `raw=\'...\'` the hours could not be parsed per-day; the original string follows. Read it carefully and quote it verbatim; if ambiguous, say so.',
    '',
    '## Regional primer',
    '',
    '- Tamar Valley (north, near Launceston): cool-climate sparkling, pinot, riesling, chardonnay. Easy to do as a day from Launceston.',
    '- Pipers River (northeast of Launceston): premium sparkling country (Jansz, House of Arras).',
    '- East Coast (Bicheno, Swansea, Freycinet): scenic, often paired with Freycinet National Park; pinot and pinot gris dominate.',
    '- Coal River Valley (~25 min east of Hobart): warmest sub-region; chardonnay, pinot, riesling, cab franc.',
    '- Derwent Valley (~30-45 min northwest of Hobart): cool, elegant pinot and chardonnay; smaller cellar doors.',
    '- Huon Valley (~45 min south of Hobart): cool, often pinot and aromatic whites; Channel views.',
    '',
    'Typical drive times: Hobart↔Launceston is ~2.5 hours direct. Hobart↔Coal River 25 min. Launceston↔Pipers River 35 min. Launceston↔Tamar Valley cellar doors 20-45 min.',
    '',
    'Cruise-ship traffic lands in Hobart — Coal River Valley is the realistic option for a ship-day visit (under 6 hours round-trip).',
    '',
    '## Wineries',
    '',
  ].join('\n');

  return header + lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function loadContext() {
  const wineries = await fetchWineries();
  const text = buildContextString(wineries);
  return { wineries, text };
}

module.exports = { loadContext, buildContextString, compactWinery };

// ---------------------------------------------------------------------------
// CLI: print the context block, optionally with JSON
// ---------------------------------------------------------------------------

async function main() {
  const showJson = process.argv.includes('--json');
  try {
    const { wineries, text } = await loadContext();
    console.error(`Loaded ${wineries.length} wineries.`);
    console.error(`Context size: ${text.length} chars (~${Math.round(text.length / 4)} tokens).\n`);
    if (showJson) {
      console.log(JSON.stringify(wineries, null, 2));
    } else {
      console.log(text);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

if (require.main === module) {
  main();
}
