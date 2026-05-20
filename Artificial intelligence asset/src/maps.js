/**
 * maps.js — Google Maps API wrapper for the concierge's spatial reasoning.
 *
 * Why this exists:
 *   The model was guessing distances, drive times, and compass directions
 *   between wineries from its parametric memory and getting them wrong. This
 *   module is the single source of truth for anything spatial — it resolves
 *   winery slugs to lat/lng using the cached dataset, calls Google for drive
 *   times, and computes compass bearings locally from coordinates.
 *
 * Three public functions:
 *   driveTime(origin, destination)            → one-to-one drive time + distance
 *   driveMatrix(origins, destinations)        → many-to-many drive times
 *   compassBearing(origin, destination)       → cardinal direction (no API call)
 *
 * Each location may be:
 *   - a winery slug from the dataset (e.g. "house-of-arras")
 *   - a free-form place name ("Hobart", "Launceston CBD") — geocoded once,
 *     cached for the life of the process
 *   - { lat, lng } literal coordinates
 *
 * The Maps API key is read from GOOGLE_MAPS_API_KEY at the time of the first
 * call. Geocode results are cached in-memory keyed by the normalised query.
 *
 * Requires Node 18+ for global fetch().
 */

const GMAPS = 'https://maps.googleapis.com/maps/api';

// Geocoding cache — keyed by lowercased trimmed query string.
const _geocodeCache = new Map();

// Reference to the wineries dataset. Set by `attachWineries()` so slug lookups
// don't need a Firestore round-trip per tool call.
let _wineriesBySlug = null;
let _wineriesById = null;

/**
 * Register the wineries dataset so this module can resolve slugs locally.
 * Called once from concierge.init().
 */
function attachWineries(wineries) {
  _wineriesBySlug = new Map();
  _wineriesById = new Map();
  for (const w of wineries) {
    if (w.slug) _wineriesBySlug.set(String(w.slug).toLowerCase(), w);
    if (w.id) _wineriesById.set(String(w.id).toLowerCase(), w);
  }
}

function _apiKey() {
  const k = process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!k) {
    throw new Error(
      'GOOGLE_MAPS_API_KEY is not set. Add it to the Artificial intelligence asset/.env, ' +
      'or to the project-root /.env where the app already keeps it.'
    );
  }
  return k;
}

// ---------------------------------------------------------------------------
// Resolution: slug | place name | {lat,lng} → {lat, lng, label}
// ---------------------------------------------------------------------------

function _isCoords(v) {
  return v && typeof v === 'object' && typeof v.lat === 'number' && typeof v.lng === 'number';
}

/**
 * Resolve a location reference to { lat, lng, label }. Throws on failure.
 *
 * If `value` is a string, we first check the wineries index by slug and id.
 * If no match, we geocode the string with Tasmania/Australia bias.
 */
async function resolveLocation(value) {
  if (_isCoords(value)) {
    return { lat: value.lat, lng: value.lng, label: value.label || `${value.lat},${value.lng}` };
  }
  if (typeof value !== 'string') {
    throw new Error(`Cannot resolve location: ${JSON.stringify(value)}`);
  }
  const key = value.trim().toLowerCase();
  if (!key) throw new Error('Empty location reference.');

  // 1) Winery lookup by slug or id.
  if (_wineriesBySlug) {
    const w = _wineriesBySlug.get(key) || (_wineriesById && _wineriesById.get(key));
    if (w && typeof w.latitude === 'number' && typeof w.longitude === 'number') {
      return { lat: w.latitude, lng: w.longitude, label: w.name || key };
    }
  }

  // 2) Geocode cache hit.
  if (_geocodeCache.has(key)) return _geocodeCache.get(key);

  // 3) Geocode via Google, biased to Tasmania.
  const params = new URLSearchParams({
    address: value,
    region: 'au',
    components: 'country:AU|administrative_area:TAS',
    key: _apiKey(),
  });
  const url = `${GMAPS}/geocode/json?${params}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) {
    throw new Error(`Geocode failed for "${value}": ${data.status}${data.error_message ? ` — ${data.error_message}` : ''}`);
  }
  const top = data.results[0];
  const out = {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    label: top.formatted_address,
  };
  _geocodeCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Distance Matrix — drive time + distance, one-to-one or many-to-many
// ---------------------------------------------------------------------------

function _coordParam(loc) {
  return `${loc.lat},${loc.lng}`;
}

async function _callDistanceMatrix(origins, destinations, mode = 'driving') {
  const params = new URLSearchParams({
    origins: origins.map(_coordParam).join('|'),
    destinations: destinations.map(_coordParam).join('|'),
    mode,
    units: 'metric',
    key: _apiKey(),
  });
  const url = `${GMAPS}/distancematrix/json?${params}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') {
    throw new Error(`Distance Matrix failed: ${data.status}${data.error_message ? ` — ${data.error_message}` : ''}`);
  }
  return data;
}

/**
 * One-to-one drive time and distance.
 *
 *   const r = await driveTime('house-of-arras', 'Hobart');
 *   // → { fromLabel, toLabel, distanceText: '198 km', distanceMeters: 197812,
 *   //     durationText: '2 hours 32 mins', durationSeconds: 9132, mode: 'driving' }
 */
async function driveTime(origin, destination, mode = 'driving') {
  const [o, d] = await Promise.all([resolveLocation(origin), resolveLocation(destination)]);
  const data = await _callDistanceMatrix([o], [d], mode);
  const element = data.rows?.[0]?.elements?.[0];
  if (!element || element.status !== 'OK') {
    throw new Error(`No route from "${o.label}" to "${d.label}": ${element?.status || 'unknown'}`);
  }
  return {
    fromLabel: o.label,
    toLabel: d.label,
    distanceText: element.distance.text,
    distanceMeters: element.distance.value,
    durationText: element.duration.text,
    durationSeconds: element.duration.value,
    mode,
  };
}

/**
 * Many-to-many drive matrix. Useful for "which of these is closest to X" or
 * for ordering an itinerary.
 *
 *   driveMatrix(['Hobart'], ['pooley-wines', 'frogmore-creek', 'domaine-a'])
 */
async function driveMatrix(origins, destinations, mode = 'driving') {
  const resolvedO = await Promise.all(origins.map(resolveLocation));
  const resolvedD = await Promise.all(destinations.map(resolveLocation));
  const data = await _callDistanceMatrix(resolvedO, resolvedD, mode);

  const rows = data.rows.map((row, i) => ({
    from: resolvedO[i].label,
    cells: row.elements.map((el, j) => {
      if (el.status !== 'OK') {
        return { to: resolvedD[j].label, status: el.status };
      }
      return {
        to: resolvedD[j].label,
        distanceText: el.distance.text,
        distanceMeters: el.distance.value,
        durationText: el.duration.text,
        durationSeconds: el.duration.value,
      };
    }),
  }));
  return { mode, rows };
}

// ---------------------------------------------------------------------------
// Compass bearing — pure math, no API call.
// ---------------------------------------------------------------------------

const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

const COMPASS_LONG = {
  N: 'north', NNE: 'north-northeast', NE: 'northeast', ENE: 'east-northeast',
  E: 'east', ESE: 'east-southeast', SE: 'southeast', SSE: 'south-southeast',
  S: 'south', SSW: 'south-southwest', SW: 'southwest', WSW: 'west-southwest',
  W: 'west', WNW: 'west-northwest', NW: 'northwest', NNW: 'north-northwest',
};

function _deg(rad) { return (rad * 180) / Math.PI; }
function _rad(deg) { return (deg * Math.PI) / 180; }

function _initialBearingDegrees(a, b) {
  const φ1 = _rad(a.lat), φ2 = _rad(b.lat);
  const Δλ = _rad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (_deg(θ) + 360) % 360;
}

function _haversineKm(a, b) {
  const R = 6371; // km
  const dLat = _rad(b.lat - a.lat);
  const dLng = _rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(_rad(a.lat)) * Math.cos(_rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Compass direction (and straight-line distance) from origin to destination.
 *   { bearingDegrees: 23.4, compass: 'NNE', compassLong: 'north-northeast',
 *     straightLineKm: 198.2, fromLabel, toLabel }
 */
async function compassBearing(origin, destination) {
  const [o, d] = await Promise.all([resolveLocation(origin), resolveLocation(destination)]);
  const bearing = _initialBearingDegrees(o, d);
  const idx = Math.round(bearing / 22.5) % 16;
  const compass = COMPASS_16[idx];
  return {
    fromLabel: o.label,
    toLabel: d.label,
    bearingDegrees: Math.round(bearing * 10) / 10,
    compass,
    compassLong: COMPASS_LONG[compass],
    straightLineKm: Math.round(_haversineKm(o, d) * 10) / 10,
  };
}

module.exports = {
  attachWineries,
  resolveLocation,
  driveTime,
  driveMatrix,
  compassBearing,
};
