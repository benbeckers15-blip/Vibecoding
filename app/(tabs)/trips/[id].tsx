// app/(tabs)/trips/[id].tsx
// Trip detail screen.
//
// Two flavours, switched by the `kind` route param:
//   • kind=premade — read-only view of a curated trip from Firestore. The
//     user taps "Start Trip" → we clone it into a fresh user Trip, run
//     route optimisation, and push to /trip-active.
//   • kind=user    — view of a user-created trip. Tapping Start Trip runs
//     route optimisation in place, flips status to active, pushes to
//     /trip-active. If already completed, shows the read-only summary.
//
// Map preview shows all stops with markers; the optimised order is only
// computed at start-time so we don't hit the Directions API on every view.

import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Location from "expo-location";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
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
import MapView, { Marker, Polyline } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REGION_NAME_UPPER } from "../../../constants/region";
import { colors, fonts, radius, spacing, type, weights } from "../../../constants/theme";
import { useTrips } from "../../../context/TripContext";
import { db } from "../../../firebaseConfig";
import { PremadeTrip, TripStop } from "../../../types/trip";
import { optimiseRoute } from "../../../utils/routePlanner";

// Geometry of the floating tab bar in app/(tabs)/_layout.tsx — kept in sync
// here so the bottom CTA can sit clear of it instead of being hidden behind.
const TAB_BAR_HEIGHT = 64;
const TAB_BAR_BOTTOM_INSET = Platform.OS === "ios" ? 20 : 12;
const CTA_GAP_ABOVE_TAB_BAR = 12;
const CTA_BOTTOM = TAB_BAR_BOTTOM_INSET + TAB_BAR_HEIGHT + CTA_GAP_ABOVE_TAB_BAR;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TripDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; kind?: string }>();
  const tripId = String(params.id);
  const kind = (params.kind === "premade" ? "premade" : "user") as
    | "premade"
    | "user";

  const { getTrip, createTrip, setTripStops, startTrip, deleteTrip } =
    useTrips();

  // ── State ─────────────────────────────────────────────────────────────────
  const [premade, setPremade] = useState<PremadeTrip | null>(null);
  const [premadeStops, setPremadeStops] = useState<TripStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const userTrip = kind === "user" ? getTrip(tripId) : undefined;

  // For user trips, the stops come straight from context. For premade, we
  // fetch the trip + its referenced wineries from Firestore.
  useEffect(() => {
    if (kind === "user") {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const tripSnap = await getDoc(doc(db, "premade_trips", tripId));
        if (!tripSnap.exists()) {
          setLoading(false);
          return;
        }
        const tripData = {
          id: tripSnap.id,
          ...(tripSnap.data() as Omit<PremadeTrip, "id">),
        };
        setPremade(tripData);

        // Fetch the referenced wineries — chunk to handle Firestore's
        // 30-id "in" limit (we won't have that many, but keep it safe).
        const ids = tripData.wineryIds;
        if (ids.length === 0) {
          setLoading(false);
          return;
        }
        const wineries: TripStop[] = [];
        for (let i = 0; i < ids.length; i += 10) {
          const chunk = ids.slice(i, i + 10);
          const q = query(
            collection(db, "wineries"),
            where("__name__", "in", chunk)
          );
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const data = d.data() as any;
            if (
              typeof data.latitude === "number" &&
              typeof data.longitude === "number"
            ) {
              wineries.push({
                wineryId: d.id,
                name: data.name ?? "",
                slug: data.slug ?? d.id,
                latitude: data.latitude,
                longitude: data.longitude,
              });
            }
          });
        }
        // Preserve curated order from the trip doc
        const ordered = ids
          .map((id) => wineries.find((w) => w.wineryId === id))
          .filter(Boolean) as TripStop[];
        setPremadeStops(ordered);
      } catch (err) {
        console.warn("[trip detail] failed to load premade trip:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [tripId, kind]);

  // ── Stops shown on screen ─────────────────────────────────────────────────
  const stops: TripStop[] = useMemo(() => {
    if (kind === "user") return userTrip?.stops ?? [];
    return premadeStops;
  }, [kind, userTrip, premadeStops]);

  const title =
    kind === "user" ? userTrip?.name ?? "Trip" : premade?.title ?? "Trip";
  const blurb = kind === "premade" ? premade?.blurb : undefined;
  const durationHours = kind === "premade" ? premade?.durationHours : undefined;

  // ── Map region — center on stops ──────────────────────────────────────────
  const initialRegion = useMemo(() => {
    if (stops.length === 0) {
      return {
        latitude: -33.95,
        longitude: 115.07,
        latitudeDelta: 0.3,
        longitudeDelta: 0.3,
      };
    }
    const lats = stops.map((s) => s.latitude);
    const lngs = stops.map((s) => s.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.6),
      longitudeDelta: Math.max(0.05, (maxLng - minLng) * 1.6),
    };
  }, [stops]);

  // ── Start Trip handler ────────────────────────────────────────────────────
  const handleStart = async () => {
    if (stops.length < 2) {
      Alert.alert("Not enough stops", "A trip needs at least 2 wineries.");
      return;
    }
    setStarting(true);
    try {
      // 1. Get the user's location for routing origin
      let origin: { latitude: number; longitude: number } | null = null;
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status === "granted") {
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          origin = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          };
        } catch {
          /* fall through — handled below */
        }
      }
      // Fallback to the first stop as origin if location unavailable
      if (!origin) {
        origin = { latitude: stops[0].latitude, longitude: stops[0].longitude };
      }

      // 2. Optimise the route
      const optimised = await optimiseRoute(origin, stops);

      // 3. For premade: clone into a fresh user Trip. For user: update stops.
      let activeTripId: string;
      if (kind === "premade") {
        activeTripId = createTrip(title, optimised.orderedStops);
        setTripStops(activeTripId, optimised.orderedStops, optimised.usedGoogle);
      } else {
        activeTripId = tripId;
        setTripStops(tripId, optimised.orderedStops, optimised.usedGoogle);
      }

      // 4. Flip to active and open the active-trip modal
      startTrip(activeTripId);
      router.replace({
        pathname: "/trip-active",
        params: { tripId: activeTripId },
      });
    } catch (err) {
      console.warn("[trip detail] start failed:", err);
      Alert.alert(
        "Couldn’t start trip",
        "We couldn’t plan a route just now. Please try again."
      );
    } finally {
      setStarting(false);
    }
  };

  const handleDelete = () => {
    if (kind !== "user") return;
    Alert.alert(
      "Delete trip?",
      "This will remove the trip from your device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteTrip(tripId);
            router.back();
          },
        },
      ]
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (kind === "user" && !userTrip) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>This trip no longer exists.</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backLink}>‹ Back</Text>
        </Pressable>
      </View>
    );
  }

  const isCompleted = kind === "user" && userTrip?.status === "completed";
  const isActive = kind === "user" && userTrip?.status === "active";

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: CTA_BOTTOM + 80 }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backLink}>‹ Trips</Text>
          </Pressable>
          <Text style={styles.headerKicker}>
            {kind === "premade" ? "CURATED" : "YOUR TRIP"}
          </Text>
          <Text style={styles.headerTitle}>{title}</Text>
          {blurb && <Text style={styles.headerBlurb}>{blurb}</Text>}
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{stops.length} STOPS</Text>
            {durationHours != null && (
              <>
                <Text style={styles.metaSep}>·</Text>
                <Text style={styles.metaText}>~{durationHours} HR</Text>
              </>
            )}
            {isActive && (
              <>
                <Text style={styles.metaSep}>·</Text>
                <Text style={[styles.metaText, { color: colors.accent }]}>
                  IN PROGRESS
                </Text>
              </>
            )}
            {isCompleted && (
              <>
                <Text style={styles.metaSep}>·</Text>
                <Text style={styles.metaText}>COMPLETED</Text>
              </>
            )}
          </View>
        </View>

        {/* ── Map preview ────────────────────────────────────────────────── */}
        {stops.length > 0 && (
          <View style={styles.mapWrap}>
            <MapView style={styles.map} initialRegion={initialRegion}>
              {stops.map((s, idx) => (
                <Marker
                  key={s.wineryId}
                  coordinate={{
                    latitude: s.latitude,
                    longitude: s.longitude,
                  }}
                  title={`${idx + 1}. ${s.name}`}
                  pinColor={colors.accent}
                />
              ))}
              <Polyline
                coordinates={stops.map((s) => ({
                  latitude: s.latitude,
                  longitude: s.longitude,
                }))}
                strokeColor={colors.accent}
                strokeWidth={3}
              />
            </MapView>
          </View>
        )}

        {/* ── Stop list ──────────────────────────────────────────────────── */}
        <View style={styles.stopsHeader}>
          <View style={styles.goldLine} />
          <Text style={styles.stopsHeaderLabel}>ITINERARY</Text>
        </View>

        {stops.map((s, idx) => {
          const visited =
            kind === "user" &&
            userTrip?.visitedStopIds.includes(s.wineryId);
          return (
            <View key={s.wineryId} style={styles.stopRow}>
              <View
                style={[
                  styles.stopIdx,
                  visited && styles.stopIdxVisited,
                ]}
              >
                <Text style={styles.stopIdxText}>{idx + 1}</Text>
              </View>
              <View style={styles.stopBody}>
                <Text style={styles.stopName}>{s.name}</Text>
                <Text style={styles.stopRegion}>{REGION_NAME_UPPER}</Text>
              </View>
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

        {/* User trip — delete affordance */}
        {kind === "user" && !isActive && (
          <Pressable style={styles.deleteBtn} onPress={handleDelete}>
            <Text style={styles.deleteText}>Delete Trip</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      {/* Positioned above the floating tab bar (defined in (tabs)/_layout.tsx)
          so the green pill isn't obscured by the nav. */}
      <View style={styles.ctaBar} pointerEvents="box-none">
        {isActive ? (
          <Pressable
            style={styles.ctaBtn}
            onPress={() =>
              router.push({
                pathname: "/trip-active",
                params: { tripId },
              })
            }
          >
            <Text style={styles.ctaBtnText}>Resume Trip</Text>
          </Pressable>
        ) : isCompleted ? (
          <View style={[styles.ctaBtn, styles.ctaBtnDisabled]}>
            <Text style={styles.ctaBtnText}>Trip Completed</Text>
          </View>
        ) : (
          <Pressable
            style={[styles.ctaBtn, starting && styles.ctaBtnDisabled]}
            onPress={handleStart}
            disabled={starting}
          >
            {starting ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.ctaBtnText}>Start Trip</Text>
            )}
          </Pressable>
        )}
      </View>
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

  header: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  backLink: {
    fontFamily: fonts.serif,
    fontSize: 14,
    color: colors.accentSoft,
  },
  headerKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginTop: spacing.sm,
  },
  headerTitle: { ...type.h1, color: colors.textPrimary },
  headerBlurb: {
    ...type.body,
    color: colors.textSecondary,
    fontFamily: fonts.serif,
    fontStyle: "italic",
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  metaText: {
    ...type.kicker,
    color: colors.textMuted,
  },
  metaSep: {
    ...type.kicker,
    color: colors.textMuted,
  },

  mapWrap: {
    height: 240,
    marginHorizontal: spacing.xxl,
    marginVertical: spacing.lg,
    borderRadius: radius.card,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: { width: "100%", height: "100%" },

  stopsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  goldLine: {
    width: spacing.xl,
    height: 1,
    backgroundColor: colors.accent,
  },
  stopsHeaderLabel: {
    ...type.kicker,
    color: colors.accentSoft,
  },

  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    gap: spacing.md,
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
  stopIdxVisited: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  stopIdxText: {
    ...type.caption,
    fontWeight: weights.emphasis,
    color: colors.textPrimary,
  },
  stopBody: { flex: 1 },
  stopName: {
    fontFamily: fonts.serif,
    fontSize: 17,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  stopRegion: {
    ...type.kicker,
    color: colors.textMuted,
  },

  deleteBtn: {
    marginTop: spacing.xxl,
    marginHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  deleteText: {
    ...type.kicker,
    color: colors.error,
  },

  ctaBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: CTA_BOTTOM,
    paddingHorizontal: spacing.xxl,
    // No background / borderTop — the bar sits above the floating tab bar
    // so a full-width band would leave an awkward strip of color over the
    // page. The pill below carries its own visual weight.
    zIndex: 1500,
  },
  ctaBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    minHeight: spacing.hitTarget,
    // Subtle lift so the floating pill separates from page content scrolling
    // underneath it.
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  ctaBtnDisabled: { opacity: 0.5 },
  ctaBtnText: {
    ...type.kicker,
    color: colors.onAccent,
    fontWeight: weights.emphasis,
  },
});
