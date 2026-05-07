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
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius, spacing, type, weights } from "../constants/theme";
import { useTrips } from "../context/TripContext";
import { distanceKm } from "../utils/routePlanner";
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
