// services/concierge/types.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared client-side types for the concierge.
//
// These previously lived in router.ts (alongside the routing implementation),
// but routing now happens server-side and we only need the type shape on the
// client to type the `routerDecision` field returned in AskResult. Keeping
// them in their own file lets us delete router.ts cleanly.
//
// MUST stay in sync with functions/src/concierge/router.ts — the server is
// the authoritative source. Update both if the shape changes.
// ─────────────────────────────────────────────────────────────────────────────

export type RouteIntent =
  | "specific_winery"
  | "regional"
  | "feature"
  | "itinerary"
  | "general"
  | "out_of_scope";

export interface RouteRetrievalFlags {
  descriptions: boolean;
  tastingNotes: boolean;
}

export interface RouteDecision {
  intent: RouteIntent;
  regions: string[];
  tags: string[];
  nameKeywords: string[];
  dayOfWeek: string | null;
  retrieval: RouteRetrievalFlags;
  wineKeywords: string[];
  limit: number;
}
