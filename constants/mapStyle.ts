// constants/mapStyle.ts
// ─────────────────────────────────────────────────────────────────────────────
// Custom Google Maps style that matches the app's "Forest Slate" dark palette.
//
// Palette reference (from theme.ts):
//   #0F1411 — paper           (page background — deep slate / green undertone)
//   #1A201B — paperTint       (chips / cards / map land surface)
//   #222823 — paperLight      (lifted surfaces)
//   #070A08 — paperDeep       (deepest inset surface)
//   #548323 — forest          (primary accent — eucalypt green)
//   #9dd560 — caramel/lime    (secondary accent — bright lime)
//   #E8EAE6 — ink             (soft off-white text)
//
// Design intent: a moody, modern dark map that feels like the rest of the
// app. Slate-green land, deeper paperDeep water, subtle hairlines for roads,
// and forest-toned park polygons. POI clutter is hidden — wineries carry
// their own custom markers.
// ─────────────────────────────────────────────────────────────────────────────

import type { MapStyleElement } from "react-native-maps";

export const MAP_STYLE: MapStyleElement[] = [
  // ── Base ──────────────────────────────────────────────────────────────────
  // Default fill for any geometry not overridden below — anchors to the
  // primary land tone so the map reads as a single dark surface.
  {
    elementType: "geometry",
    stylers: [{ color: "#1A201B" }],
  },
  // Soft off-white labels (matches `colors.textPrimary` / palette.ink).
  {
    elementType: "labels.text.fill",
    stylers: [{ color: "#B7BDB2" }],
  },
  // Dark stroke around labels so they read cleanly over varied terrain.
  {
    elementType: "labels.text.stroke",
    stylers: [{ color: "#0F1411" }],
  },
  // Hide the default place-icon glyphs — keeps the surface clean.
  {
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },

  // ── Administrative ────────────────────────────────────────────────────────
  // Region / locality outlines as low-contrast hairlines.
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#2A312B" }],
  },
  {
    featureType: "administrative.country",
    elementType: "geometry.stroke",
    stylers: [{ color: "#3A4239" }],
  },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9dd560" }], // caramel/lime — match accentSoft
  },
  {
    featureType: "administrative.neighborhood",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8A9384" }],
  },

  // ── Landscape ─────────────────────────────────────────────────────────────
  {
    featureType: "landscape.natural",
    elementType: "geometry",
    stylers: [{ color: "#161B17" }],
  },
  {
    featureType: "landscape.natural.terrain",
    elementType: "geometry",
    stylers: [{ color: "#171D18" }],
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry",
    stylers: [{ color: "#1F2620" }],
  },

  // ── Points of interest ────────────────────────────────────────────────────
  // Hide most POI clutter — the wineries have their own custom markers and
  // we don't want random restaurants / shops competing visually.
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#1C231D" }],
  },
  {
    featureType: "poi",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  // Parks lean into the forest-green accent for atmosphere.
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#23311E" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#7A9E5A" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#0F1411" }],
  },

  // ── Roads ─────────────────────────────────────────────────────────────────
  // Subtle two-tone road system: a slightly lighter fill with a quiet stroke,
  // so roads read as guides without overpowering the dark surface.
  {
    featureType: "road",
    elementType: "geometry.fill",
    stylers: [{ color: "#2A312B" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1A201B" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9DA39B" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#0F1411" }],
  },
  // Local / minor roads — slightly dimmer than arterials.
  {
    featureType: "road.local",
    elementType: "geometry.fill",
    stylers: [{ color: "#252B26" }],
  },
  // Arterials — a touch brighter so they stand out from local streets.
  {
    featureType: "road.arterial",
    elementType: "geometry.fill",
    stylers: [{ color: "#323A33" }],
  },
  // Highways — most prominent road tier, but kept in NEUTRAL slate tones so
  // the route polyline (forest/lime) reads as the only green element on the
  // map. Reusing the accent on highways made the planned route invisible.
  {
    featureType: "road.highway",
    elementType: "geometry.fill",
    stylers: [{ color: "#3A4039" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#2A2F2A" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#B7BDB2" }],
  },
  {
    featureType: "road.highway.controlled_access",
    elementType: "geometry.fill",
    stylers: [{ color: "#444A43" }],
  },

  // ── Transit ───────────────────────────────────────────────────────────────
  // Hidden — the app is about driving the wine trail, not public transit.
  {
    featureType: "transit",
    stylers: [{ visibility: "off" }],
  },

  // ── Water ─────────────────────────────────────────────────────────────────
  // Deep, near-black slate — water sits "below" the land tonally so the
  // coastline reads clearly without introducing a competing blue/teal hue.
  {
    featureType: "water",
    elementType: "geometry.fill",
    stylers: [{ color: "#070A08" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#5A6258" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#070A08" }],
  },
];
