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
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { fetchRoutePolyline, type LatLng } from "../../../utils/fetchRoutePolyline";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REGION_NAME_UPPER } from "../../../constants/region";
import { MAP_STYLE } from "../../../constants/mapStyle";
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

  // Driving route polyline — fetched from Google Directions API after stops load.
  // Falls back to straight lines (empty array) if the fetch fails.
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);

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
        // Guard against malformed docs where `wineryIds` is missing or not
        // an array — otherwise `.length` / `.slice` blows up before we even
        // get to the map, and the screen crashes silently behind the catch.
        const ids = Array.isArray(tripData.wineryIds)
          ? tripData.wineryIds.filter((x): x is string => typeof x === "string")
          : [];
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
            // Use Number.isFinite — `typeof NaN === "number"` is true, so the
            // looser typeof check lets NaN coords (from failed geocoding)
            // through. Once NaN reaches MapView's initialRegion, Google Maps
            // on iOS hard-crashes silently, which is exactly what was
            // happening on the Derwent Valley trip.
            if (
              Number.isFinite(data.latitude) &&
              Number.isFinite(data.longitude)
            ) {
              wineries.push({
                wineryId: d.id,
                name: data.name ?? "",
                slug: data.slug ?? d.id,
                latitude: data.latitude,
                longitude: data.longitude,
              });
            } else if (__DEV__) {
              // Surface bad data in dev so we can fix the Firestore record
              // rather than silently dropping it forever.
              console.warn(
                `[trip detail] dropping winery ${d.id} — non-finite coords:`,
                data.latitude,
                data.longitude
              );
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
  // Belt-and-braces: filter out stops with non-finite coords here too. The
  // premade branch already filters at fetch time, but `userTrip?.stops` comes
  // straight from AsyncStorage — and any user trip created before the
  // create.tsx filter was tightened can carry NaN-coord stops on disk. Strip
  // them at the source so every downstream consumer (Map, Polyline, route
  // optimiser, Directions API) only ever sees finite coords.
  const stops: TripStop[] = useMemo(() => {
    const raw = kind === "user" ? userTrip?.stops ?? [] : premadeStops;
    return raw.filter(
      (s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
    );
  }, [kind, userTrip, premadeStops]);

  const title =
    kind === "user" ? userTrip?.name ?? "Trip" : premade?.title ?? "Trip";
  const blurb = kind === "premade" ? premade?.blurb : undefined;
  const durationHours = kind === "premade" ? premade?.durationHours : undefined;

  // ── Polyline coords — derive once per render so we don't recompute or build
  // them inside the JSX. Wrapping Polylines in an IIFE / Fragment inside
  // <MapView> can prevent react-native-maps from registering the overlay on
  // the native side (it traverses children to find Marker/Polyline nodes,
  // and Fragment wrappers can interfere with that).
  //
  // Defensive filter: if any non-finite coord ever sneaks past the upstream
  // filter (e.g. corrupted Firestore data), strip it here so the polyline
  // never hands NaN to the native side.
  const routeDisplayCoords: LatLng[] = useMemo(() => {
    const source = routeCoords.length > 1
      ? routeCoords
      : stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }));
    return source.filter(
      (c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
    );
  }, [routeCoords, stops]);
  const usingRealRoute = routeCoords.length > 1;

  // ── Map region — center on stops ──────────────────────────────────────────
  // We compute from stops with finite coords only. Even though the upstream
  // filter rejects NaN, defending here means a single bad doc can never take
  // down the screen via initialRegion={NaN, NaN, NaN, NaN} — which was the
  // exact path that crashed the Derwent Valley trip.
  const initialRegion = useMemo(() => {
    const safeStops = stops.filter(
      (s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
    );
    if (safeStops.length === 0) {
      // Tasmania-wide fallback — sensible default for this app's region.
      return {
        latitude: -42.0,
        longitude: 146.8,
        latitudeDelta: 3.0,
        longitudeDelta: 3.0,
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
      latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.6),
      longitudeDelta: Math.max(0.05, (maxLng - minLng) * 1.6),
    };
  }, [stops]);

  // ── Fetch driving-route polyline for the map preview ─────────────────────
  useEffect(() => {
    if (stops.length < 2) {
      setRouteCoords([]);
      return;
    }
    let cancelled = false;
    setRouteLoading(true);
    fetchRoutePolyline(stops).then((coords) => {
      if (!cancelled) {
        setRouteCoords(coords ?? []);
        setRouteLoading(false);
      }
    });
    return () => {
      cancelled = true;
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
        // Leave clear space for the floating tab bar at the bottom — the CTA
        // now lives on the map (top-right), so we no longer reserve room for
        // a full-width bottom button.
        contentContainerStyle={{ paddingBottom: CTA_BOTTOM }}
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

        {/* ── CTA above the map (right-aligned) ──────────────────────────────
            Sits directly above the map preview, anchored to the right edge so
            the action stays prominent and clear of the map gestures below. */}
        {stops.length > 0 && (
          <View style={styles.mapCtaRow}>
            {isActive ? (
              <Pressable
                style={styles.mapCtaBtn}
                onPress={() =>
                  router.push({
                    pathname: "/trip-active",
                    params: { tripId },
                  })
                }
              >
                <Ionicons
                  name="play"
                  size={18}
                  color={colors.onAccent}
                />
                <Text style={styles.mapCtaText}>Resume</Text>
              </Pressable>
            ) : isCompleted ? (
              <View style={[styles.mapCtaBtn, styles.mapCtaBtnDisabled]}>
                <Ionicons
                  name="checkmark"
                  size={18}
                  color={colors.onAccent}
                />
                <Text style={styles.mapCtaText}>Completed</Text>
              </View>
            ) : (
              <Pressable
                style={[
                  styles.mapCtaBtn,
                  starting && styles.mapCtaBtnDisabled,
                ]}
                onPress={handleStart}
                disabled={starting}
              >
                {starting ? (
                  <ActivityIndicator size="small" color={colors.onAccent} />
                ) : (
                  <>
                    <Ionicons
                      name="play"
                      size={18}
                      color={colors.onAccent}
                    />
                    <Text style={styles.mapCtaText}>Start Trip</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        )}

        {/* ── Map preview ────────────────────────────────────────────────── */}
        {stops.length > 0 && (
          <View style={styles.mapWrap}>
            <MapView
              style={styles.map}
              provider={PROVIDER_GOOGLE}
              customMapStyle={MAP_STYLE}
              initialRegion={initialRegion}
              loadingEnabled
              loadingBackgroundColor={colors.surface}
              loadingIndicatorColor={colors.accent}
            >
              {/* Polylines FIRST so they render below the markers. Listing
                  them as direct children of MapView (no Fragment / IIFE
                  wrapper) is required — react-native-maps traverses children
                  to register native overlays, and Fragments can break that. */}
              {/* Route polylines. Both use stable keys so React UPDATES their
                  props when the real route arrives rather than unmounting +
                  remounting the native GMSPolyline. Unmounting while the map
                  is fully active (i.e. tiles have loaded) crashes the Google
                  Maps iOS SDK silently on real devices — the Derwent Valley
                  trip triggered this because its longer fetch completed after
                  the map was active, whereas shorter trips' fetches completed
                  during initialization when the SDK is more forgiving.
                  The casing is shown only for the real route; its conditional
                  render (add/remove, not key-swap) is safe. */}
              {routeDisplayCoords.length > 1 && usingRealRoute && (
                <Polyline
                  key="route-casing"
                  coordinates={routeDisplayCoords}
                  strokeColor={colors.background}
                  strokeWidth={9}
                  zIndex={1}
                  geodesic
                />
              )}
              {routeDisplayCoords.length > 1 && (
                <Polyline
                  key="route-polyline"
                  coordinates={routeDisplayCoords}
                  strokeColor={colors.accentSoft}
                  strokeWidth={usingRealRoute ? 5 : 2}
                  strokeOpacity={usingRealRoute ? 1 : 0.45}
                  zIndex={2}
                  geodesic
                />
              )}
              {stops.map((s, idx) => {
                // Skip any stop with a non-finite coord — react-native-maps
                // can crash natively (especially with PROVIDER_GOOGLE on iOS)
                // if a Marker receives NaN. Belt-and-braces with the upstream
                // Number.isFinite filter.
                if (
                  !Number.isFinite(s.latitude) ||
                  !Number.isFinite(s.longitude)
                ) {
                  return null;
                }
                return (
                  <Marker
                    key={s.wineryId}
                    coordinate={{
                      latitude: s.latitude,
                      longitude: s.longitude,
                    }}
                    title={`${idx + 1}. ${s.name}`}
                    pinColor={colors.accent}
                  />
                );
              })}
            </MapView>
            {/* Spinner overlay while the driving route is being fetched */}
            {routeLoading && (
              <View style={styles.mapLoadingOverlay}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            )}
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
            <Pressable
              key={s.wineryId}
              style={({ pressed }) => [
                styles.stopRow,
                pressed && styles.stopRowPressed,
              ]}
              onPress={() =>
                router.push(
                  `/wineries/${s.slug}?from=trip&tripId=${encodeURIComponent(
                    tripId
                  )}&kind=${kind}` as any
                )
              }
              accessibilityRole="link"
              accessibilityLabel={`View ${s.name}`}
            >
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
              {visited ? (
                <Ionicons
                  name="checkmark-circle"
                  size={22}
                  color={colors.accent}
                />
              ) : (
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textMuted}
                />
              )}
            </Pressable>
          );
        })}

        {/* User trip — delete affordance */}
        {kind === "user" && !isActive && (
          <Pressable style={styles.deleteBtn} onPress={handleDelete}>
            <Text style={styles.deleteText}>Delete Trip</Text>
          </Pressable>
        )}
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
    fontFamily: fonts.sans,
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
  // Subtle dimming on tap so users get tactile feedback that the row links out.
  stopRowPressed: {
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

  // ── CTA above the map (right-aligned) ────────────────────────────────────
  // Lives in flow ABOVE the map preview, right-aligned via flex. Slightly
  // larger than the previous overlay pill so it's easy to spot.
  mapCtaRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  mapCtaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    // Subtle lift to anchor the CTA visually above the map below.
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  mapCtaBtnDisabled: { opacity: 0.6 },
  mapCtaText: {
    ...type.kicker,
    fontSize: 13,
    color: colors.onAccent,
    fontWeight: weights.emphasis,
    letterSpacing: 1.5,
  },
});
