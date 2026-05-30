// functions/src/concierge/knowledgeRetrieve.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side port of services/concierge/knowledgeRetrieve.ts.
//
// CHANGES FROM THE CLIENT VERSION:
//   • Env: EXPO_PUBLIC_VOYAGE_API_KEY / UPSTASH_VECTOR_* renamed (no prefix).
//   • Firestore: swap firebase/firestore (client SDK) → firebase-admin.
//     The admin SDK has `getAll(...DocumentRef[])`, which is cleaner and
//     more efficient than the client SDK's chunked `where(documentId(),
//     'in', ...)` we needed to use before. We use `db.getAll()` directly
//     instead of batching.
// All ranking + scoring + filtering logic is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { Index } from "@upstash/vector";
import { VoyageAIClient } from "voyageai";
import { getFirestore } from "firebase-admin/firestore";
import { rerankDocuments } from "./rerank";

const EMBED_MODEL = "voyage-3-lite";
const NAMESPACE = "knowledge";
const COLLECTION = "knowledge_chunks";
// Final number of chunks that ship to the response model. Trimmed from
// the previous DEFAULT_TOP_K=4 because the cross-encoder reranker (see
// rerank.ts) lets us trust precision more — fewer chunks, less noise,
// less prompt input cost.
const DEFAULT_TOP_K = 3;
// Wider candidate pool the reranker scores. We fetch up to this many
// from Upstash, then narrow to DEFAULT_TOP_K via Voyage Rerank.
// 12 is comfortable headroom for the reranker to pick a sharp top-3
// without bloating the rerank call's own token budget.
const VECTOR_FETCH_K = 12;
// Looser score floor on the vector-search side, because the reranker
// is now the precision gate. Previously 0.65; loosened to 0.45 so a
// late-stage reranker can still pull in a relevant chunk that the
// embedding model rated as borderline.
const DEFAULT_MIN_SCORE = 0.45;

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

export interface KnowledgeVectorMetadata {
  type: string;
  seasons: string[];
  months: string[];
  regions: string[];
  sentiment: string;
  taxonomy_new: boolean;
  sourcePath: string;
  [key: string]: unknown;
}

export interface KnowledgeChunk {
  id: string;
  score: number;
  text: string;
  type: string;
  topic: string;
  seasons: string[];
  months: string[];
  regions: string[];
  tags: string[];
  sentiment: string;
  sourcePath: string;
  headingPath: string[];
}

export interface KnowledgeRetrieveOptions {
  /**
   * REQUIRED. Scopes the search to chunks ingested for this region — the
   * `regionId` metadata field on each Upstash vector. Chunks ingested before
   * the multi-region migration won't carry this field and so won't match;
   * re-run `scripts/rag/ingest.js --force` to backfill the metadata before
   * deploying retrieval code that includes this filter.
   */
  regionId: string;
  topK?: number;
  minScore?: number;
  /** Sub-regions (e.g. "Tamar Valley"). Not the same as regionId. */
  regions?: string[];
  seasons?: string[];
  type?: string;
}

function buildFilter(opts: KnowledgeRetrieveOptions): string {
  const clauses: string[] = [];

  // Region scope is non-optional. A missing regionId would let Tasmanian
  // chunks leak into a Margaret River query (and vice versa once a second
  // region is ingested).
  clauses.push(`regionId = '${opts.regionId.replace(/'/g, "''")}'`);

  if (opts.regions && opts.regions.length > 0) {
    const ors = opts.regions
      .map((r) => `regions CONTAINS '${r.replace(/'/g, "''")}'`)
      .join(" OR ");
    clauses.push(`(${ors})`);
  }

  if (opts.seasons && opts.seasons.length > 0) {
    const ors = opts.seasons
      .map((s) => `seasons CONTAINS '${s.replace(/'/g, "''")}'`)
      .join(" OR ");
    clauses.push(`(${ors})`);
  }

  if (opts.type) {
    clauses.push(`type = '${opts.type.replace(/'/g, "''")}'`);
  }

  return clauses.join(" AND ");
}

// Server-side Firestore hydration. firebase-admin supports `getAll()` with
// an unbounded number of DocumentReferences — no need to chunk into batches
// of 30 like the client SDK required.
async function hydrateChunks(
  ids: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const byId = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return byId;

  const db = getFirestore();
  const refs = ids.map((id) => db.collection(COLLECTION).doc(id));
  const snaps = await db.getAll(...refs);
  for (const snap of snaps) {
    if (snap.exists) {
      byId.set(snap.id, snap.data() as Record<string, unknown>);
    }
  }
  return byId;
}

export async function retrieveKnowledge(
  query: string,
  opts: KnowledgeRetrieveOptions
): Promise<KnowledgeChunk[]> {
  // Final cap on chunks shipped to the response model. The caller can
  // override per-turn (rare); default 3 with rerank-as-precision-gate.
  const finalTopK = opts.topK ?? DEFAULT_TOP_K;
  // How many candidates we fetch from Upstash before the reranker
  // narrows them down. We over-fetch so the reranker has signal to
  // work with — never pull just `finalTopK`, otherwise rerank degenerates
  // into a no-op.
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
  const hits = await ns.query<KnowledgeVectorMetadata>({
    vector,
    topK: fetchK,
    includeMetadata: true,
    filter,
  });

  const kept = hits.filter((h) => h.score >= minScore);
  if (kept.length === 0) return [];

  const ids = kept.map((h) => String(h.id));
  const byId = await hydrateChunks(ids);

  // Hydrate all surviving candidates (still wider than finalTopK). The
  // Firestore getAll() over ~12 docs is cheap; we'd rather pay for one
  // batch read than rerank without text.
  const candidates: KnowledgeChunk[] = kept
    .map((h) => {
      const doc = byId.get(String(h.id));
      if (!doc) {
        return null;
      }
      const m = (h.metadata ?? {}) as Partial<KnowledgeVectorMetadata>;
      return {
        id: String(h.id),
        score: h.score,
        text: String(doc.text ?? ""),
        type: String(doc.type ?? m.type ?? "unknown"),
        topic: String(doc.topic ?? ""),
        seasons: Array.isArray(doc.seasons) ? (doc.seasons as string[]) : (m.seasons ?? []),
        months: Array.isArray(doc.months) ? (doc.months as string[]) : (m.months ?? []),
        regions: Array.isArray(doc.regions) ? (doc.regions as string[]) : (m.regions ?? []),
        tags: Array.isArray(doc.tags) ? (doc.tags as string[]) : [],
        sentiment: String(doc.sentiment ?? m.sentiment ?? "informational"),
        sourcePath: String(doc.sourcePath ?? m.sourcePath ?? ""),
        headingPath: Array.isArray(doc.headingPath) ? (doc.headingPath as string[]) : [],
      } satisfies KnowledgeChunk;
    })
    .filter((c): c is KnowledgeChunk => c !== null);

  // Cross-encoder rerank against the user query. Fail-soft: a Voyage
  // outage returns the vector ordering instead of the reranked one, so
  // a degraded reranker never costs us a turn — just precision.
  const { items } = await rerankDocuments(
    query,
    candidates,
    (c) => c.text,
    finalTopK,
    "knowledge-rerank"
  );
  return items;
}

export function formatKnowledgeChunksForPrompt(
  chunks: KnowledgeChunk[],
  regionDisplayName: string
): string {
  if (chunks.length === 0) return "";
  const blocks = chunks.map((c, i) => {
    const section = c.headingPath.length
      ? c.headingPath.join(" › ")
      : "(top)";
    return [
      `<chunk index="${i + 1}" source="${c.sourcePath}" section="${section}">`,
      c.text,
      `</chunk>`,
    ].join("\n");
  });
  return [
    "<knowledge_base>",
    `The following prose excerpts come from the SipLocal ${regionDisplayName}`,
    "knowledge base. Treat them as authoritative regional background.",
    "Quote or paraphrase as useful; do not invent details not present here.",
    "",
    ...blocks,
    "</knowledge_base>",
  ].join("\n");
}
