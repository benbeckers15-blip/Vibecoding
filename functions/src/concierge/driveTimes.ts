// functions/src/concierge/driveTimes.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side port of services/concierge/driveTimes.ts.
//
// CHANGES FROM THE CLIENT VERSION:
//   • Env: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY → GOOGLE_DIRECTIONS_API_KEY
//     The server uses a separate logical key for Directions / Distance
//     Matrix so we can independently restrict it in the Google Cloud
//     console (it should be locked to the Distance Matrix + Directions
//     APIs only, ideally IP-restricted to Cloud Functions egress).
//   • Diagnostics: React Native's `__DEV__` global → NODE_ENV check.
//   • Global `fetch` works in Node 22 natively, so no fetch import needed.
// All routing logic (element cap, no-coords bucketing, fail-soft fallback,
// stable sort) is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import type { WineryDoc } from "./buildContext";

const IS_DEV = process.env.NODE_ENV !== "production";

const DM_ENDPOINT = "https://maps.googleapis.com/maps/api/distancematrix/json";
const MAX_DESTINATIONS = 25;

interface DMElement {
  status: string;
  duration?: { value: number; text: string };
  distance?: { value: number; text: string };
}

interface DMResponse {
  status: string;
  rows: { elements: DMElement[] }[];
  error_message?: string;
}

export interface DriveTimeOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

export async function sortByDriveTime(
  origin: { latitude: number; longitude: number },
  candidates: WineryDoc[],
  opts: DriveTimeOptions = {}
): Promise<WineryDoc[]> {
  if (candidates.length <= 1) return candidates;

  const apiKey = opts.apiKey ?? process.env.GOOGLE_DIRECTIONS_API_KEY;
  if (!apiKey) {
    if (IS_DEV) {
      console.warn(
        "[concierge] GOOGLE_DIRECTIONS_API_KEY is not set — skipping drive-time sort."
      );
    }
    return candidates;
  }

  const withCoords: WineryDoc[] = [];
  const withoutCoords: WineryDoc[] = [];
  for (const c of candidates) {
    if (typeof c.latitude === "number" && typeof c.longitude === "number") {
      withCoords.push(c);
    } else {
      withoutCoords.push(c);
    }
  }
  if (withCoords.length === 0) return candidates;

  const askable = withCoords.slice(0, MAX_DESTINATIONS);
  const overflow = withCoords.slice(MAX_DESTINATIONS);

  const fetchFn = opts.fetchFn ?? fetch;

  try {
    const destinations = askable
      .map((w) => `${w.latitude},${w.longitude}`)
      .join("|");
    const params = new URLSearchParams({
      origins: `${origin.latitude},${origin.longitude}`,
      destinations,
      mode: "driving",
      units: "metric",
      key: apiKey,
    });

    const res = await fetchFn(`${DM_ENDPOINT}?${params.toString()}`, {
      signal: opts.signal,
    });
    if (!res.ok) {
      if (IS_DEV) {
        console.warn(
          `[concierge] Distance Matrix HTTP ${res.status} — falling back to original order.`
        );
      }
      return candidates;
    }

    const json = (await res.json()) as DMResponse;
    if (json.status !== "OK" || !json.rows?.[0]?.elements) {
      if (IS_DEV) {
        console.warn(
          `[concierge] Distance Matrix status=${json.status} (${
            json.error_message ?? "no message"
          }) — falling back.`
        );
      }
      return candidates;
    }

    const elements = json.rows[0].elements;
    if (elements.length !== askable.length) {
      if (IS_DEV) {
        console.warn(
          `[concierge] Distance Matrix returned ${elements.length} elements for ${askable.length} destinations — falling back.`
        );
      }
      return candidates;
    }

    const paired = askable.map((w, i) => ({
      w,
      seconds:
        elements[i].status === "OK" && elements[i].duration
          ? elements[i].duration!.value
          : Infinity,
    }));
    paired.sort((a, b) => a.seconds - b.seconds);

    return [...paired.map((p) => p.w), ...overflow, ...withoutCoords];
  } catch (err) {
    if (IS_DEV) {
      console.warn(
        "[concierge] Distance Matrix call failed — falling back to original order:",
        err
      );
    }
    return candidates;
  }
}
