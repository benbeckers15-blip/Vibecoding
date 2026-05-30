// functions/src/concierge/v2/nameIndex.ts
// ─────────────────────────────────────────────────────────────────────────────
// Deterministic name lookup against the corpus. Replaces three layers of
// today's orchestrator that all tried to solve the same problem in
// different ways:
//
//   • The router's `nameKeywords` extraction (LLM call, unreliable —
//     missed Tolpuddle and Abel Tasman in audit).
//   • `findFuzzyWineryMatches` (post-router fuzzy fallback on winery
//     names only — no wine support).
//   • The `forced-include + forced-protection cap` dance in retrieveCandidates
//     (tried to keep the named winery in the candidate slice once it WAS
//     identified).
//
// This file does ONE thing: turn a user message into either a winery
// slug, a wine record, or nothing. No LLM. No I/O. Pure string match
// against pre-computed indexes.
//
// Spec reference: §3.2 (deterministic anchor resolution) in
// docs/concierge-rewrite-spec.md.
//
// Behaviour contract:
//
//   • Winery match wins over wine match when both fire (stipulation #1:
//     named winery anchors). The router consumes both lookups and picks
//     the winery hit if present.
//   • A wine match's `wineryId` is the implicit winery anchor
//     (stipulation #2: wine names implicitly name their winery).
//   • A match requires every distinctive token of the candidate name to
//     appear in the user message (substring → false positives, so we
//     use tokenised set membership). One missing token = no match.
//   • Wines with no distinctive tokens after stopword filtering (e.g.
//     "Vintage Rose", "Pinot Noir" with no estate prefix) are not
//     findable by name. They are still findable via the embedding search
//     in the sommelier branch. This is a deliberate trade — we'd rather
//     miss a generic-named bottle than anchor every "pinot noir" query
//     to one specific wine.
// ─────────────────────────────────────────────────────────────────────────────

import type { WineryDoc } from "../buildContext";

// ─── Public types ──────────────────────────────────────────────────────────

/**
 * A wine row as the nameIndex needs it. The full Firestore record
 * carries more fields (vintage, variety, style, abv, price, etc.) but
 * the index only needs identity. Loader in winesLoader.ts converts
 * Firestore docs into this shape.
 */
export interface WineRecord {
  /** Firestore doc id — matches the Upstash vector id. */
  wineId: string;
  /** Owning winery's slug. The anchor that gets passed to retrieval. */
  wineryId: string;
  /** Wine's display name (e.g. "Abel Tasman Pinot Noir"). */
  name: string;
  /** Optional, kept for downstream display. */
  vintage?: string;
  variety?: string;
}

export interface WineryLookupHit {
  /** Winery's slug — the anchor passed to retrieval. */
  slug: string;
  /** Winery's display name — used for response prose. */
  name: string;
  /** Distinctive tokens that matched. Useful for debug logs / eval reports. */
  matchedTokens: string[];
}

export interface WineLookupHit {
  wineId: string;
  /** The wine's owning winery — implicit anchor (stipulation #2). */
  wineryId: string;
  /** Wine's display name. */
  name: string;
  matchedTokens: string[];
}

export interface NameIndex {
  /** Returns the best winery match, or null. */
  lookupWinery(message: string): WineryLookupHit | null;
  /** Returns the best wine match, or null. */
  lookupWine(message: string): WineLookupHit | null;
  /** Diagnostics — sizes so eval / logging can spot a degenerate index. */
  stats(): { wineries: number; wines: number; indexedWineries: number; indexedWines: number };
}

// ─── Stopwords ────────────────────────────────────────────────────────────

// Generic wine-industry / Tasmania place-name tokens. Stripped from BOTH
// winery and wine name lookups — these words don't disambiguate.
// Lifted from today's FUZZY_MATCH_STOPWORDS in orchestrator.ts and
// kept identical for behavioural continuity.
const SHARED_STOPWORDS: ReadonlySet<string> = new Set([
  "winery", "wineries", "vineyard", "vineyards", "wines", "wine",
  "cellar", "door", "estate", "estates", "company", "tasmania",
  "tasmanian", "tas", "farm", "house", "creek", "valley", "bay",
  "ridge", "hill", "hills", "rock", "river", "island", "point",
  "north", "south", "east", "west", "and", "the", "of",
]);

// Wine-specific stopwords — varietals, common style words, vintage
// markers. Applied only to WINE name tokenisation so a query like
// "pinot noir" doesn't end up anchoring to a specific bottle named
// "Pinot Noir" (Bream Creek's, etc.). The wine ANCHOR must require a
// distinctive estate-side token like "Abel Tasman" or "1830" or "Wizard".
const WINE_EXTRA_STOPWORDS: ReadonlySet<string> = new Set([
  // Red varietals
  "pinot", "noir", "shiraz", "syrah", "cabernet", "sauvignon",
  "merlot", "tempranillo", "blend",
  // White varietals
  "chardonnay", "riesling", "blanc", "gewurztraminer", "viognier",
  "fume", "semillon", "gris", "grigio", "verdelho",
  // Sparkling / sweet / rosé
  "rose", "rosé", "sparkling", "brut", "method", "traditional",
  "champagne", "blanco", "moscato", "muscat", "verdot", "petit",
  // Style / spec words
  "single", "block", "reserve", "premium", "limited", "release",
  "label", "select", "vintage", "non-vintage", "nv", "old", "vines",
]);

// 4-digit "vintage" years (1900–2099). Stripped from wine name tokens.
const VINTAGE_RE = /^(19|20)\d{2}$/;

// Tokeniser — lowercase, word-character runs of length ≥3. Allows
// digits in tokens so wine names like "1830 Chardonnay" tokenise to
// ["1830", "chardonnay"]. We keep length ≥3 here and gate on ≥4 inside
// the distinctive-token filter so the regex doesn't accidentally
// exclude short stopwords from being filtered out of LONG names.
const TOKEN_RE = /\b[a-z0-9][a-z0-9\-']{2,}\b/g;

// Possessive 's ("frogmore's", "what's") — stripped during tokenisation so
// "frogmore's pinot" matches "Frogmore Creek" instead of silently missing.
// Handles both ASCII and curly apostrophes.
const POSSESSIVE_RE = /['’]s$/;
const TRAILING_APOSTROPHE_RE = /['’]$/;

function tokenise(text: string): string[] {
  const raw = text.toLowerCase().match(TOKEN_RE) ?? [];
  return raw.map((t) =>
    t.replace(POSSESSIVE_RE, "").replace(TRAILING_APOSTROPHE_RE, "")
  );
}

function distinctiveWineryTokens(name: string): string[] {
  return tokenise(name).filter(
    (w) => w.length >= 4 && !SHARED_STOPWORDS.has(w)
  );
}

function distinctiveWineTokens(name: string): string[] {
  return tokenise(name).filter(
    (w) =>
      w.length >= 4 &&
      !SHARED_STOPWORDS.has(w) &&
      !WINE_EXTRA_STOPWORDS.has(w) &&
      !VINTAGE_RE.test(w)
  );
}

// ─── Internal indexed shape ───────────────────────────────────────────────

interface IndexedWinery {
  winery: WineryDoc;
  distinctiveTokens: Set<string>;
}

interface IndexedWine {
  wine: WineRecord;
  distinctiveTokens: Set<string>;
}

// ─── Matcher ──────────────────────────────────────────────────────────────

/**
 * Match policy: a candidate matches if EVERY distinctive token in the
 * candidate's name appears in the message token set. This is stricter
 * than today's "any distinctive token wins" rule — it stops "creek"
 * matching three different wineries — but the stopword list strips the
 * generic words anyway, so the surviving distinctive tokens are the
 * specific ones ("tolpuddle", "abel", "tasman", etc.) and requiring all
 * of them is the right precision/recall trade.
 *
 * For multi-token names (e.g. "Stefano Lubiana" → ["stefano", "lubiana"]
 * after filtering), this requires BOTH words to appear. For single-token
 * names (e.g. "Tolpuddle" → ["tolpuddle"]), it requires the word to
 * appear. Both cases land at the right behaviour.
 *
 * Ties are broken by `distinctiveTokens.size` (more specific name wins),
 * then by name length (shorter wins — preserves "Pooley" over
 * "Pooley Wines" when both match, since the shorter is the canonical).
 */
function isFullMatch(
  messageTokens: Set<string>,
  distinctiveTokens: Set<string>
): boolean {
  if (distinctiveTokens.size === 0) return false;
  for (const t of distinctiveTokens) {
    if (!messageTokens.has(t)) return false;
  }
  return true;
}

// ─── Public builder ───────────────────────────────────────────────────────

/**
 * Build a name index over the given wineries and wines. Returns
 * lookup functions; no further state is mutated.
 *
 * Cost: O(W) where W is the corpus size (wineries + wines). For
 * Tasmania today: ~80 wineries + ~140 wines = ~220 items. Tokenisation
 * runs once per item at build time, so per-lookup cost is O(N × T)
 * where N is corpus size and T is token-set lookup (effectively
 * constant). A lookup is a sub-millisecond pass.
 *
 * The orchestrator calls this once per cold start per region and
 * caches the returned index for the life of the container.
 */
export function buildNameIndex(
  wineries: WineryDoc[],
  wines: WineRecord[]
): NameIndex {
  const indexedWineries: IndexedWinery[] = wineries
    .map((w) => ({
      winery: w,
      distinctiveTokens: new Set(distinctiveWineryTokens(w.name ?? "")),
    }))
    .filter((i) => i.distinctiveTokens.size > 0);

  const indexedWines: IndexedWine[] = wines
    .map((w) => ({
      wine: w,
      distinctiveTokens: new Set(distinctiveWineTokens(w.name ?? "")),
    }))
    .filter((i) => i.distinctiveTokens.size > 0);

  return {
    lookupWinery(message: string): WineryLookupHit | null {
      const messageTokens = new Set(tokenise(message));
      if (messageTokens.size === 0) return null;

      let best: IndexedWinery | null = null;
      for (const item of indexedWineries) {
        if (!isFullMatch(messageTokens, item.distinctiveTokens)) continue;

        if (!best) {
          best = item;
          continue;
        }

        // Tie-break: more distinctive tokens wins (more specific name).
        const moreSpecific =
          item.distinctiveTokens.size > best.distinctiveTokens.size;
        const tieOnSpecificity =
          item.distinctiveTokens.size === best.distinctiveTokens.size;
        // Inner tie-break: shorter name wins (prefers canonical short forms).
        const shorter =
          (item.winery.name ?? "").length < (best.winery.name ?? "").length;

        if (moreSpecific || (tieOnSpecificity && shorter)) {
          best = item;
        }
      }

      if (!best) return null;
      const matched = [...best.distinctiveTokens].filter((t) =>
        messageTokens.has(t)
      );
      return {
        slug: best.winery.slug || best.winery.id,
        name: best.winery.name ?? "",
        matchedTokens: matched,
      };
    },

    lookupWine(message: string): WineLookupHit | null {
      const messageTokens = new Set(tokenise(message));
      if (messageTokens.size === 0) return null;

      let best: IndexedWine | null = null;
      for (const item of indexedWines) {
        if (!isFullMatch(messageTokens, item.distinctiveTokens)) continue;

        if (!best) {
          best = item;
          continue;
        }

        const moreSpecific =
          item.distinctiveTokens.size > best.distinctiveTokens.size;
        const tieOnSpecificity =
          item.distinctiveTokens.size === best.distinctiveTokens.size;
        const shorter =
          item.wine.name.length < best.wine.name.length;

        if (moreSpecific || (tieOnSpecificity && shorter)) {
          best = item;
        }
      }

      if (!best) return null;
      const matched = [...best.distinctiveTokens].filter((t) =>
        messageTokens.has(t)
      );
      return {
        wineId: best.wine.wineId,
        wineryId: best.wine.wineryId,
        name: best.wine.name,
        matchedTokens: matched,
      };
    },

    stats() {
      return {
        wineries: wineries.length,
        wines: wines.length,
        indexedWineries: indexedWineries.length,
        indexedWines: indexedWines.length,
      };
    },
  };
}

// ─── Test-only exports ────────────────────────────────────────────────────
// Surfaced for the eval harness so we can unit-test the tokeniser and
// the stopword behaviour without going through the full lookup. Not
// part of the runtime API the orchestrator consumes.

export const _internal = {
  tokenise,
  distinctiveWineryTokens,
  distinctiveWineTokens,
  isFullMatch,
  SHARED_STOPWORDS,
  WINE_EXTRA_STOPWORDS,
  VINTAGE_RE,
};
