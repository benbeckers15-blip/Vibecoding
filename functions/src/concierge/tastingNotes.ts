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
import { rerankDocuments } from "./rerank";

const EMBED_MODEL = "voyage-3-lite";
const NAMESPACE = "wines";
// Final number of tasting notes that ship to the response model. The
// orchestrator passes 8 for specific_winery turns (named producers
// deserve more bottle detail) and 4 otherwise — we honour that via
// `opts.topK`. The new flow over-fetches from Upstash then reranks
// down to this number.
const DEFAULT_TOP_K = 4;
// Wider candidate pool for the reranker to score. The wines namespace
// is small per region (~tens to low-hundreds of bottles), so pulling
// 16 is comfortable.
const VECTOR_FETCH_K = 16;
// Score floor for embedding-side prefiltering. Lowered from 0.40 to
// 0.15 (May 2026) after a Bangor-Vineyard-Shed bug surfaced where
// queries like "wines from Bangor Vineyard Shed" landed at cosine
// ~0.30 — below the old floor — and both of Bangor's wines were
// silently dropped before the reranker ever saw them. The wineryId
// IN-filter (when present) already narrows the candidate pool to the
// right producer, and the cross-encoder reranker is the precision
// gate; a high cosine floor on top of those was load-bearing
// nothing except dropped recall. 0.15 keeps clearly unrelated junk
// out (random regional drift, embedding noise) without blocking
// in-scope wines whose vectors happen not to mention the words the
// user typed.
const DEFAULT_MIN_SCORE = 0.15;

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
  // `variety` is the canonical field name (matches the source sheet).
  // `varietal` is accepted as a legacy alias for vectors that were
  // ingested before the schema upgrade — falls back to `variety` on
  // read.
  variety?: string;
  varietal?: string;
  vintage: string;
  region?: string;
  style?: string;
  color?: string;
  body?: string;
  sweetness?: string;
  oak?: string;
  abv?: string;
  price?: string;
  pairings?: string;
  awards?: string;
  authorNotes?: string;
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
  variety: string;
  vintage: string;
  region: string;
  style: string;
  color: string;
  body: string;
  sweetness: string;
  oak: string;
  abv: string;
  price: string;
  pairings: string;
  awards: string;
  authorNotes: string;
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
  // Final cap on tasting notes shipped to the response model. Honours
  // the orchestrator's per-intent override (8 for specific_winery, 4
  // for everything else), but applied AFTER the reranker so we're
  // capping the most relevant ones, not the highest-cosine ones.
  const finalTopK = opts.topK ?? DEFAULT_TOP_K;
  // Over-fetch from Upstash so the cross-encoder reranker has a real
  // candidate pool to triage. 3× headroom is enough without bloating
  // the rerank token budget for the small wines namespace.
  const fetchK = Math.max(VECTOR_FETCH_K, finalTopK * 3);
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
    topK: fetchK,
    includeMetadata: true,
    filter,
  });

  const candidates: TastingNoteHit[] = results
    .filter((r) => r.score >= minScore && r.metadata)
    .map((r) => {
      const m = r.metadata as WineVectorMetadata;
      // Optional fields are coerced to "" so downstream renderers can
      // simply check `if (h.field)` to decide whether to surface them.
      const str = (v: unknown): string =>
        v === undefined || v === null ? "" : String(v);
      return {
        wineId: String(m.wineId || r.id),
        wineryId: String(m.wineryId || ""),
        name: str(m.name),
        // Prefer the canonical `variety`; fall back to the legacy
        // `varietal` for vectors ingested before the schema upgrade.
        variety: str(m.variety) || str(m.varietal),
        vintage: str(m.vintage),
        region: str(m.region),
        style: str(m.style),
        color: str(m.color),
        body: str(m.body),
        sweetness: str(m.sweetness),
        oak: str(m.oak),
        abv: str(m.abv),
        price: str(m.price),
        pairings: str(m.pairings),
        awards: str(m.awards),
        authorNotes: str(m.authorNotes),
        notes: str(m.notes),
        score: r.score,
      };
    });

  if (candidates.length === 0) return [];

  // Build a rich document string for the reranker — concatenate the
  // fields a human would read to judge relevance to the query. We
  // deliberately include variety + vintage + sensory tags + notes so
  // a query like "dry 2019 chardonnay" gets the right signal even
  // when those words don't appear in the loose prose. Blank fields
  // are dropped so partial-metadata wines aren't penalised by empty
  // labels.
  const toDocument = (h: TastingNoteHit): string => {
    const parts: string[] = [];
    if (h.name) parts.push(h.name);
    if (h.variety) parts.push(h.variety);
    if (h.vintage) parts.push(h.vintage);
    if (h.region) parts.push(h.region);
    if (h.style) parts.push(h.style);
    if (h.sweetness) parts.push(h.sweetness);
    if (h.body) parts.push(h.body);
    if (h.oak) parts.push(`${h.oak} oak`);
    if (h.notes) parts.push(h.notes);
    if (h.pairings) parts.push(`Pairings: ${h.pairings}`);
    return parts.join(". ");
  };

  const { items } = await rerankDocuments(
    query,
    candidates,
    toDocument,
    finalTopK,
    "tasting-notes-rerank"
  );
  return items;
}

export function formatTastingNotesForPrompt(hits: TastingNoteHit[]): string {
  if (hits.length === 0) return "";
  const rows = hits.map((h) => {
    const parts: string[] = [];
    parts.push(`wineryId:${h.wineryId}`);
    parts.push(`wine:${h.name}`);
    // Identity
    if (h.variety) parts.push(`variety:${h.variety}`);
    if (h.vintage) parts.push(`vintage:${h.vintage}`);
    if (h.region) parts.push(`region:${h.region}`);
    // Sensory tags — surface only the ones the author filled in.
    // Missing tags should NOT be substituted with a default; the
    // response model should treat absence as "not specified" and
    // hedge accordingly.
    if (h.style) parts.push(`style:${h.style}`);
    if (h.color) parts.push(`color:${h.color}`);
    if (h.body) parts.push(`body:${h.body}`);
    if (h.sweetness) parts.push(`sweetness:${h.sweetness}`);
    if (h.oak) parts.push(`oak:${h.oak}`);
    // Spec
    if (h.abv) parts.push(`abv:${h.abv}`);
    if (h.price) parts.push(`price:${h.price}`);
    // Prose
    if (h.pairings) parts.push(`pairings:${h.pairings}`);
    if (h.awards) parts.push(`awards:${h.awards}`);
    if (h.notes) parts.push(`notes:${h.notes}`);
    if (h.authorNotes) parts.push(`authorNotes:${h.authorNotes}`);
    return parts.join(" | ");
  });
  return [
    "<tasting_notes>",
    "Wine-level retrieval matched these bottles. Cite by wine name when",
    "relevant; only recommend wines from THIS list (no inventing).",
    "Each row links to a winery in the relevant_wineries slice via wineryId.",
    "Note: tags (style, body, sweetness, oak, etc.) are author-supplied and",
    "may be missing for some bottles — treat absence as 'not specified',",
    "do NOT infer or invent values, and lean on the prose notes when tags",
    "are sparse.",
    "",
    ...rows,
    "</tasting_notes>",
  ].join("\n");
}
