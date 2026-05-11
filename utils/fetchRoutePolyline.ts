// utils/fetchRoutePolyline.ts
// ─────────────────────────────────────────────────────────────────────────────
// Fetches a real driving-route polyline from the Google Directions API and
// decodes it into an array of {latitude, longitude} points ready for use
// with react-native-maps <Polyline>.
//
// Used by the trip-detail map preview to show the actual road path instead
// of straight lines between stops.
//
// Key: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (must have Directions API enabled)
// Fallback: returns null on any failure; caller should fall back to straight
//           lines so the map is never left empty.
// ─────────────────────────────────────────────────────────────────────────────

import { TripStop } from "../types/trip";

export interface LatLng {
  latitude: number;
  longitude: number;
}

// ─── Polyline constants ───────────────────────────────────────────────────────
// The Google Maps iOS SDK crashes silently on real devices (not simulator) when
// a <Polyline> receives more than ~150-200 native coordinate objects. This cap
// ensures we never hand the native side more than this regardless of how long
// the route is (e.g. the Derwent Valley trip can span 150+ km of driving and
// its overview_polyline decodes to 400-600+ points — safe on simulator, fatal
// on device). We subsample evenly so the route shape is preserved.
const MAX_POLYLINE_POINTS = 150;

// ─── Polyline decoder ─────────────────────────────────────────────────────────
// Google encodes polyline points as a compressed ASCII string.
// Spec: https://developers.google.com/maps/documentation/utilities/polylinealgorithm

function decodePolyline(encoded: string): LatLng[] {
  const result: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    // Decode latitude delta
    let b: number;
    let shift = 0;
    let val = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      val |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += val & 1 ? ~(val >> 1) : val >> 1;

    // Decode longitude delta
    shift = 0;
    val = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      val |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += val & 1 ? ~(val >> 1) : val >> 1;

    result.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return result;
}

// ─── Polyline simplifier ──────────────────────────────────────────────────────
// Evenly subsamples `coords` down to at most `maxPoints` entries, always
// keeping the first and last points so the route endpoints are exact.
// This is intentionally cheap (O(n)) — the result is good enough for a map
// preview where the shape just needs to look right, not be pixel-perfect.

function simplifyPolyline(coords: LatLng[], maxPoints: number): LatLng[] {
  if (coords.length <= maxPoints) return coords;
  const result: LatLng[] = [];
  const step = (coords.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    result.push(coords[Math.round(i * step)]);
  }
  // Guarantee the last point is exact (rounding can overshoot by one index)
  result[maxPoints - 1] = coords[coords.length - 1];
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch a driving route for the given ordered stops from the Google Directions
 * API. Returns decoded polyline coordinates, or null if the request fails
 * (no key, network error, API error — all treated as graceful fallback).
 *
 * Stops are used in the order provided — no reordering happens here.
 * Pass at least 2 stops.
 */
export async function fetchRoutePolyline(
  stops: TripStop[]
): Promise<LatLng[] | null> {
  if (stops.length < 2) return null;

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn(
      "[fetchRoutePolyline] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set"
    );
    return null;
  }

  const origin = `${stops[0].latitude},${stops[0].longitude}`;
  const destination = `${stops[stops.length - 1].latitude},${
    stops[stops.length - 1].longitude
  }`;

  // Middle stops become intermediate waypoints (in given order, no optimise)
  const middle = stops.slice(1, -1);
  const waypointStr =
    middle.length > 0
      ? `&waypoints=${middle
          .map((s) => `${s.latitude},${s.longitude}`)
          .join("|")}`
      : "";

  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${origin}` +
    `&destination=${destination}` +
    waypointStr +
    `&mode=driving` +
    `&key=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("[fetchRoutePolyline] HTTP error:", res.status);
      return null;
    }

    const data = await res.json();

    if (data.status !== "OK") {
      console.warn(
        "[fetchRoutePolyline] API status:",
        data.status,
        data.error_message ?? ""
      );
      return null;
    }

    const encoded: string | undefined =
      data.routes?.[0]?.overview_polyline?.points;
    if (!encoded) {
      console.warn("[fetchRoutePolyline] No overview_polyline in response");
      return null;
    }

    return simplifyPolyline(decodePolyline(encoded), MAX_POLYLINE_POINTS);
  } catch (err) {
    console.warn("[fetchRoutePolyline] fetch failed:", err);
    return null;
  }
}
