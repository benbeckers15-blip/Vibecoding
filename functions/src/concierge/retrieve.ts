// functions/src/concierge/retrieve.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side port of services/concierge/retrieve.ts.
//
// CHANGES FROM THE CLIENT VERSION:
//   • Env: EXPO_PUBLIC_VOYAGE_API_KEY → VOYAGE_API_KEY
//   • Env: EXPO_PUBLIC_UPSTASH_VECTOR_URL → UPSTASH_VECTOR_URL
//   • Env: EXPO_PUBLIC_UPSTASH_VECTOR_TOKEN → UPSTASH_VECTOR_TOKEN
//   • Error-message text updated to reference the server-side names.
// All retrieval logic (filter builder, topK + padding, score-descending
// dedupe) is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { Index } from "@upstash/vector";
import { VoyageAIClient } from "voyageai";

const EMBED_MODEL = "voyage-3-lite";
const HYDRATION_TOP_K_PADDING = 4;

// Lazy clients — first-use construction. On Cloud Functions, the module is
// loaded once per cold start and `_voyage` / `_index` survive across warm
// invocations within the same instance.

let _voyage: VoyageAIClient | null = null;
let _index: Index | null = null;

function getVoyage(): VoyageAIClient {
  if (_voyage) return _voyage;
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOYAGE_API_KEY secret is not bound to this function. " +
        "Declare it in the function's `secrets:` option and run " +
        "`firebase functions:secrets:set VOYAGE_API_KEY`."
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
      "UPSTASH_VECTOR_URL or UPSTASH_VECTOR_TOKEN secret is not bound to " +
        "this function. Declare both in the function's `secrets:` option."
    );
  }
  _index = new Index({ url, token });
  return _index;
}

export interface VectorMetadata {
  name: string;
  slug: string;
  region: string;
  rating: number | null;
  dogFriendly: boolean;
  hasRestaurant: boolean;
  isOrganic: boolean;
  isBiodynamic: boolean;
  walkinWelcome: boolean;
  featured: boolean;
  description?: string;
  text?: string;
  [key: string]: unknown;
}

export interface DescriptionHit {
  slug: string;
  score: number;
  text: string | null;
}

function buildSlugFilter(slugs: string[]): string {
  const list = slugs
    .map((s) => `'${s.replace(/'/g, "''")}'`)
    .join(", ");
  return `slug IN (${list})`;
}

export async function hydrateDescriptions(
  query: string,
  slugs: string[]
): Promise<DescriptionHit[]> {
  if (slugs.length === 0) return [];

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

  const index = getIndex();
  const filter = buildSlugFilter(slugs);
  const topK = slugs.length + HYDRATION_TOP_K_PADDING;
  const results = await index.query<VectorMetadata>({
    vector,
    topK,
    includeMetadata: true,
    filter,
  });

  const seen = new Set<string>();
  const hits: DescriptionHit[] = [];
  for (const r of results) {
    if (!r.metadata) continue;
    const m = r.metadata as VectorMetadata;
    const slug = String(m.slug || r.id);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const text =
      (typeof m.description === "string" && m.description) ||
      (typeof m.text === "string" && m.text) ||
      null;

    hits.push({ slug, score: r.score, text });
  }

  return hits;
}
