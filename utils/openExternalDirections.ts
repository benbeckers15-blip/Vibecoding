// utils/openExternalDirections.ts
// ─────────────────────────────────────────────────────────────────────────────
// Hand off turn-by-turn navigation to the device's native maps app.
//
// Why hand off?
//   Building real turn-by-turn navigation (live re-routing, voice prompts,
//   lane guidance, traffic) is a multi-month effort that would essentially
//   recreate Google Maps inside SipLocal. Apps like Yelp and TripAdvisor
//   instead delegate to Apple Maps / Google Maps because (a) those apps
//   already have the user's trust for driving, and (b) it side-steps the
//   massive engineering and licensing cost.
//
// Behaviour:
//   • iOS  → Apple Maps via the `http://maps.apple.com/?…` URL scheme.
//            Apple Maps doesn't support multi-stop URL deep links, so we
//            open one leg at a time (origin → next stop).
//   • Android → Google Maps via the `https://www.google.com/maps/dir/…`
//            URL scheme, which DOES support multi-stop with up to ~9
//            waypoints. We pass the whole remaining itinerary in one go.
//
// Both schemes fall through to the user's browser if the maps app isn't
// installed, which still works fine for getting directions.
// ─────────────────────────────────────────────────────────────────────────────

import { Linking, Platform } from "react-native";
import { TripStop } from "../types/trip";

interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Open external directions from `origin` to `destination`, with optional
 * intermediate `waypoints` (skipped on iOS — Apple Maps URL scheme doesn't
 * support multi-stop).
 */
export async function openExternalDirections(opts: {
  origin: LatLng | "current";
  destination: TripStop;
  waypoints?: TripStop[];
}): Promise<void> {
  const { origin, destination, waypoints = [] } = opts;

  if (Platform.OS === "ios") {
    await openAppleMapsLeg(origin, destination);
    return;
  }

  await openGoogleMapsRoute(origin, destination, waypoints);
}

// ─── Apple Maps (single leg) ──────────────────────────────────────────────────

async function openAppleMapsLeg(
  origin: LatLng | "current",
  destination: TripStop
): Promise<void> {
  const saddr =
    origin === "current"
      ? "Current+Location"
      : `${origin.latitude},${origin.longitude}`;
  const daddr = `${destination.latitude},${destination.longitude}`;
  const url = `http://maps.apple.com/?saddr=${encodeURIComponent(
    saddr
  )}&daddr=${encodeURIComponent(daddr)}&dirflg=d`;

  await Linking.openURL(url).catch((err) =>
    console.warn("[openExternalDirections] Apple Maps failed:", err)
  );
}

// ─── Google Maps (multi-stop) ─────────────────────────────────────────────────

async function openGoogleMapsRoute(
  origin: LatLng | "current",
  destination: TripStop,
  waypoints: TripStop[]
): Promise<void> {
  // Google Maps "dir" API:
  //   /maps/dir/?api=1&origin=…&destination=…&waypoints=…&travelmode=driving
  // Multiple waypoints are pipe-separated.
  const originStr =
    origin === "current"
      ? ""
      : `${origin.latitude},${origin.longitude}`;
  const destinationStr = `${destination.latitude},${destination.longitude}`;
  const waypointStr = waypoints
    .map((w) => `${w.latitude},${w.longitude}`)
    .join("|");

  const params = new URLSearchParams({
    api: "1",
    destination: destinationStr,
    travelmode: "driving",
  });
  if (originStr) params.set("origin", originStr);
  if (waypointStr) params.set("waypoints", waypointStr);

  const url = `https://www.google.com/maps/dir/?${params.toString()}`;
  await Linking.openURL(url).catch((err) =>
    console.warn("[openExternalDirections] Google Maps failed:", err)
  );
}
