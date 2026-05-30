// functions/src/concierge/v2/envelope.ts
// ─────────────────────────────────────────────────────────────────────────────
// Per-turn user message builder. Assembles the data blocks the
// orchestrator's branch decided to include and packages them around
// the user's verbatim question.
//
// Block order (spec §5):
//   <today>                                     — always
//   <user_location>                             — when GPS + relevant
//   <relevant_wineries>                         — when winery rows present
//   <tasting_notes>                             — when retrieved
//   <knowledge_base>                            — when retrieved
//   <source_excerpts>                           — when retrieved
//   <unrecognised_winery>                       — deflection sentinel A
//   <wine_not_in_notes>                         — deflection sentinel B
//   <clarifying_question>                       — router-emitted only
//
//   {user message verbatim}
//
// Sentinel blocks are the v2-new piece. They surface a structured
// signal to the response model that the user named a thing we
// couldn't fully ground, and the system prompt has rules covering
// exactly how to respond.
//
// All blocks omit themselves when empty, so the model never sees a
// placeholder. Adding a block here only requires adding a field to
// EnvelopeBlocks + handling it in buildEnvelope.
// ─────────────────────────────────────────────────────────────────────────────

import {
  compactWinery,
  renderWineryFull,
  type WineryDoc,
} from "../buildContext";

// Threshold at which we switch from full-detail rendering (Format A —
// =====-headers + paragraphs of description) to compact rows (Format B
// — pipe-delimited single line per winery). Lifted from v1 unchanged.
const FULL_DETAIL_SLICE_THRESHOLD = 5;

export interface EnvelopeBlocks {
  /** Long weekday name in the user's timezone — "Wednesday". */
  todayLong: string;
  /** Optional GPS-based location anchor. */
  userLocationDescription?: string;
  /** Winery rows the branch chose to surface. Empty omits the block. */
  wineries: WineryDoc[];
  /** Pre-formatted tasting-notes block — usually from formatTastingNotesV2. */
  tastingNotesBlock?: string;
  /** Pre-formatted knowledge-base block. */
  knowledgeBlock?: string;
  /** Pre-formatted source-excerpts block. */
  sourceExcerptsBlock?: string;
  /**
   * Sentinel A — the user named a winery and the nameIndex didn't
   * match it to the corpus. System prompt rule (3-bucket grounding)
   * tells the model to go encyclopedic from general knowledge or
   * deflect, depending on whether it recognises the name.
   *
   * Value is the user's quoted reference (e.g. `"House of Arras"`).
   */
  unrecognisedWinery?: string;
  /**
   * Sentinel B — the user named a wine, the name index matched it to
   * a corpus winery, but the wine itself wasn't returned in
   * <tasting_notes>. System prompt rule (wine-tier-B) tells the model
   * to speak to the winery's style without inventing tasting notes.
   *
   * Value is the wine name plus its owning winery name, separated
   * by " by " — e.g. `"Sailor Seeks Horse Pinot Noir" by Sailor Seeks Horse`.
   */
  wineNotInNotes?: string;
  /**
   * Router-emitted clarifying question (stipulation #12). When
   * present, the orchestrator builds a clarifying-only envelope (no
   * retrieval data) and the response model asks exactly this
   * question. See spec §3.3.
   */
  clarifyingQuestion?: string;
  /** The user's verbatim message — appended last, no XML wrapping. */
  userMessage: string;
}

/**
 * Build the per-turn user message. Every block omits itself when
 * empty so the model only sees populated context.
 */
export function buildEnvelope(blocks: EnvelopeBlocks): string {
  const parts: string[] = [];

  parts.push(`<today>${blocks.todayLong}</today>`);

  if (blocks.userLocationDescription) {
    parts.push(
      `<user_location>${blocks.userLocationDescription}</user_location>`
    );
  }

  const wineryBlock = renderWineryBlock(blocks.wineries);
  if (wineryBlock) {
    parts.push(`<relevant_wineries>\n${wineryBlock}\n</relevant_wineries>`);
  }

  if (blocks.tastingNotesBlock && blocks.tastingNotesBlock.trim()) {
    parts.push(blocks.tastingNotesBlock);
  }

  if (blocks.knowledgeBlock && blocks.knowledgeBlock.trim()) {
    parts.push(blocks.knowledgeBlock);
  }

  if (blocks.sourceExcerptsBlock && blocks.sourceExcerptsBlock.trim()) {
    parts.push(blocks.sourceExcerptsBlock);
  }

  if (blocks.unrecognisedWinery) {
    // Quote the reference so the model can echo it back if needed.
    parts.push(
      `<unrecognised_winery>"${escapeForXml(
        blocks.unrecognisedWinery
      )}"</unrecognised_winery>`
    );
  }

  if (blocks.wineNotInNotes) {
    parts.push(
      `<wine_not_in_notes>${escapeForXml(
        blocks.wineNotInNotes
      )}</wine_not_in_notes>`
    );
  }

  if (blocks.clarifyingQuestion) {
    parts.push(
      `<clarifying_question>${escapeForXml(
        blocks.clarifyingQuestion
      )}</clarifying_question>`
    );
  }

  parts.push(blocks.userMessage);
  return parts.join("\n\n");
}

/**
 * Render the wineries block. Format A (full-detail with paragraphs)
 * for ≤5 wineries; Format B (compact pipe-rows) for >5. Same
 * threshold as v1.
 */
function renderWineryBlock(wineries: WineryDoc[]): string {
  if (wineries.length === 0) return "";
  if (wineries.length <= FULL_DETAIL_SLICE_THRESHOLD) {
    return wineries.map(renderWineryFull).join("\n\n");
  }
  return wineries.map(compactWinery).join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Minimal XML escaping for sentinel block content. The model sees
 * <unrecognised_winery>"House of Arras"</unrecognised_winery> — if
 * the user's reference happens to contain "<" or "&", we'd otherwise
 * corrupt the parser. Strict but unsurprising.
 */
function escapeForXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Test-only — eval harness uses this to verify block presence/absence
// without parsing the full envelope.
export const _internal = {
  renderWineryBlock,
  escapeForXml,
  FULL_DETAIL_SLICE_THRESHOLD,
};
