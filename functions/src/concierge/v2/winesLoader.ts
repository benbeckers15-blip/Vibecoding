// functions/src/concierge/v2/winesLoader.ts
// ─────────────────────────────────────────────────────────────────────────────
// Load the `wines` Firestore collection for a region into the shape
// `nameIndex.ts` consumes.
//
// The wines collection is seeded from scripts/rag/wines.csv by
// scripts/seed-wines-from-csv.js. Doc shape (per that script):
//   {
//     wineryId: string,           // anchor slug (matches a doc in `wineries`)
//     name: string,               // wine's display name (CSV `wineName` column)
//     vintage?: string,
//     region?: string,
//     variety?: string,
//     style?: string, color?: string, body?: string, sweetness?: string,
//     oak?: string, abv?: string, price?: string,
//     tastingNotes?: string, pairings?: string, awards?: string,
//     authorNotes?: string,
//     regionId: string,           // multi-region scope
//   }
//
// We only project the fields the name index uses (wineryId, name,
// vintage, variety). The full record is already in Upstash metadata
// for the tasting-notes retrieval pass, so no point hydrating extra
// fields here.
//
// Cached at module scope per region with TTL — mirrors how
// buildContext.ts caches the wineries collection.
// ─────────────────────────────────────────────────────────────────────────────

import { getFirestore } from "firebase-admin/firestore";
import type { WineRecord } from "./nameIndex";

// ─── Cache ────────────────────────────────────────────────────────────────

interface CachedWines {
  promise: Promise<WineRecord[]>;
  loadedAt: number;
}

const _winesByRegion = new Map<string, CachedWines>();

// Same TTL semantics as the wineries corpus cache (see orchestrator.ts).
// Override via CONCIERGE_CACHE_TTL_MS so a low value in local dev lets
// edits propagate within seconds.
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_TTL_MS =
  Number(process.env.CONCIERGE_CACHE_TTL_MS) || DEFAULT_CACHE_TTL_MS;

// ─── Loader ───────────────────────────────────────────────────────────────

/**
 * Load every wine in a region from Firestore. Cached at module scope.
 *
 * Concurrent cold-start requests share the in-flight promise so we
 * don't fan out duplicate Firestore reads. Failed loads clear their
 * cache entry so the next request retries cleanly.
 *
 * Returns an empty array (NOT throws) when:
 *   • The wines collection is empty for this region.
 *   • A wines doc is malformed (missing wineryId or name) — that doc
 *     is silently skipped, the rest are kept.
 *
 * Throws only on hard Firestore errors. The orchestrator should
 * fail-soft to an empty wines list and continue serving turns — the
 * winery-only name lookup still works.
 */
export async function loadWinesForRegion(
  regionId: string
): Promise<WineRecord[]> {
  const now = Date.now();
  const entry = _winesByRegion.get(regionId);
  if (entry && now - entry.loadedAt < CACHE_TTL_MS) {
    return entry.promise;
  }

  const promise = (async () => {
    const db = getFirestore();
    const snap = await db
      .collection("wines")
      .where("regionId", "==", regionId)
      .get();

    const records: WineRecord[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const wineryId = typeof data.wineryId === "string" ? data.wineryId : "";
      // Tolerate either `name` (current schema) or `wineName` (legacy
      // direct-from-CSV imports if any survive). Either populates the
      // index; the name index only cares about the human-readable form.
      const name =
        typeof data.name === "string" && data.name
          ? data.name
          : typeof data.wineName === "string"
          ? (data.wineName as string)
          : "";

      if (!wineryId || !name) {
        // Malformed row — skip silently. Not worth failing the load.
        continue;
      }

      const record: WineRecord = {
        wineId: doc.id,
        wineryId,
        name,
      };
      if (typeof data.vintage === "string" && data.vintage) {
        record.vintage = data.vintage;
      }
      if (typeof data.variety === "string" && data.variety) {
        record.variety = data.variety;
      } else if (typeof data.varietal === "string" && data.varietal) {
        // Legacy field name — see tastingNotes.ts comment.
        record.variety = data.varietal as string;
      }
      records.push(record);
    }

    return records;
  })();

  _winesByRegion.set(regionId, { promise, loadedAt: now });

  promise.catch(() => {
    const current = _winesByRegion.get(regionId);
    if (current?.promise === promise) {
      _winesByRegion.delete(regionId);
    }
  });

  return promise;
}
