// app/(tabs)/trips/index.tsx
// Trips hub — entry point for the trip-planning feature.
//
// Layout (mirrors the editorial language of app/(tabs)/wineries/index.tsx):
//   • Editorial header (kicker + serif headline + italic lede)
//   • "Active Trip" banner (only when one is in progress) → resumes trip-active
//   • REGIONAL HALF-DAY  — horizontal scroll of compact trail cards
//                          (2–3 wineries each, one per region). Lime accent.
//   • REGIONAL FULL-DAY  — vertical stack of large trail cards on a tinted
//                          band so the section reads as visually separate
//                          from the half-day rail (4–5 wineries each, one
//                          per region). Forest accent + sunny icon.
//   • "My Trips" section — read from local TripContext
//   • Floating "+ Build Your Own" CTA → /trips/create
//
// Categorisation rule: a curated trip is treated as half-day when its
// `wineryIds` length is ≤3, and full-day when ≥4. This lines up with the
// product spec (half = 2–3 stops, full = 4–5 stops) without requiring a
// Firestore schema migration.

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REGION_NAME_UPPER } from "../../../constants/region";
import { colors, fonts, radius, spacing, type, weights } from "../../../constants/theme";
import { useAuth } from "../../../context/AuthContext";
import { useTrips } from "../../../context/TripContext";
import { db } from "../../../firebaseConfig";
import { PremadeTrip, Trip } from "../../../types/trip";

// ─── Constants ────────────────────────────────────────────────────────────────

// Tipping point between half-day and full-day. ≤ HALF_DAY_MAX_STOPS counts as
// half-day, anything above is full-day. Matches the product spec (2–3 vs 4–5).
const HALF_DAY_MAX_STOPS = 3;

// Compact card width on the half-day rail. Tuned so two cards peek into view
// on a 390pt screen, hinting that the rail scrolls horizontally.
const HALF_CARD_WIDTH = 260;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TripsIndexScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trips, activeTrip, loading: tripsLoading } = useTrips();
  const { loading: authLoading } = useAuth();

  const [premadeTrips, setPremadeTrips] = useState<PremadeTrip[]>([]);
  const [premadeLoading, setPremadeLoading] = useState(true);

  // Wait for Firebase Auth to restore the persisted session before querying
  // Firestore. If we fire before the auth token is attached, rules that
  // require request.auth will reject the read even for a returning user.
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

  // ── Split curated trips by tier ───────────────────────────────────────────
  const { halfDayTrips, fullDayTrips } = useMemo(() => {
    const half: PremadeTrip[] = [];
    const full: PremadeTrip[] = [];
    for (const t of premadeTrips) {
      const stops = t.wineryIds?.length ?? 0;
      if (stops <= HALF_DAY_MAX_STOPS) half.push(t);
      else full.push(t);
    }
    return { halfDayTrips: half, fullDayTrips: full };
  }, [premadeTrips]);

  const userTrips = trips; // already most-recent-first from context

  if (tripsLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const openTrip = (id: string) =>
    router.push({
      pathname: "/(tabs)/trips/[id]",
      params: { id, kind: "premade" },
    });

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
            Curated trails through every cellar door region — pick a half-day
            taster or settle in for the full day.
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

        {/* ── Loading state for both curated rails ────────────────────────── */}
        {premadeLoading ? (
          <View style={styles.sectionLoading}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : (
          <>
            {/* ── Regional Half-Day ─────────────────────────────────────── */}
            <SectionHeading
              kicker="HALF-DAY TRAILS"
              title="Regional Half-Day"
              subtitle="2–3 cellar doors · about three hours"
              icon="partly-sunny-outline"
              accentColor={colors.accentSoft}
            />

            {halfDayTrips.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  Half-day trails are coming soon.
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.halfRail}
                decelerationRate="fast"
                snapToInterval={HALF_CARD_WIDTH + spacing.md}
                snapToAlignment="start"
              >
                {halfDayTrips.map((t) => (
                  <HalfDayCard
                    key={t.id}
                    trip={t}
                    onPress={() => openTrip(t.id)}
                  />
                ))}
              </ScrollView>
            )}

            {/* ── Regional Full-Day ─────────────────────────────────────── */}
            <View style={styles.fullDayBand}>
              <SectionHeading
                kicker="FULL-DAY TRAILS"
                title="Regional Full-Day"
                subtitle="4–5 cellar doors · the long way round"
                icon="sunny-outline"
                accentColor={colors.accent}
              />

              {fullDayTrips.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>
                    Full-day trails are coming soon.
                  </Text>
                </View>
              ) : (
                fullDayTrips.map((t) => (
                  <FullDayCard
                    key={t.id}
                    trip={t}
                    onPress={() => openTrip(t.id)}
                  />
                ))
              )}
            </View>
          </>
        )}

        {/* ── My trips ───────────────────────────────────────────────────── */}
        <View style={styles.sectionHeaderRow}>
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

        {/* spacer so the floating CTA never sits on top of the last card */}
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

// ─── Section heading ──────────────────────────────────────────────────────────
// Editorial kicker + serif title + italic subtitle. Accent-colored hairline +
// icon establish the section's identity (lime/partly-sunny for half, forest/
// sunny for full).

function SectionHeading({
  kicker,
  title,
  subtitle,
  icon,
  accentColor,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  accentColor: string;
}) {
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionTopRow}>
        <View style={[styles.accentLine, { backgroundColor: accentColor }]} />
        <Text style={[styles.sectionKicker, { color: accentColor }]}>
          {kicker}
        </Text>
      </View>
      <View style={styles.sectionTitleRow}>
        <Ionicons
          name={icon}
          size={18}
          color={accentColor}
          style={{ marginRight: spacing.sm }}
        />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );
}

// ─── Half-day card (compact, horizontal-scroll) ───────────────────────────────

function HalfDayCard({
  trip,
  onPress,
}: {
  trip: PremadeTrip;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.halfCard, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.halfImgWrap}>
        <Image
          source={{ uri: trip.heroImage }}
          style={styles.halfImg}
          contentFit="cover"
          transition={150}
        />
        <LinearGradient
          colors={["transparent", colors.photoOverlayStrong]}
          style={styles.halfImgOverlay}
        />
        {/* Lime tier pill — visually marks this as a half-day card */}
        <View style={styles.halfTierPill}>
          <Ionicons
            name="partly-sunny-outline"
            size={10}
            color={colors.background}
            style={{ marginRight: 4 }}
          />
          <Text style={styles.halfTierPillText}>HALF DAY</Text>
        </View>
        <View style={styles.halfImgText}>
          <Text style={styles.halfKicker}>
            {(trip.region ?? REGION_NAME_UPPER).toUpperCase()}
          </Text>
          <Text style={styles.halfTitle} numberOfLines={2}>
            {trip.title}
          </Text>
        </View>
      </View>
      <View style={styles.halfMetaRow}>
        <Text style={styles.halfMetaText}>
          {trip.wineryIds.length} STOPS
        </Text>
        <View style={styles.halfMetaDot} />
        <Text style={styles.halfMetaText}>~{trip.durationHours} HR</Text>
      </View>
    </Pressable>
  );
}

// ─── Full-day card (large, full-width) ────────────────────────────────────────

function FullDayCard({
  trip,
  onPress,
}: {
  trip: PremadeTrip;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.fullCardShadow, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.fullCard}>
        <View style={styles.fullImgWrap}>
          <Image
            source={{ uri: trip.heroImage }}
            style={styles.fullImg}
            contentFit="cover"
            transition={150}
          />
          <LinearGradient
            colors={["transparent", colors.photoOverlayStrong]}
            style={styles.fullImgOverlay}
          />
          {/* Forest tier pill — visually marks this as a full-day card */}
          <View style={styles.fullTierPill}>
            <Ionicons
              name="sunny-outline"
              size={11}
              color={colors.onAccent}
              style={{ marginRight: 4 }}
            />
            <Text style={styles.fullTierPillText}>FULL DAY</Text>
          </View>
          <View style={styles.fullImgText}>
            <Text style={styles.fullKicker}>
              {(trip.region ?? REGION_NAME_UPPER).toUpperCase()}
            </Text>
            <Text style={styles.fullTitle} numberOfLines={2}>
              {trip.title}
            </Text>
          </View>
        </View>
        <View style={styles.fullBody}>
          <Text style={styles.fullBlurb} numberOfLines={2}>
            {trip.blurb}
          </Text>
          <View style={styles.fullMetaRow}>
            <View style={styles.fullMetaItem}>
              <Ionicons
                name="wine-outline"
                size={12}
                color={colors.accent}
                style={{ marginRight: 4 }}
              />
              <Text style={styles.fullMetaText}>
                {trip.wineryIds.length} stops
              </Text>
            </View>
            <View style={styles.fullMetaDot} />
            <View style={styles.fullMetaItem}>
              <Ionicons
                name="time-outline"
                size={12}
                color={colors.accent}
                style={{ marginRight: 4 }}
              />
              <Text style={styles.fullMetaText}>
                ~{trip.durationHours} hr
              </Text>
            </View>
          </View>
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

  // ── Header ──────────────────────────────────────────────────────────────
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
    fontFamily: fonts.sans,
    lineHeight: 22,
  },

  // ── Active banner ───────────────────────────────────────────────────────
  activeBanner: {
    marginHorizontal: spacing.xxl,
    marginTop: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.cardLg,
    overflow: "hidden",
  },
  activeBannerInner: {
    padding: spacing.xl,
  },
  activeBannerKicker: {
    ...type.kicker,
    color: colors.textOnDark,
    opacity: 0.85,
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

  // ── Section heading (used by both curated rails) ───────────────────────
  sectionBlock: {
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.xxxl,
    marginBottom: spacing.lg,
  },
  sectionTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  accentLine: {
    width: spacing.xl,
    height: 1,
  },
  sectionKicker: {
    ...type.kicker,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...type.h2,
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    ...type.body,
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    lineHeight: 20,
  },

  // ── Plain "MY TRIPS" section header (matches wineries divider style) ───
  sectionHeaderRow: {
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
  sectionLabel: {
    ...type.kicker,
    color: colors.accentSoft,
  },

  sectionLoading: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
  },

  // ── Empty state ─────────────────────────────────────────────────────────
  empty: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
  },
  emptyText: {
    ...type.body,
    color: colors.textMuted,
    fontFamily: fonts.serifItalic,
  },

  // ── Half-day rail ───────────────────────────────────────────────────────
  halfRail: {
    paddingLeft: spacing.xxl,
    paddingRight: spacing.lg,
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
  halfCard: {
    width: HALF_CARD_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: radius.cardLg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  halfImgWrap: {
    height: 150,
    position: "relative",
    backgroundColor: colors.surfaceDeep,
  },
  halfImg: { width: "100%", height: "100%" },
  halfImgOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "75%",
  },
  halfTierPill: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  halfTierPillText: {
    ...type.kicker,
    fontSize: 9,
    letterSpacing: 1.4,
    color: colors.background,
    fontWeight: weights.emphasis,
  },
  halfImgText: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
  },
  halfKicker: {
    ...type.kicker,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.textOnDark,
    opacity: 0.85,
    marginBottom: spacing.xs,
  },
  halfTitle: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 18,
    lineHeight: 22,
    color: colors.textOnDark,
    letterSpacing: -0.2,
  },
  halfMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  halfMetaText: {
    ...type.kicker,
    color: colors.textMuted,
  },
  halfMetaDot: {
    width: 3,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
  },

  // ── Full-day band + cards ───────────────────────────────────────────────
  // The band is a tinted strip behind the full-day rail. It's the strongest
  // visual cue separating this section from the half-day rail above.
  fullDayBand: {
    marginTop: spacing.xxl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
    backgroundColor: colors.surfaceDeep,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fullCardShadow: {
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
    borderRadius: radius.cardLg,
    backgroundColor: colors.surfaceElevated,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 4,
  },
  fullCard: {
    borderRadius: radius.cardLg,
    overflow: "hidden",
  },
  fullImgWrap: {
    height: 200,
    position: "relative",
    backgroundColor: colors.surfaceDeep,
  },
  fullImg: { width: "100%", height: "100%" },
  fullImgOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "70%",
  },
  fullTierPill: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  fullTierPillText: {
    ...type.kicker,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.onAccent,
    fontWeight: weights.emphasis,
  },
  fullImgText: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
  },
  fullKicker: {
    ...type.kicker,
    color: colors.textOnDark,
    opacity: 0.85,
    marginBottom: spacing.xs,
  },
  fullTitle: {
    ...type.h2,
    color: colors.textOnDark,
  },
  fullBody: {
    padding: spacing.xl,
  },
  fullBlurb: {
    ...type.body,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  fullMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  fullMetaItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  fullMetaText: {
    ...type.kicker,
    color: colors.textPrimary,
  },
  fullMetaDot: {
    width: 3,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
  },

  // ── User trip card ──────────────────────────────────────────────────────
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

  // ── Pressed feedback (shared) ───────────────────────────────────────────
  cardPressed: {
    opacity: 0.92,
  },

  // ── Floating CTA ────────────────────────────────────────────────────────
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
