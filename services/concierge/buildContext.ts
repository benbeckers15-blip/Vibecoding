// services/concierge/buildContext.ts
// ─────────────────────────────────────────────────────────────────────────────
// Loads the Firestore winery collection once per session and exposes the
// per-winery compactor used to render filtered slices to the model.
//
// History: this file used to also build the full corpus string with the
// regional primer header baked in. That header is now part of the cached
// system prompt (see systemPrompt.ts), and the per-winery rows are now
// emitted only for the small slice the router selects. This keeps the
// system-prompt cache hit wide and the per-turn payload small.
// ─────────────────────────────────────────────────────────────────────────────

import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebaseConfig";

// ─── Tasmania sub-regions ────────────────────────────────────────────────────
// Canonical list of Tasmanian sub-region strings used as the `region` field
// on winery documents. Kept here as the single source of truth — keep in sync
// if a new sub-region is added in Firestore.

export const TASMANIA_REGIONS = [
  "Tamar Valley",
  "Pipers River",
  "East Coast",
  "Coal River Valley",
  "Derwent Valley",
  "Huon Valley",
  "Huon Valley and Channel",
  "North West",
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface HoursEntry {
  day?: string;
  time?: string;
}

export interface WineryDoc {
  id: string;
  slug?: string;
  name?: string;
  region?: string;
  rating?: number;
  latitude?: number;
  longitude?: number;
  hours?: string;
  hoursStructured?: HoursEntry[];
  description?: string | string[];
  images?: string[];
  userRatingsTotal?: number;
  dogFriendly?: boolean;
  hasRestaurant?: boolean;
  isOrganic?: boolean;
  isBiodynamic?: boolean;
  walkinWelcome?: boolean;
  // Award recognition (e.g. Halliday-rated, regional show winners). Surfaced
  // as the `award-winning` tag in both the world index and per-turn detail
  // rows so the concierge can answer "who's award-winning?" / "any notable
  // winners?" without inventing accolades.
  awardWinning?: boolean;
  // Cellar door offers guided / structured tours of the vineyard or
  // winery (as opposed to a tasting-only experience). Surfaced as the
  // `tours` tag so the concierge can answer "anywhere that runs tours?"
  // / "where can we get a vineyard walk?" reliably.
  hasTours?: boolean;
  featured?: boolean;
  // Phone number for tap-to-call. Surfaced on winery cards (in the list
  // and inside the concierge chat) when `walkinWelcome` is false, so the
  // user can ring ahead to make a booking.
  phone?: string;
  // Owner-controlled recommendation priority. Higher values surface
  // first in the concierge's candidate slice (Concierge.retrieveCandidates
  // sorts by boost DESC, rating DESC). Set in Firestore; defaults to 0
  // when missing so unboosted wineries still order by rating.
  boost?: number;
  // ── Per-turn hydration fields (transient, set by retrieveCandidates) ──
  // Best-matching editorial description chunk for the user's question
  // this turn, attached by hydrateDescriptions(). NOT persisted; never
  // written back to Firestore. Read by compactWinery when present so
  // the per-turn row carries vibe-appropriate prose to the model.
  descriptionChunk?: string;
}

// ─── Compaction helpers ──────────────────────────────────────────────────────

function tags(w: WineryDoc): string[] {
  const t: string[] = [];
  if (w.dogFriendly) t.push("dog-friendly");
  if (w.hasRestaurant) t.push("restaurant");
  if (w.isOrganic) t.push("organic");
  if (w.isBiodynamic) t.push("biodynamic");
  // Walk-in vs. by-appointment is a TRINARY signal in the dataset:
  //   • walkinWelcome === true   → "walk-ins" tag
  //   • walkinWelcome === false  → "by-appointment" tag
  //   • walkinWelcome === undefined → no tag (we don't know)
  // We emit a positive signal in BOTH known cases so the model can tell
  // an appointment-only cellar door apart from one we simply don't have
  // data for. Without the explicit "by-appointment" tag, the model
  // tended to hedge on these wineries (the HARD_RULES forbid claiming
  // an unconfirmed booking, and the absence of a walk-ins tag looked
  // like "visit-ability unknown" rather than "appointment only").
  if (w.walkinWelcome === true) t.push("walk-ins");
  if (w.walkinWelcome === false) t.push("by-appointment");
  // Editorial accolades and tour availability. Both are owner-curated
  // booleans in Firestore; emit them as tags so the concierge can both
  // FILTER on them (when the router asks) and TALK about them (when the
  // model is reading a per-turn winery row).
  if (w.awardWinning) t.push("award-winning");
  if (w.hasTours) t.push("tours");
  if (w.featured) t.push("featured");
  return t;
}

// Compact-mode per-row blurb. We use the whole first paragraph of the
// Firestore description (not just the first sentence as in the old
// implementation, which was producing thin, recycled-feeling replies).
// 400 chars is a generous editorial intro — enough for ~2-3 sentences
// of real character, while still keeping ≥6-winery slices bounded.
const BLURB_MAX = 400;

function firstParagraph(w: WineryDoc): string {
  if (Array.isArray(w.description) && w.description.length > 0) {
    return String(w.description[0] || "").trim();
  }
  if (typeof w.description === "string") {
    // Plain-string descriptions get split on blank lines so the
    // legacy format still gets paragraph-aware treatment.
    return w.description.split(/\n\s*\n/)[0].trim();
  }
  return "";
}

function blurb(w: WineryDoc): string {
  const para = firstParagraph(w);
  if (!para) return "";
  if (para.length <= BLURB_MAX) return para;
  // Truncate at a sentence boundary inside the cap when possible so the
  // blurb doesn't end mid-clause.
  const slice = para.slice(0, BLURB_MAX);
  const lastStop = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? ")
  );
  if (lastStop > BLURB_MAX * 0.6) {
    return para.slice(0, lastStop + 1).trim();
  }
  return slice.trimEnd() + "...";
}

// Full multi-paragraph description, joined with blank lines so the
// model sees the editorial structure the writer intended. Used by
// renderWineryFull for focus-mode turns (specific_winery / small
// slices) where shipping the whole description is worth the tokens.
function fullDescription(w: WineryDoc): string {
  if (Array.isArray(w.description) && w.description.length > 0) {
    return w.description
      .map((p) => String(p || "").trim())
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof w.description === "string") {
    return w.description.trim();
  }
  return "";
}

// ─── Hours formatting ────────────────────────────────────────────────────────
// Identical normalisation logic to the Node version so we get the same
// per-day output the model has been tuned against.

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_FULL_TO_SHORT: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
  mon: "Mon", tue: "Tue", tues: "Tue", wed: "Wed", thu: "Thu",
  thur: "Thu", thurs: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

function normaliseDayLabel(rawDay?: string): string | null {
  if (!rawDay) return null;
  const d = String(rawDay).trim().toLowerCase();
  if (d === "daily" || d === "open daily" || d === "every day") return "Daily";
  if (d === "hours") return null;
  const rangeMatch = d.match(/^(\w+)\s*[–\-]\s*(\w+)$/);
  if (rangeMatch) {
    const a = DAY_FULL_TO_SHORT[rangeMatch[1]];
    const b = DAY_FULL_TO_SHORT[rangeMatch[2]];
    if (a && b) return `${a}-${b}`;
  }
  return DAY_FULL_TO_SHORT[d] || rawDay;
}

function compactTime(t?: string): string {
  if (!t) return "";
  let s = String(t).trim();
  if (/^closed$/i.test(s)) return "Closed";
  s = s.replace(/\s*(?::00)?\s*(am|pm)/gi, "").replace(/\s+/g, "");
  s = s.replace(/[–—]/g, "-");
  return s;
}

function formatHours(w: WineryDoc): string {
  const arr = Array.isArray(w.hoursStructured) ? w.hoursStructured : null;
  if (arr && arr.length > 0) {
    const dayMap: Record<string, string> = {};
    const extras: string[] = [];

    for (const entry of arr) {
      const label = normaliseDayLabel(entry.day);
      const time = compactTime(entry.time);
      if (!label) {
        extras.push(`raw='${entry.time}'`);
        continue;
      }
      if (label === "Daily") {
        for (const d of DAY_ORDER) dayMap[d] = time;
        continue;
      }
      const range = label.match(/^([A-Z][a-z]{2})-([A-Z][a-z]{2})$/);
      if (range) {
        const start = DAY_ORDER.indexOf(range[1] as typeof DAY_ORDER[number]);
        const end = DAY_ORDER.indexOf(range[2] as typeof DAY_ORDER[number]);
        if (start !== -1 && end !== -1) {
          let i = start;
          while (true) {
            dayMap[DAY_ORDER[i]] = time;
            if (i === end) break;
            i = (i + 1) % 7;
          }
          continue;
        }
      }
      if ((DAY_ORDER as readonly string[]).includes(label)) {
        dayMap[label] = time;
      } else {
        extras.push(`${label}: ${time}`);
      }
    }

    const orderedParts = DAY_ORDER
      .filter((d) => dayMap[d] !== undefined)
      .map((d) => `${d}: ${dayMap[d]}`);

    const all = [...orderedParts, ...extras];
    if (all.length > 0) return all.join(", ");
  }

  if (w.hours) {
    return `raw='${String(w.hours).replace(/\n/g, " ").replace(/'/g, "\\'")}'`;
  }
  return "";
}

// ─── One winery → one detail line ─────────────────────────────────────────────
// Full per-winery row. Used in the per-turn detail slice (small, ~10-20 rows).
// Includes hours, coords, blurb — everything the model needs to give a
// detailed recommendation for THIS winery.

// Cap on the hydrated description chunk in BROWSE mode (i.e. when the
// slice is wide enough that we can't afford full multi-paragraph
// descriptions for every winery). Bumped from 280 → 700 because the
// previous cap was producing the "recycled line or two" feel — a
// vector-retrieved chunk needs room to actually say something.
const DESC_CHUNK_MAX = 700;

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 3).trimEnd() + "...";
}

// ─── Compact (browse) row ─────────────────────────────────────────────────────
// Single-line pipe-delimited row used when the slice is wide (>5 wineries:
// itineraries, regional surveys, broad feature searches). Trades editorial
// depth for token budget — every winery gets its first paragraph (capped),
// not the full description.
export function compactWinery(w: WineryDoc): string {
  const fields: string[] = [];
  fields.push(`id:${w.slug || w.id}`);
  fields.push(`name:${w.name || "(unnamed)"}`);
  if (w.region) fields.push(`region:${w.region}`);
  if (typeof w.rating === "number") fields.push(`rating:${w.rating.toFixed(1)}`);
  const h = formatHours(w);
  if (h) fields.push(`hours:${h}`);
  const t = tags(w);
  if (t.length) fields.push(`tags:${t.join(",")}`);
  // Description handling: when the router asked for description
  // retrieval and a chunk landed for this winery, emit it as `desc:`
  // (the richer, query-matched prose). Otherwise fall back to the
  // first-paragraph blurb (capped at BLURB_MAX) so every row has real
  // editorial character rather than a clipped first sentence.
  if (typeof w.descriptionChunk === "string" && w.descriptionChunk.trim()) {
    // Collapse newlines so the pipe row stays on one line.
    const chunk = w.descriptionChunk.replace(/\s+/g, " ").trim();
    fields.push(`desc:${truncate(chunk, DESC_CHUNK_MAX)}`);
  } else {
    const b = blurb(w);
    if (b) {
      // Collapse newlines for the same reason — the compact row format
      // is one-line pipe-delimited.
      fields.push(`note:${b.replace(/\s+/g, " ")}`);
    }
  }
  return fields.join(" | ");
}

// ─── Full (focus) block ───────────────────────────────────────────────────────
// Multi-line block used when the slice is narrow (≤5 wineries — typically
// specific_winery turns, or any turn the router judged is about a small
// set of producers). Ships the FULL multi-paragraph Firestore description
// so the model can actually flesh out an answer rather than recite a
// one-liner. Format is intentionally different from the compact row so
// the model parses paragraph breaks correctly.
//
//   === <Name> (id:<slug>) ===
//   region: <region>
//   rating: <rating>
//   hours: <hours>
//   tags: <comma-separated tags>
//   description:
//   <paragraph 1>
//
//   <paragraph 2>
//
//   <paragraph 3>
//
// When no Firestore description exists, falls back to the vector chunk
// (uncapped here — focus mode wants the prose). When neither exists,
// the description block is omitted entirely.
export function renderWineryFull(w: WineryDoc): string {
  const lines: string[] = [];
  lines.push(`=== ${w.name || "(unnamed)"} (id:${w.slug || w.id}) ===`);
  if (w.region) lines.push(`region: ${w.region}`);
  if (typeof w.rating === "number") {
    lines.push(`rating: ${w.rating.toFixed(1)}`);
  }
  const h = formatHours(w);
  if (h) lines.push(`hours: ${h}`);
  const t = tags(w);
  if (t.length) lines.push(`tags: ${t.join(", ")}`);

  const desc = fullDescription(w);
  if (desc) {
    lines.push("description:");
    lines.push(desc);
  } else if (
    typeof w.descriptionChunk === "string" &&
    w.descriptionChunk.trim()
  ) {
    lines.push("description:");
    lines.push(w.descriptionChunk.trim());
  }

  return lines.join("\n");
}

// ─── "Open today" for the world index ────────────────────────────────────────
// Computes the open / closed / unknown state for one winery on a specific
// short-form weekday ("Mon"…"Sun"), with a tidy close-time string when open
// and parseable. Returns null when the dataset doesn't tell us (no
// hoursStructured, or no matching day entry) — callers omit the today:
// field in that case rather than guess.
//
// Why this lives in the world index, not just the per-turn slice: the
// model is asked about wineries that aren't in the per-turn slice all the
// time ("is Delamere open?"), and without an "open today" hint in the
// index it has to either deflect or look up the per-turn block. A single
// per-row token gives it enough to say "open until 5pm" or "closed today"
// for every winery in the corpus, every turn.
//
// Cache cost: the world index is part of the cached system prompt, and
// "today" changes daily — so the prompt cache effectively rotates once
// per calendar day. That's acceptable: cache hits are still bounded per
// session-day, and the alternative (model deflecting on hours for
// non-sliced wineries) is the user-visible bug we're fixing.

const DAY_ORDER_LOWER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

type TodayState =
  | { state: "open"; closeTime?: string }
  | { state: "closed" };

function todayStatus(w: WineryDoc, todayShort: string): TodayState | null {
  if (!Array.isArray(w.hoursStructured) || w.hoursStructured.length === 0) {
    return null;
  }
  const want = todayShort.toLowerCase();
  const wantIdx = DAY_ORDER_LOWER.findIndex((d) => want.startsWith(d));

  for (const entry of w.hoursStructured) {
    const label = String(entry?.day || "").toLowerCase().trim();
    const time = String(entry?.time || "").trim();
    if (!label) continue;

    let matches = false;
    if (label === "daily" || label === "open daily" || label === "every day") {
      matches = true;
    } else if (label.startsWith(want)) {
      matches = true;
    } else {
      // Range like "wed-sun" or "mon-fri".
      const range = label.match(/^([a-z]+)\s*[–—\-]\s*([a-z]+)$/);
      if (range && wantIdx !== -1) {
        const a = DAY_ORDER_LOWER.findIndex((d) => range[1].startsWith(d));
        const b = DAY_ORDER_LOWER.findIndex((d) => range[2].startsWith(d));
        if (a !== -1 && b !== -1) {
          if (a <= b) {
            if (wantIdx >= a && wantIdx <= b) matches = true;
          } else if (wantIdx >= a || wantIdx <= b) {
            // Range wraps the week (rare but real).
            matches = true;
          }
        }
      }
    }
    if (!matches) continue;

    if (/^closed$/i.test(time)) return { state: "closed" };
    if (!time) return { state: "open" };

    // Pull the close time from formats like "10am-5pm", "10-5",
    // "11am – 4pm", "10:00 - 17:00". Use the substring after the
    // first dash/en-dash/em-dash and tidy it.
    const dashIdx = time.search(/[–—\-]/);
    if (dashIdx === -1) return { state: "open" };
    const close = time
      .slice(dashIdx + 1)
      .trim()
      .replace(/\s*:00\b/g, "")
      .replace(/\s+/g, "");
    return { state: "open", closeTime: close || undefined };
  }
  return null;
}

// ─── One winery → one index line ──────────────────────────────────────────────
// Compact row used in the cached "world index" — ships every winery, every
// turn, with the fields the model needs to KNOW IT EXISTS and answer the
// most common factual question ("is it open?"): id, name, region, rating,
// tags, AND today:<open|closed|open→close>. Hours for other days, full
// descriptions, coords, etc. still ship per-turn via `compactWinery`.
//
// Target: ~45 tokens per row. For ~73 wineries → ~3.3K tokens cached.
//
// When `todayShort` is omitted (callers that only want an existence index),
// the today: field is skipped entirely.

export function compactIndexEntry(w: WineryDoc, todayShort?: string): string {
  const fields: string[] = [];
  fields.push(`id:${w.slug || w.id}`);
  fields.push(`name:${w.name || "(unnamed)"}`);
  if (w.region) fields.push(`r:${w.region}`);
  if (typeof w.rating === "number") fields.push(`★${w.rating.toFixed(1)}`);
  const t = tags(w);
  if (t.length) fields.push(`t:${t.join(",")}`);
  if (todayShort) {
    const status = todayStatus(w, todayShort);
    if (status) {
      if (status.state === "closed") {
        fields.push("today:closed");
      } else if (status.closeTime) {
        fields.push(`today:open→${status.closeTime}`);
      } else {
        fields.push("today:open");
      }
    }
  }
  return fields.join(" | ");
}

// ─── Full corpus → cached "world index" block ────────────────────────────────
// Rendered ONCE per session and embedded in the cached system block, so
// every concierge turn pays the cached read price (~10% of input rate) for
// this whole list. The model uses this to know what exists; per-turn
// details for relevant wineries arrive separately via the filtered slice.

export function renderWorldIndex(wineries: WineryDoc[]): string {
  if (!wineries.length) return "";
  const sorted = [...wineries].sort((a, b) => {
    const ra = a.region || "~";
    const rb = b.region || "~";
    if (ra !== rb) return ra.localeCompare(rb);
    return (a.name || "").localeCompare(b.name || "");
  });
  // Today's short weekday is folded into the index so the model has an
  // "open today" hint for EVERY winery in the corpus — not only the
  // 6-12 that land in the per-turn slice. This rotates the cached
  // prompt prefix once per calendar day (acceptable).
  const todayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    new Date().getDay()
  ];
  return [
    "## Complete winery index",
    "",
    "Every winery in the SipLocal corpus is listed below in compact form.",
    "Use this index to confirm a winery's existence, its region, its basic",
    "tags, and whether it is open today. For HOURS on OTHER days, full",
    "DESCRIPTIONS, COORDS, and other detail fields, rely on the per-turn",
    "'Detail slice' that arrives in a separate user message — those fields",
    "are NOT in this index.",
    "",
    `Today is ${todayShort}.`,
    "Row format: id | name | r:region | ★rating | t:tag1,tag2 | today:<state>",
    "  today:closed         — winery is closed today.",
    "  today:open           — open today, close time not parseable.",
    "  today:open→<time>    — open today until the given time (e.g. open→5pm).",
    "  (today: field is omitted when the dataset doesn't say.)",
    "",
    ...sorted.map((w) => compactIndexEntry(w, todayShort)),
    "",
    `Total: ${wineries.length} wineries indexed.`,
  ].join("\n");
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load every winery from Firestore once. The caller (Concierge) holds
 * this list in memory for the rest of the session — we filter in-process
 * on each turn rather than re-querying Firestore.
 *
 * Returns `{ wineries }` (no longer returns a baked context string —
 * the per-turn slice is built by `Concierge.retrieveCandidates`
 * (filter-first selection by region/tag/dayOfWeek, name forcing,
 * adjacent-region expansion, owner-boost sort, drive-time sort,
 * then opt-in description hydration via retrieve.ts).
 */
export async function loadContext(
  regionId: string
): Promise<{ wineries: WineryDoc[] }> {
  // Filter by regionId so the in-memory corpus only ever holds wineries
  // for the active region. In a multi-region future this is what keeps
  // getWinery(slug) from returning a Margaret River winery when the user
  // is browsing Tasmania.
  const q = query(collection(db, "wineries"), where("regionId", "==", regionId));
  const snap = await getDocs(q);
  // Spread the doc data FIRST, then set `id` from `d.id` — this way the
  // Firestore document ID always wins over any stray `id` field that may
  // exist in the document body.
  const wineries: WineryDoc[] = snap.docs.map((d) => ({
    ...(d.data() as Omit<WineryDoc, "id">),
    id: d.id,
  }));
  return { wineries };
}
