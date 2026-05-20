// functions/src/concierge/parsers.ts
// ─────────────────────────────────────────────────────────────────────────────
// Pure parsing helpers extracted from the client's concierge.ts.
//
// These are reply-shape parsers (no external calls, no IO). They live in
// their own file so:
//   • The streaming endpoint in index.ts can import the markers + parsers
//     without dragging in the rest of the orchestrator.
//   • The orchestrator.ts file isn't 1,500 lines like the client's was.
//
// EVERY parser is fail-soft — a malformed model output strips the block
// but never throws. The chat must never break because the model emitted
// a slightly-off marker.
// ─────────────────────────────────────────────────────────────────────────────

// ── Trip-plan markers ───────────────────────────────────────────────────────
// Must match the strings the model is instructed to emit in systemPrompt.ts.
// Keep these constants and the protocol text in sync.
export const TRIP_PLAN_OPEN = "<<TRIP_PLAN>>";
export const TRIP_PLAN_CLOSE = "<<END_TRIP_PLAN>>";

// ── Winery-card markers ─────────────────────────────────────────────────────
export const WINERY_CARD_OPEN = "<<WINERY_CARD>>";
export const WINERY_CARD_CLOSE = "<<END_WINERY_CARD>>";

// Lowercase prefix used for case-insensitive streaming suppression.
// Catches wrong-case variants like <<Winery_Card... before they hit the UI.
export const WINERY_CARD_PREFIX_LOWER = "<<winery_card";

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TRIP_PLAN_RE = new RegExp(
  `\\s*${escapeForRegex(TRIP_PLAN_OPEN)}\\s*([\\s\\S]*?)\\s*${escapeForRegex(TRIP_PLAN_CLOSE)}\\s*`
);

const WINERY_CARD_RE = new RegExp(
  `\\s*${escapeForRegex(WINERY_CARD_OPEN)}\\s*([\\s\\S]*?)\\s*${escapeForRegex(WINERY_CARD_CLOSE)}\\s*`
);

// Fuzzy fallback. Matches any <<winery_card... (case-insensitive) followed
// by a "slugs":[...] array. Catches things like <<Winery_Card,("slugs":["x"])
// that don't match the strict regex.
const WINERY_CARD_FUZZY_RE =
  /<<\s*winery[_\s-]?card[\s\S]{0,80}?"slugs"\s*:\s*(\[[^\]]*\])/i;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TripProposal {
  /** Short editorial label the sommelier picked, e.g. "Coal River pinot day". */
  name: string;
  /** Ordered winery slugs (== Firestore document ids in this app). */
  slugs: string[];
}

export interface WineryCardSuggestion {
  /** Slugs of wineries the model wants to surface as cards. */
  slugs: string[];
}

// ─── parseTripProposal ──────────────────────────────────────────────────────

/**
 * Pull a trip-plan block out of a reply. Returns the cleaned reply (block
 * stripped, surrounding text preserved) and the parsed proposal — or null
 * if no block was found or the JSON was malformed.
 *
 * Fail-soft: any parse failure returns the original reply with no
 * proposal, so a malformed model output can never break the chat.
 */
export function parseTripProposal(reply: string): {
  cleaned: string;
  proposal: TripProposal | null;
} {
  if (!reply) return { cleaned: reply, proposal: null };
  const match = reply.match(TRIP_PLAN_RE);
  if (!match) return { cleaned: reply, proposal: null };

  const before = reply.slice(0, match.index ?? 0).trimEnd();
  const after = reply.slice((match.index ?? 0) + match[0].length).trimStart();
  const cleaned = [before, after].filter((s) => s.length > 0).join("\n\n");
  const rawJson = match[1];

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "slugs" in parsed &&
      Array.isArray((parsed as { slugs: unknown }).slugs)
    ) {
      const obj = parsed as { name?: unknown; slugs: unknown[] };
      const slugs = obj.slugs
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      if (slugs.length < 2) {
        return { cleaned, proposal: null };
      }
      const name =
        typeof obj.name === "string" && obj.name.trim().length > 0
          ? obj.name.trim()
          : "Sommelier trip";
      return { cleaned, proposal: { name, slugs } };
    }
    return { cleaned, proposal: null };
  } catch {
    return { cleaned, proposal: null };
  }
}

// ─── parseWineryCards ───────────────────────────────────────────────────────

/**
 * Pull a winery-card block out of a reply. Strict path first, fuzzy
 * fallback second (catches wrong-case / wrong-separator variants).
 *
 * Returns the cleaned reply and the parsed slugs — or null if absent /
 * malformed. Slugs are NOT validated against the corpus here; the client
 * does that final check when rendering the cards.
 */
export function parseWineryCards(reply: string): {
  cleaned: string;
  wineryCards: WineryCardSuggestion | null;
} {
  if (!reply) return { cleaned: reply, wineryCards: null };

  // Strict path
  const match = reply.match(WINERY_CARD_RE);
  if (match) {
    const before = reply.slice(0, match.index ?? 0).trimEnd();
    const after = reply.slice((match.index ?? 0) + match[0].length).trimStart();
    const cleaned = [before, after].filter((s) => s.length > 0).join("\n\n");
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "slugs" in parsed &&
        Array.isArray((parsed as { slugs: unknown }).slugs)
      ) {
        const slugs = (parsed as { slugs: unknown[] }).slugs.filter(
          (s): s is string => typeof s === "string" && s.length > 0
        );
        if (slugs.length > 0) return { cleaned, wineryCards: { slugs } };
      }
    } catch {
      // fall through
    }
    return { cleaned, wineryCards: null };
  }

  // Fuzzy fallback
  const fuzzyMatch = reply.match(WINERY_CARD_FUZZY_RE);
  if (fuzzyMatch) {
    const markerStart = fuzzyMatch.index ?? 0;
    const cleaned = reply.slice(0, markerStart).trimEnd();
    try {
      const slugs = (JSON.parse(fuzzyMatch[1]) as unknown[]).filter(
        (s): s is string => typeof s === "string" && s.length > 0
      );
      if (slugs.length > 0) return { cleaned, wineryCards: { slugs } };
    } catch {
      return { cleaned, wineryCards: null };
    }
  }

  return { cleaned: reply, wineryCards: null };
}

// ─── trimToCompleteSentence ─────────────────────────────────────────────────

/**
 * Trim a reply back to the last complete sentence. Used as a safety net
 * when the model hits MAX_TOKENS and would otherwise dump a half-finished
 * sentence into the UI.
 */
export function trimToCompleteSentence(reply: string): string {
  const trimmed = reply.trimEnd();
  if (!trimmed) return trimmed;

  if (/[.!?…](["'’”)\]]?)$/.test(trimmed)) {
    return trimmed;
  }

  const re = /[.!?…](["'’”)\]]?)(?=\s|$)/g;
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd > 0) {
    return trimmed.slice(0, lastEnd).trimEnd();
  }

  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace > 0) {
    return trimmed.slice(0, lastSpace).trimEnd() + "…";
  }
  return trimmed + "…";
}
