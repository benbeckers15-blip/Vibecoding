// app/trip-active.tsx
// Active-trip experience — full-screen modal route, lives outside (tabs).
//
// Responsibilities:
//   • Show an animated progress bar (visited / total)
//   • Show the optimised stop list with the next stop highlighted
//   • "Get Directions" button — hands off to Apple Maps / Google Maps
//   • Per-stop "Mark Visited" buttons (manual, per the user's choice)
//   • Live distance to next stop, refreshed via expo-location while mounted
//   • Auto-completion when the last stop is marked visited
//
// The screen subscribes to foreground location only while mounted, so battery
// impact is bounded to the duration of the active trip.

import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAP_STYLE } from "../constants/mapStyle";
import { colors, fonts, radius, spacing, type, weights } from "../constants/theme";
import { useTrips } from "../context/TripContext";
import { distanceKm } from "../utils/routePlanner";
import { fetchRoutePolyline, type LatLng } from "../utils/fetchRoutePolyline";
import { openExternalDirections } from "../utils/openExternalDirections";

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TripActiveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tripId?: string }>();
  const tripId = String(params.tripId ?? "");

  const { getTrip, markStopVisited, completeTrip } = useTrips();
  const trip = getTrip(tripId);

  // ── Location state ────────────────────────────────────────────────────────
  const [userLoc, setUserLoc] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return;
      // Initial fix
      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setUserLoc({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        }
      } catch {
        /* ignore — watch will pick up next fix */
      }
      // Subscribe to updates — throttle to ~10s / 50m to save battery
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 10000,
          distanceInterval: 50,
        },
        (pos) => {
          if (cancelled) return;
          setUserLoc({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        }
      );
    })();
    return () => {
      cancelled = true;
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, []);

  // ── Driving route polyline ────────────────────────────────────────────────
  // Fetched once from Google Directions when the trip's stop list is known.
  // Falls back to straight (dashed) lines if the API request fails so the
  // map is never left empty.
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);

  useEffect(() => {
    if (!trip || trip.stops.length < 2) {
      setRouteCoords([]);
      return;
    }
    // Strip non-finite coords before handing to Directions — otherwise we'd
    // build a request like `origin=NaN,NaN&waypoints=…` and waste the round
    // trip (Google returns INVALID_REQUEST).
    const safeStops = trip.stops.filter(
      (s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
    );
    if (safeStops.length < 2) {
      setRouteCoords([]);
      return;
    }
    let cancelled = false;
    setRouteLoading(true);
    fetchRoutePolyline(safeStops).then((coords) => {
      if (!cancelled) {
        setRouteCoords(coords ?? []);
        setRouteLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch only if the actual stop set / order changes — not on
    // visited-flag changes (the planned route stays the same as you progress).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    trip?.stops.map((s) => s.wineryId).join("|"),
  ]);

  // ── Polyline coords — compute once per render. We avoid wrapping Polyline
  // children in an IIFE / Fragment inside <MapView>: react-native-maps
  // traverses the children to register native overlays, and Fragment wrappers
  // can prevent the polyline from being picked up at all (which manifested
  // as a blank route preview).
  //
  // Defensive filter: a single non-finite coord handed to the native side is
  // enough to crash react-native-maps with PROVIDER_GOOGLE on iOS. Trip stops
  // can carry NaN coords if they were persisted to AsyncStorage before the
  // upstream filters were tightened to Number.isFinite — strip them here so
  // a stale on-disk trip doesn't take the screen down.
  const routeDisplayCoords: LatLng[] = useMemo(() => {
    if (!trip) return [];
    const source =
      routeCoords.length > 1
        ? routeCoords
        : trip.stops.map((s) => ({
            latitude: s.latitude,
            longitude: s.longitude,
          }));
    return source.filter(
      (c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
    );
  }, [routeCoords, trip?.stops]);
  const usingRealRoute = routeCoords.length > 1;

  // ── Map region — center on stops with sensible padding ───────────────────
  // Compute over only stops with finite coords. Without this filter, a single
  // NaN coord turns Math.min/max into NaN and produces an initialRegion of
  // {NaN, NaN, NaN, NaN}, which silently hard-crashes Google Maps on iOS.
  const initialRegion = useMemo(() => {
    const safeStops = trip
      ? trip.stops.filter(
          (s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
        )
      : [];
    if (safeStops.length === 0) {
      // Tasmania-wide fallback (matches the wineries map default).
      return {
        latitude: -42.2,
        longitude: 146.8,
        latitudeDelta: 5.0,
        longitudeDelta: 4.5,
      };
    }
    const lats = safeStops.map((s) => s.latitude);
    const lngs = safeStops.map((s) => s.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.7),
      longitudeDelta: Math.max(0.05, (maxLng - minLng) * 1.7),
    };
  }, [trip?.stops]);

  // ── Progress bar animation ────────────────────────────────────────────────
  const progress = useSharedValue(0);
  useEffect(() => {
    if (!trip) return;
    const pct = trip.stops.length
      ? trip.visitedStopIds.length / trip.stops.length
      : 0;
    progress.value = withSpring(pct, { damping: 18, stiffness: 200 });
  }, [trip?.visitedStopIds.length, trip?.stops.length]);

  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  // ── Detect completion → confirm dialog ────────────────────────────────────
  const completedShown = useRef(false);
  useEffect(() => {
    if (!trip) return;
    if (trip.status === "completed" && !completedShown.current) {
      completedShown.current = true;
      Alert.alert(
        "Trip complete",
        "You’ve visited every cellar door on this trip. Cheers!",
        [{ text: "Done", onPress: () => router.back() }]
      );
    }
  }, [trip?.status]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const nextStop = useMemo(() => {
    if (!trip) return null;
    return trip.stops[trip.currentStopIndex] ?? null;
  }, [trip]);

  const distanceToNextKm = useMemo(() => {
    if (!userLoc || !nextStop) return null;
    // Skip the haversine if the stop has bad coords — the result would just
    // be NaN and render as "NaN km away".
    if (
      !Number.isFinite(nextStop.latitude) ||
      !Number.isFinite(nextStop.longitude)
    ) {
      return null;
    }
    return distanceKm(userLoc, nextStop);
  }, [userLoc, nextStop]);

  const remainingStops = useMemo(() => {
    if (!trip) return [];
    return trip.stops.slice(trip.currentStopIndex + 1);
  }, [trip]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleDirections = async () => {
    if (!nextStop) return;
    await openExternalDirections({
      origin: userLoc ?? "current",
      destination: nextStop,
      waypoints: remainingStops, // Android only — iOS opens single leg
    });
  };

  const handleMarkVisited = (wineryId: string) => {
    if (!trip) return;
    markStopVisited(trip.id, wineryId);
  };

  const handleEndTrip = () => {
    if (!trip) return;
    Alert.alert(
      "End trip?",
      "This will mark the trip as complete.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End Trip",
          style: "destructive",
          onPress: () => {
            completeTrip(trip.id);
            router.back();
          },
        },
      ]
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (!trip) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>This trip is no longer available.</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backLink}>‹ Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.closeLink}>Close</Text>
        </Pressable>
        <Text style={styles.topTitle}>{trip.name}</Text>
        <Pressable onPress={handleEndTrip} hitSlop={12}>
          <Text style={styles.endLink}>End</Text>
        </Pressable>
      </View>

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, progressBarStyle]} />
        </View>
        <Text style={styles.progressLabel}>
          {trip.visitedStopIds.length} / {trip.stops.length} VISITED
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Map preview — driving route + stops ─────────────────────────
            Shows the actual road polyline returned by Google Directions so
            the user can see where they'll be driving. Falls back to dashed
            straight lines while the route is loading or if the request
            failed (no key, no network, etc.). */}
        {trip.stops.length > 0 && (
          <View style={styles.mapWrap}>
            <MapView
              style={styles.map}
              provider={PROVIDER_GOOGLE}
              customMapStyle={MAP_STYLE}
              initialRegion={initialRegion}
              showsUserLocation
              showsMyLocationButton={false}
              pitchEnabled={false}
              rotateEnabled={false}
              toolbarEnabled={false}
              // Match the loading splash to the dark theme so the map area
              // doesn't flash white before tiles arrive.
              loadingEnabled
              loadingBackgroundColor={colors.surface}
              loadingIndicatorColor={colors.accent}
            >
              {/* Polylines listed FIRST and as direct children of <MapView>
                  (no Fragment / IIFE wrapper). react-native-maps walks the
                  children list to register native overlays — Fragment wrappers
                  can prevent the polyline from being picked up, which is why
                  the route was previously invisible. */}
              {routeDisplayCoords.length > 1 && usingRealRoute && (
                <Polyline
                  key="route-casing"
                  coordinates={routeDisplayCoords}
                  strokeColor={colors.background}
                  strokeWidth={10}
                  zIndex={1}
                  geodesic
                />
              )}
              {routeDisplayCoords.length > 1 && (
                <Polyline
                  key={usingRealRoute ? "route-line" : "route-fallback"}
                  coordinates={routeDisplayCoords}
                  strokeColor={colors.accentSoft}
                  strokeWidth={usingRealRoute ? 6 : 3}
                  lineDashPattern={usingRealRoute ? undefined : [8, 6]}
                  zIndex={2}
                  geodesic
                />
              )}
              {trip.stops.map((s, idx) => {
                // Skip any stop with non-finite coords — same reasoning as the
                // initialRegion filter: react-native-maps + PROVIDER_GOOGLE on
                // iOS crashes silently if a Marker is given NaN.
                if (
                  !Number.isFinite(s.latitude) ||
                  !Number.isFinite(s.longitude)
                ) {
                  return null;
                }
                const visited = trip.visitedStopIds.includes(s.wineryId);
                const isCurrent = idx === trip.currentStopIndex;
                return (
                  <Marker
                    key={s.wineryId}
                    coordinate={{
                      latitude: s.latitude,
                      longitude: s.longitude,
                    }}
                    title={`${idx + 1}. ${s.name}`}
                    // visited → muted, current target → bright lime, upcoming → forest
                    pinColor={
                      visited
                        ? colors.textMuted
                        : isCurrent
                        ? colors.accentSoft
                        : colors.accent
                    }
                  />
                );
              })}
            </MapView>
            {routeLoading && (
              <View style={styles.mapLoadingOverlay}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            )}
          </View>
        )}

        {/* ── Next stop card ─────────────────────────────────────────────── */}
        {nextStop ? (
          <View style={styles.nextCard}>
            <Text style={styles.nextKicker}>NEXT STOP</Text>
            <Text style={styles.nextName}>{nextStop.name}</Text>
            {distanceToNextKm != null && (
              <Text style={styles.nextDistance}>
                {distanceToNextKm.toFixed(1)} km away
                {distanceToNextKm < 50
                  ? ` · ~${Math.round((distanceToNextKm / 50) * 60)} min`
                  : ""}
              </Text>
            )}
            <Pressable
              style={styles.directionsBtn}
              onPress={handleDirections}
            >
              <Ionicons
                name="navigate"
                size={16}
                color={colors.onAccent}
              />
              <Text style={styles.directionsBtnText}>Get Directions</Text>
            </Pressable>
            <Pressable
              style={styles.visitedBtn}
              onPress={() => handleMarkVisited(nextStop.wineryId)}
            >
              <Ionicons
                name="checkmark"
                size={16}
                color={colors.accent}
              />
              <Text style={styles.visitedBtnText}>Mark Visited</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.nextCard}>
            <Text style={styles.nextKicker}>TRIP FINISHED</Text>
            <Text style={styles.nextName}>You’re done!</Text>
          </View>
        )}

        {/* ── Itinerary list ─────────────────────────────────────────────── */}
        <View style={styles.itineraryHeader}>
          <View style={styles.goldLine} />
          <Text style={styles.itineraryLabel}>FULL ITINERARY</Text>
        </View>

        {trip.stops.map((s, idx) => {
          const visited = trip.visitedStopIds.includes(s.wineryId);
          const isCurrent = idx === trip.currentStopIndex;
          return (
            <View
              key={s.wineryId}
              style={[
                styles.stopRow,
                isCurrent && styles.stopRowCurrent,
              ]}
            >
              <View
                style={[
                  styles.stopIdx,
                  visited && styles.stopIdxVisited,
                  isCurrent && !visited && styles.stopIdxCurrent,
                ]}
              >
                <Text
                  style={[
                    styles.stopIdxText,
                    (visited || isCurrent) && styles.stopIdxTextLight,
                  ]}
                >
                  {idx + 1}
                </Text>
              </View>
              <View style={styles.stopBody}>
                <Text
                  style={[
                    styles.stopName,
                    visited && styles.stopNameVisited,
                  ]}
                >
                  {s.name}
                </Text>
                {visited ? (
                  <Text style={styles.stopMetaVisited}>Visited</Text>
                ) : isCurrent ? (
                  <Text style={styles.stopMetaCurrent}>Current target</Text>
                ) : (
                  <Text style={styles.stopMeta}>Upcoming</Text>
                )}
              </View>
              {!visited && (
                <Pressable
                  hitSlop={8}
                  onPress={() => handleMarkVisited(s.wineryId)}
                  style={styles.smallVisitBtn}
                >
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={22}
                    color={colors.textMuted}
                  />
                </Pressable>
              )}
              {visited && (
                <Ionicons
                  name="checkmark-circle"
                  size={22}
                  color={colors.accent}
                />
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  emptyText: { ...type.body, color: colors.textMuted },
  backLink: {
    ...type.kicker,
    color: colors.accentSoft,
  },

  // Top bar
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  closeLink: {
    fontFamily: fonts.serif,
    fontSize: 14,
    color: colors.accentSoft,
  },
  topTitle: {
    ...type.h3,
    fontSize: 18,
    color: colors.textPrimary,
    flex: 1,
    textAlign: "center",
  },
  endLink: {
    ...type.kicker,
    color: colors.error,
  },

  // Progress bar
  progressWrap: {
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.surfaceDeep,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  progressLabel: {
    ...type.kicker,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },

  scroll: { paddingBottom: spacing.hero },

  // Map preview
  mapWrap: {
    height: 220,
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
    borderRadius: radius.card,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: { width: "100%", height: "100%" },
  mapLoadingOverlay: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: colors.surfaceDeep,
    borderRadius: 12,
    padding: 6,
  },

  // Next stop card
  nextCard: {
    marginHorizontal: spacing.xxl,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  nextKicker: {
    ...type.kicker,
    color: colors.accentSoft,
  },
  nextName: {
    ...type.h2,
    color: colors.textPrimary,
  },
  nextDistance: {
    ...type.body,
    color: colors.textSecondary,
    fontFamily: fonts.serif,
    fontStyle: "italic",
  },
  directionsBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: 14,
    minHeight: spacing.hitTarget,
  },
  directionsBtnText: {
    ...type.kicker,
    color: colors.onAccent,
    fontWeight: weights.emphasis,
  },
  visitedBtn: {
    marginTop: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: 14,
    minHeight: spacing.hitTarget,
  },
  visitedBtnText: {
    ...type.kicker,
    color: colors.accent,
    fontWeight: weights.emphasis,
  },

  // Itinerary
  itineraryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.hero,
    marginBottom: spacing.lg,
  },
  goldLine: {
    width: spacing.xl,
    height: 1,
    backgroundColor: colors.accent,
  },
  itineraryLabel: {
    ...type.kicker,
    color: colors.accentSoft,
  },

  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  stopRowCurrent: {
    backgroundColor: colors.surface,
  },
  stopIdx: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  stopIdxCurrent: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentSoft,
  },
  stopIdxVisited: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  stopIdxText: {
    ...type.caption,
    fontWeight: weights.emphasis,
    color: colors.textPrimary,
  },
  stopIdxTextLight: { color: colors.textOnDark },
  stopBody: { flex: 1 },
  stopName: {
    fontFamily: fonts.serif,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  stopNameVisited: {
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  stopMeta: {
    ...type.kicker,
    color: colors.textMuted,
  },
  stopMetaCurrent: {
    ...type.kicker,
    color: colors.accent,
  },
  stopMetaVisited: {
    ...type.kicker,
    color: colors.accent,
  },
  smallVisitBtn: {
    padding: spacing.xs,
  },
});
