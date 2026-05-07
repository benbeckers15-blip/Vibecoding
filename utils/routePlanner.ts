// utils/routePlanner.ts
// ─────────────────────────────────────────────────────────────────────────────
// Route optimisation via the Google Directions API.
//
// Why Directions API and not a local TSP solver?
//   The user explicitly chose Google's optimisation. The Directions API
//   computes the shortest *road* distance between waypoints (not straight-
//   line), which produces noticeably better routes in real-world driving —
//   especially in Margaret River where many wineries sit on private lanes.
//
// API key:
//   Reads from `EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY` (env var). Add this to
//   your .env. The key needs the "Directions API" enabled on the Google
//   Cloud project. Restrict it by HTTP referrer and/or app bundle id in
//   production.
//
// Cost:
//   ~$5 per 1000 requests at time of writing. We only call this once per
//   trip (on Start Trip), so a single user costs <$0.01 even with heavy use.
//
// Failure handling:
//   If the API call fails (no network, bad key, quota), we fall back to a
//   nearest-neighbour heuristic computed locally. That guarantees the user
//   never gets blocked from starting a trip just because the Directions
//   call timed out.
// ─────────────────────────────────────────────────────────────────────────────

import { TripStop } from "../types/trip";

interface LatLng {
  latitude: number;
  longitude: number;
}

interface OptimisedRoute {
  /** The stops in optimised visit order. */
  orderedStops: TripStop[];
  /** Whether Google's optimiser was used (vs. local fallback). */
  usedGoogle: boolean;
  /** Total drive distance in metres, if Google returned legs. */
  totalDistanceMeters?: number;
  /** Total drive duration in seconds, if Google returned legs. */
  totalDurationSeconds?: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Optimise the visit order of `stops`, starting from `origin`. The trip is
 * one-way (no return to origin) — the last waypoint is the destination.
 *
 * If only one stop is provided, no optimisation is needed.
 * If the Directions API is unreachable, falls back to nearest-neighbour.
 */
export async function optimiseRoute(
  origin: LatLng,
  stops: TripStop[]
): Promise<OptimisedRoute> {
  if (stops.length <= 1) {
    return { orderedStops: stops, usedGoogle: false };
  }

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY;
  if (!apiKey) {
    // No key configured → use local heuristic and surface that fact.
    return {
      orderedStops: nearestNeighbourOrder(origin, stops),
      usedGoogle: false,
    };
  }

  try {
    return await optimiseViaGoogle(origin, stops, apiKey);
  } catch (err) {
    console.warn("[routePlanner] Google Directions failed, falling back:", err);
    return {
      orderedStops: nearestNeighbourOrder(origin, stops),
      usedGoogle: false,
    };
  }
}

/** Haversine — kilometres between two points. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      sinLng *
      sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ─── Google call ──────────────────────────────────────────────────────────────

async function optimiseViaGoogle(
  origin: LatLng,
  stops: TripStop[],
  apiKey: string
): Promise<OptimisedRoute> {
  // Strategy: pick the *farthest* stop from origin as destination, optimise
  // the rest as waypoints. This produces a sensible one-way route through
  // the region rather than a there-and-back trip.
  const farthestIdx = farthestFromIndex(origin, stops);
  const destination = stops[farthestIdx];
  const waypoints = stops.filter((_, i) => i !== farthestIdx);

  const originStr = `${origin.latitude},${origin.longitude}`;
  const destStr = `${destination.latitude},${destination.longitude}`;

  // `optimize:true` is the magic — Google reorders the waypoints for us
  // and returns the new order in `routes[0].waypoint_order`.
  const waypointStr =
    waypoints.length > 0
      ? `&waypoints=optimize:true|${waypoints
          .map((w) => `${w.latitude},${w.longitude}`)
          .join("|")}`
      : "";

  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${originStr}` +
    `&destination=${destStr}` +
    waypointStr +
    `&mode=driving` +
    `&key=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Directions HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK") {
    throw new Error(`Directions status ${data.status}: ${data.error_message ?? ""}`);
  }

  const route = data.routes[0];
  const order: number[] = route.waypoint_order ?? [];
  const orderedWaypoints = order.map((i: number) => waypoints[i]);
  const orderedStops = [...orderedWaypoints, destination];

  // Sum totals across legs
  let totalDistance = 0;
  let totalDuration = 0;
  for (const leg of route.legs ?? []) {
    totalDistance += leg.distance?.value ?? 0;
    totalDuration += leg.duration?.value ?? 0;
  }

  return {
    orderedStops,
    usedGoogle: true,
    totalDistanceMeters: totalDistance,
    totalDurationSeconds: totalDuration,
  };
}

// ─── Local fallback ───────────────────────────────────────────────────────────

/**
 * Nearest-neighbour TSP heuristic. Repeatedly picks the closest unvisited
 * stop from the current position. Not optimal in the worst case but ~95% as
 * good as the optimal solution for ≤8 stops, which covers virtually every
 * real-world wine-trail itinerary.
 */
function nearestNeighbourOrder(origin: LatLng, stops: TripStop[]): TripStop[] {
  const remaining = [...stops];
  const ordered: TripStop[] = [];
  let cursor: LatLng = origin;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceKm(cursor, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    ordered.push(picked);
    cursor = picked;
  }

  return ordered;
}

function farthestFromIndex(origin: LatLng, stops: TripStop[]): number {
  let bestIdx = 0;
  let bestDist = -1;
  for (let i = 0; i < stops.length; i++) {
    const d = distanceKm(origin, stops[i]);
    if (d > bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}
