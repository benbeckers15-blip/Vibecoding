// functions/src/concierge/tastingNotes.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side port of services/concierge/tastingNotes.ts.
//
// CHANGES FROM THE CLIENT VERSION:
//   • Env: VOYAGE / UPSTASH names renamed (no EXPO_PUBLIC_ prefix).
//   • All embedding, scoring, filter logic, and prompt-formatting are
//     unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { Index } from "@upstash/vector";
import { VoyageAIClient } from "voyageai";

const EMBED_MODEL = "voyage-3-lite";
const NAMESPACE = "wines";
const DEFAULT_TOP_K = 6;
const DEFAULT_MIN_SCORE = 0.55;

let _voyage: VoyageAIClient | null = null;
let _index: Index | null = null;

function getVoyage(): VoyageAIClient {
  if (_voyage) return _voyage;
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOYAGE_API_KEY secret is not bound to this function."
    );
  }
  _voyage = new VoyageAIClient({ apiKey });
  return _voyage;
}

function getIndex(): Index {
  if (_index) return _index;
  const url = process.env.UPSTASH_VECTOR_URL;
  const token = process.env.UPSTASH_VECTOR_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_VECTOR_URL or UPSTASH_VECTOR_TOKEN secret is not bound to this function."
    );
  }
  _index = new Index({ url, token });
  return _index;
}

export interface WineVectorMetadata {
  wineId: string;
  wineryId: string;
  name: string;
  varietal: string;
  vintage: string;
  notes: string;
  [key: string]: unknown;
}

export interface TastingNoteOptions {
  /**
   * REQUIRED. Scopes the search to wines ingested for this region — the
   * `regionId` metadata field on each Upstash vector. Backfilled by
   * `scripts/rag/ingest-tasting-notes.js --force` whenever the schema or
   * the active set of regions changes.
   */
  regionId: string;
  topK?: number;
  wineryIds?: string[];
  minScore?: number;
}

export interface TastingNoteHit {
  wineId: string;
  wineryId: string;
  name: string;
  varietal: string;
  vintage: string;
  notes: string;
  score: number;
}

function buildFilter(opts: TastingNoteOptions): string {
  const clauses: string[] = [];

  // Region scope is non-optional. A missing regionId would let Tasmanian
  // wines leak into a Margaret River query (and vice versa once a second
  // region is ingested).
  clauses.push(`regionId = '${opts.regionId.replace(/'/g, "''")}'`);

  if (opts.wineryIds && opts.wineryIds.length > 0) {
    const list = opts.wineryIds
      .map((id) => `'${id.replace(/'/g, "''")}'`)
      .join(", ");
    clauses.push(`wineryId IN (${list})`);
  }

  return clauses.join(" AND ");
}

export async function retrieveTastingNotes(
  query: string,
  opts: TastingNoteOptions
): Promise<TastingNoteHit[]> {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;

  const voyage = getVoyage();
  const embedResp = await voyage.embed({
    input: [query],
    model: EMBED_MODEL,
    inputType: "query",
  });
  const vector = embedResp?.data?.[0]?.embedding;
  if (!vector || !Array.isArray(vector)) {
    throw new Error("Voyage returned no embedding for the query");
  }

  const ns = getIndex().namespace(NAMESPACE);
  const filter = buildFilter(opts);
  const results = await ns.query<WineVectorMetadata>({
    vector,
    topK,
    includeMetadata: true,
    filter,
  });

  return results
    .filter((r) => r.score >= minScore && r.metadata)
    .map((r) => {
      const m = r.metadata as WineVectorMetadata;
      return {
        wineId: String(m.wineId || r.id),
        wineryId: String(m.wineryId || ""),
        name: String(m.name || ""),
        varietal: String(m.varietal || ""),
        vintage: String(m.vintage || ""),
        notes: String(m.notes || ""),
        score: r.score,
      };
    });
}

export function formatTastingNotesForPrompt(hits: TastingNoteHit[]): string {
  if (hits.length === 0) return "";
  const rows = hits.map((h) => {
    const parts: string[] = [];
    parts.push(`wineryId:${h.wineryId}`);
    parts.push(`wine:${h.name}`);
    if (h.varietal) parts.push(`varietal:${h.varietal}`);
    if (h.vintage) parts.push(`vintage:${h.vintage}`);
    if (h.notes) parts.push(`notes:${h.notes}`);
    return parts.join(" | ");
  });
  return [
    "<tasting_notes>",
    "Wine-level retrieval matched these bottles. Cite by wine name when",
    "relevant; only recommend wines from THIS list (no inventing).",
    "Each row links to a winery in the relevant_wineries slice via wineryId.",
    "",
    ...rows,
    "</tasting_notes>",
  ].join("\n");
}
