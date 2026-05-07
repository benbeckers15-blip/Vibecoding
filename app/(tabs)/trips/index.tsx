// app/(tabs)/trips/index.tsx
// Trips hub — entry point for the trip-planning feature.
//
// Layout:
//   • Editorial header (kicker + serif headline)
//   • "Active Trip" banner (only when one is in progress) → resumes trip-active
//   • "Curated Trips" section — read from Firestore `premade_trips`
//   • "My Trips" section — read from local TripContext
//   • Floating "+ Build Your Own" CTA → /trips/create
//
// Editorial conventions follow constants/theme.ts and mirror the structure
// of app/(tabs)/wineries/index.tsx so the trip pages don't feel bolted on.

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REGION_NAME_UPPER } from "../../../constants/region";
import { colors, fonts, radius, spacing, type, weights } from "../../../constants/theme";
import { useAuth } from "../../../context/AuthContext";
import { useTrips } from "../../../context/TripContext";
import { db } from "../../../firebaseConfig";
import { PremadeTrip, Trip } from "../../../types/trip";

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TripsIndexScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trips, activeTrip, loading: tripsLoading } = useTrips();
  const { loading: authLoading } = useAuth();

  const [premadeTrips, setPremadeTrips] = useState<PremadeTrip[]>([]);
  const [premadeLoading, setPremadeLoading] = useState(true);

  // Wait for Firebase Auth to restore the persisted session before querying
  // Firestore. If we fire before the auth token is attached, rules that require
  // request.auth will reject the read even for a previously-signed-in user.
  useEffect(() => {
    if (authLoading) return;
    (async () => {
      try {
        const q = query(
          collection(db, "premade_trips"),
          orderBy("order", "asc")
        );
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(
          (d) => ({ id: d.id, ...(d.data() as Omit<PremadeTrip, "id">) })
        );
        setPremadeTrips(data);
      } catch (err) {
        console.warn("[trips] failed to fetch premade_trips:", err);
      } finally {
        setPremadeLoading(false);
      }
    })();
  }, [authLoading]);

  const userTrips = trips; // already most-recent-first from context

  if (tripsLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <Text style={styles.headerKicker}>{REGION_NAME_UPPER}</Text>
          <Text style={styles.headerTitle}>Plan Your Trip</Text>
          <Text style={styles.headerLede}>
            Curated itineraries through the region’s cellar doors — or build
            your own.
          </Text>
        </View>

        {/* ── Active trip banner ─────────────────────────────────────────── */}
        {activeTrip && (
          <Pressable
            style={styles.activeBanner}
            onPress={() =>
              router.push({
                pathname: "/trip-active",
                params: { tripId: activeTrip.id },
              })
            }
          >
            <View style={styles.activeBannerInner}>
              <Text style={styles.activeBannerKicker}>TRIP IN PROGRESS</Text>
              <Text style={styles.activeBannerTitle}>{activeTrip.name}</Text>
              <Text style={styles.activeBannerMeta}>
                {activeTrip.visitedStopIds.length} of {activeTrip.stops.length}{" "}
                stops · Tap to resume ›
              </Text>
            </View>
          </Pressable>
        )}

        {/* ── Curated trips ──────────────────────────────────────────────── */}
        <View style={styles.sectionHeaderRow}>
          <View style={styles.goldLine} />
          <Text style={styles.sectionLabel}>CURATED TRIPS</Text>
        </View>

        {premadeLoading ? (
          <View style={styles.sectionLoading}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : premadeTrips.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Curated trips are coming soon. Build your own below.
            </Text>
          </View>
        ) : (
          premadeTrips.map((t) => (
            <PremadeTripCard
              key={t.id}
              trip={t}
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/trips/[id]",
                  params: { id: t.id, kind: "premade" },
                })
              }
            />
          ))
        )}

        {/* ── My trips ───────────────────────────────────────────────────── */}
        <View style={[styles.sectionHeaderRow, { marginTop: spacing.hero }]}>
          <View style={styles.goldLine} />
          <Text style={styles.sectionLabel}>MY TRIPS</Text>
        </View>

        {userTrips.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              You haven’t built a trip yet. Tap the button below to start one.
            </Text>
          </View>
        ) : (
          userTrips.map((t) => (
            <UserTripCard
              key={t.id}
              trip={t}
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/trips/[id]",
                  params: { id: t.id, kind: "user" },
                })
              }
            />
          ))
        )}

        {/* spacer so floating CTA doesn't cover the last card */}
        <View style={{ height: 140 }} />
      </ScrollView>

      {/* ── Floating CTA ─────────────────────────────────────────────────── */}
      <Pressable
        style={styles.fab}
        onPress={() => router.push("/(tabs)/trips/create")}
      >
        <Ionicons name="add" size={20} color={colors.onAccent} />
        <Text style={styles.fabText}>Build Your Own</Text>
      </Pressable>
    </View>
  );
}

// ─── Curated trip card ────────────────────────────────────────────────────────

function PremadeTripCard({
  trip,
  onPress,
}: {
  trip: PremadeTrip;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardImgWrap}>
        <Image
          source={{ uri: trip.heroImage }}
          style={styles.cardImg}
          contentFit="cover"
          transition={150}
        />
        <LinearGradient
          colors={["transparent", colors.photoOverlayStrong]}
          style={styles.cardImgOverlay}
        />
        <View style={styles.cardImgText}>
          <Text style={styles.cardKicker}>
            {trip.region?.toUpperCase() ?? REGION_NAME_UPPER}
          </Text>
          <Text style={styles.cardTitle}>{trip.title}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardBlurb} numberOfLines={2}>
          {trip.blurb}
        </Text>
        <View style={styles.cardMeta}>
          <Text style={styles.cardMetaText}>
            {trip.wineryIds.length} stops
          </Text>
          <Text style={styles.cardMetaSep}>·</Text>
          <Text style={styles.cardMetaText}>~{trip.durationHours} hr</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ─── User trip card ───────────────────────────────────────────────────────────

function UserTripCard({
  trip,
  onPress,
}: {
  trip: Trip;
  onPress: () => void;
}) {
  const statusLabel =
    trip.status === "active"
      ? "IN PROGRESS"
      : trip.status === "completed"
      ? "COMPLETED"
      : "DRAFT";

  return (
    <Pressable style={styles.userCard} onPress={onPress}>
      <View style={styles.userCardInner}>
        <Text style={styles.userCardKicker}>{statusLabel}</Text>
        <Text style={styles.userCardTitle}>{trip.name}</Text>
        <Text style={styles.userCardMeta}>
          {trip.stops.length} stops
          {trip.status === "active"
            ? ` · ${trip.visitedStopIds.length} visited`
            : ""}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={18}
        color={colors.textMuted}
      />
    </Pressable>
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
  },
  scroll: { paddingBottom: spacing.hero },

  // Header
  header: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  headerKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.xs,
  },
  headerTitle: { ...type.h1, color: colors.textPrimary },
  headerLede: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    fontFamily: fonts.serif,
    fontStyle: "italic",
    lineHeight: 22,
  },

  // Active banner
  activeBanner: {
    marginHorizontal: spacing.xxl,
    marginTop: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  activeBannerInner: {
    padding: spacing.xl,
  },
  activeBannerKicker: {
    ...type.kicker,
    color: colors.textOnDark,
    opacity: 0.8,
    marginBottom: spacing.xs,
  },
  activeBannerTitle: {
    ...type.h3,
    color: colors.textOnDark,
    marginBottom: spacing.xs,
  },
  activeBannerMeta: {
    ...type.caption,
    color: colors.textOnDark,
    opacity: 0.85,
  },

  // Section header
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.xxl,
    marginBottom: spacing.lg,
  },
  goldLine: {
    width: spacing.xl,
    height: 1,
    backgroundColor: colors.accent,
  },
  sectionLabel: {
    ...type.kicker,
    color: colors.accentSoft,
  },
  sectionLoading: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
  },

  // Empty state
  empty: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
  },
  emptyText: {
    ...type.body,
    color: colors.textMuted,
    fontFamily: fonts.serif,
    fontStyle: "italic",
  },

  // Curated card
  card: {
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  cardImgWrap: {
    height: 180,
    position: "relative",
  },
  cardImg: { width: "100%", height: "100%" },
  cardImgOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "70%",
  },
  cardImgText: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
  },
  cardKicker: {
    ...type.kicker,
    color: colors.textOnDark,
    opacity: 0.8,
    marginBottom: spacing.xs,
  },
  cardTitle: { ...type.h3, color: colors.textOnDark },
  cardBody: {
    padding: spacing.xl,
  },
  cardBlurb: {
    ...type.body,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cardMetaText: {
    ...type.kicker,
    color: colors.textMuted,
  },
  cardMetaSep: {
    ...type.kicker,
    color: colors.textMuted,
  },

  // User trip card
  userCard: {
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  userCardInner: { flex: 1 },
  userCardKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.xs,
  },
  userCardTitle: {
    ...type.h3,
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 22,
    marginBottom: 2,
  },
  userCardMeta: {
    ...type.caption,
    color: colors.textMuted,
  },

  // Floating CTA
  fab: {
    position: "absolute",
    right: spacing.xxl,
    bottom: 100, // above the floating tab bar
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  fabText: {
    ...type.kicker,
    color: colors.onAccent,
    fontWeight: weights.emphasis,
  },
});
