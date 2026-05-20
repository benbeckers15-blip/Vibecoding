// functions/src/concierge/buildContext.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side port of services/concierge/buildContext.ts.
//
// MEANINGFUL CHANGE FROM THE CLIENT VERSION:
//   • The client used the Firebase client SDK (firebase/firestore) to read
//     the wineries collection. On the server we use firebase-admin, which
//     has a different API (db.collection().get() instead of
//     getDocs(collection(db, …))) and runs with full read access — no
//     security rules apply.
//   • Everything else (compaction, hours formatting, tag emission, world
//     index rendering) is bit-for-bit identical so the model sees the
//     same payload it has been tuned against on the client.
// ─────────────────────────────────────────────────────────────────────────────

import { getFirestore } from "firebase-admin/firestore";

// ─── Tasmania sub-regions ────────────────────────────────────────────────────

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
  awardWinning?: boolean;
  hasTours?: boolean;
  featured?: boolean;
  phone?: string;
  boost?: number;
  // Transient per-turn hydration; never persisted to Firestore.
  descriptionChunk?: string;
}

// ─── Compaction helpers ──────────────────────────────────────────────────────

function tags(w: WineryDoc): string[] {
  const t: string[] = [];
  if (w.dogFriendly) t.push("dog-friendly");
  if (w.hasRestaurant) t.push("restaurant");
  if (w.isOrganic) t.push("organic");
  if (w.isBiodynamic) t.push("biodynamic");
  if (w.walkinWelcome === true) t.push("walk-ins");
  if (w.walkinWelcome === false) t.push("by-appointment");
  if (w.awardWinning) t.push("award-winning");
  if (w.hasTours) t.push("tours");
  if (w.featured) t.push("featured");
  return t;
}

const BLURB_MAX = 400;

function firstParagraph(w: WineryDoc): string {
  if (Array.isArray(w.description) && w.description.length > 0) {
    return String(w.description[0] || "").trim();
  }
  if (typeof w.description === "string") {
    return w.description.split(/\n\s*\n/)[0].trim();
  }
  return "";
}

function blurb(w: WineryDoc): string {
  const para = firstParagraph(w);
  if (!para) return "";
  if (para.length <= BLURB_MAX) return para;
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

// ─── Per-winery row renderers ─────────────────────────────────────────────────

const DESC_CHUNK_MAX = 700;

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 3).trimEnd() + "...";
}

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
  if (typeof w.descriptionChunk === "string" && w.descriptionChunk.trim()) {
    const chunk = w.descriptionChunk.replace(/\s+/g, " ").trim();
    fields.push(`desc:${truncate(chunk, DESC_CHUNK_MAX)}`);
  } else {
    const b = blurb(w);
    if (b) {
      fields.push(`note:${b.replace(/\s+/g, " ")}`);
    }
  }
  return fields.join(" | ");
}

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
      const range = label.match(/^([a-z]+)\s*[–—\-]\s*([a-z]+)$/);
      if (range && wantIdx !== -1) {
        const a = DAY_ORDER_LOWER.findIndex((d) => range[1].startsWith(d));
        const b = DAY_ORDER_LOWER.findIndex((d) => range[2].startsWith(d));
        if (a !== -1 && b !== -1) {
          if (a <= b) {
            if (wantIdx >= a && wantIdx <= b) matches = true;
          } else if (wantIdx >= a || wantIdx <= b) {
            matches = true;
          }
        }
      }
    }
    if (!matches) continue;

    if (/^closed$/i.test(time)) return { state: "closed" };
    if (!time) return { state: "open" };

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

export function renderWorldIndex(wineries: WineryDoc[]): string {
  if (!wineries.length) return "";
  const sorted = [...wineries].sort((a, b) => {
    const ra = a.region || "~";
    const rb = b.region || "~";
    if (ra !== rb) return ra.localeCompare(rb);
    return (a.name || "").localeCompare(b.name || "");
  });
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
 * Load every winery from Firestore once per cold start. The orchestrator
 * (index.ts) holds the result in module-level memo so warm invocations
 * skip the Firestore round-trip entirely.
 *
 * Uses firebase-admin (NOT the client SDK). Admin reads bypass security
 * rules — fine, because the wineries collection is public-read anyway,
 * and the function runs in a trusted server environment.
 */
export async function loadContext(): Promise<{ wineries: WineryDoc[] }> {
  const db = getFirestore();
  const snap = await db.collection("wineries").get();
  const wineries: WineryDoc[] = snap.docs.map((d) => ({
    ...(d.data() as Omit<WineryDoc, "id">),
    id: d.id,
  }));
  return { wineries };
}
