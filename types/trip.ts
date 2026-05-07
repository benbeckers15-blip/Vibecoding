// types/trip.ts
// ─────────────────────────────────────────────────────────────────────────────
// Type definitions for the trip-planning feature.
//
// Two flavours of trip exist in the app:
//   1. PremadeTrip — curated trips, sourced from the Firestore `premade_trips`
//      collection. Read-only from the user's perspective.
//   2. Trip        — user-created trips, persisted locally via AsyncStorage.
//      Lifecycle: not_started → active → completed.
//
// Both reference winery documents by their Firestore `id` (string) — the same
// id used by `useSaved()` and the `/wineries/[slug]` route.
// ─────────────────────────────────────────────────────────────────────────────

/** Lifecycle status for a user-created trip. */
export type TripStatus = "not_started" | "active" | "completed";

/**
 * A single waypoint in a trip. Keeps the winery `id` plus a denormalised
 * snapshot of the fields we need offline (name, coords) so that an active
 * trip keeps working even if Firestore is unavailable mid-trip.
 */
export interface TripStop {
  /** Firestore document id of the winery. */
  wineryId: string;
  /** Denormalised name — used for display when offline. */
  name: string;
  /** Denormalised slug — used to deep-link into the winery detail screen. */
  slug: string;
  /** Latitude (decimal degrees). */
  latitude: number;
  /** Longitude (decimal degrees). */
  longitude: number;
}

/**
 * A user-created trip stored locally in AsyncStorage.
 *
 * `stops` is the *optimised* order — populated once on Start Trip via the
 * Google Directions API. Until then it's the raw order the user added stops.
 *
 * `visitedStopIds` tracks which winery ids have been marked visited.
 * `currentStopIndex` is the index into `stops` of the user's current target.
 */
export interface Trip {
  id: string;
  name: string;
  stops: TripStop[];
  status: TripStatus;
  /** Index into `stops` of the next un-visited stop. */
  currentStopIndex: number;
  /** Set of `wineryId`s the user has marked visited. */
  visitedStopIds: string[];
  /** Whether `stops` has been re-ordered by the routing engine. */
  routeOptimised: boolean;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp when the trip was started (status → active). */
  startedAt?: string;
  /** ISO timestamp when the trip was completed. */
  completedAt?: string;
}

/**
 * A curated trip in the Firestore `premade_trips` collection. The shape is
 * deliberately minimal — when the user taps "Start" on a premade trip we
 * clone it into a fresh `Trip` (assigning a new id, status not_started, etc.)
 * so the user can start it without affecting the canonical curated entry.
 */
export interface PremadeTrip {
  /** Firestore document id. */
  id: string;
  title: string;
  blurb: string;
  /** Hero image URL. */
  heroImage: string;
  /** Approximate duration in hours, used for the "~5 hr" label. */
  durationHours: number;
  /** Ordered list of winery document ids. */
  wineryIds: string[];
  /** Region label, e.g. "Margaret River" — for future multi-region support. */
  region: string;
  /** Display order on the Trips index. */
  order: number;
}
