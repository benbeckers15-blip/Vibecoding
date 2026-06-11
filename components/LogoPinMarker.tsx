// components/LogoPinMarker.tsx
// Branded SipLocal map pin shared by the trip-detail preview map and the
// active-trip map. Wraps react-native-maps' Marker around the lime
// logo-pin image and manages `tracksViewChanges` so the pin reliably
// appears:
//
//   • A Marker with `tracksViewChanges={false}` snapshots its children
//     immediately. If the pin image hasn't decoded yet, that snapshot is
//     an empty view and the pin is invisible — the intermittent
//     missing-pins bug on the trip detail map.
//   • Leaving tracking on permanently re-renders the marker every frame
//     on Android (map stutter).
//
// So: keep tracking ON until the image reports loaded, then freeze. If
// the pin's appearance changes later (visited / current), unfreeze for a
// beat so the new look is captured, then freeze again.

import { Image } from "expo-image";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { Marker } from "react-native-maps";

type LogoPinMarkerProps = {
  coordinate: { latitude: number; longitude: number };
  title?: string;
  /** Enlarged pin for the active trip's next stop. */
  current?: boolean;
  /** Faded pin for stops already visited. */
  visited?: boolean;
};

// Small delay between "image loaded / appearance changed" and freezing
// the marker snapshot — gives the native view a frame to actually paint.
const FREEZE_DELAY_MS = 150;

export function LogoPinMarker({
  coordinate,
  title,
  current = false,
  visited = false,
}: LogoPinMarkerProps) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const freezeSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setTracksViewChanges(false),
      FREEZE_DELAY_MS
    );
  }, []);

  // Re-capture the snapshot whenever the pin's appearance changes.
  useEffect(() => {
    if (!loaded.current) return;
    setTracksViewChanges(true);
    freezeSoon();
  }, [current, visited, freezeSoon]);

  // Clear any pending freeze on unmount.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <Marker
      coordinate={coordinate}
      title={title}
      // The logo-pin's tip is at bottom-center. The anchor is relative to
      // the view's dimensions, so the tip stays on the coordinate even
      // when the box grows for the `current` state.
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracksViewChanges}
    >
      <Image
        source={require("../assets/images/logo-pin.png")}
        style={[
          styles.pin,
          current && styles.pinCurrent,
          visited && styles.pinVisited,
        ]}
        contentFit="contain"
        onLoad={() => {
          loaded.current = true;
          freezeSoon();
        }}
      />
    </Marker>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Asset is 36×48 native px so the displayed size matches 1:1 — no
  // scaling, no aspect letterbox.
  pin: { width: 36, height: 48 },
  // Bigger pin for the active stop.
  pinCurrent: { width: 46, height: 61 },
  // Faded pin for stops already visited.
  pinVisited: { opacity: 0.4 },
});
