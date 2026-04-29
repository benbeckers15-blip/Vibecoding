// app/(tabs)/wineries/[slug].tsx
// Redesigned with Direction B — Cinematic Dusk aesthetic
// Dark bg · glass header · gold accents · dark info grid · dark modal

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import React, { useEffect, useState } from "react";
import SkeletonBox from "../../../components/SkeletonBox";
import {
  Dimensions,
  ImageBackground,
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import Carousel from "react-native-reanimated-carousel";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REGION_NAME, REGION_NAME_UPPER } from "../../../constants/region";
import { colors, fonts } from "../../../constants/theme";
import { useAuth } from "../../../context/AuthContext";
import { db } from "../../../firebaseConfig";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function safeOpenURL(url: string) {
  const trimmed = url.trim();
  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  Linking.openURL(withProtocol).catch(() =>
    console.warn("Could not open URL:", withProtocol)
  );
}

const { width } = Dimensions.get("window");
const HERO_HEIGHT = 400;
const PARALLAX_EXTRA = 80;

// ─── Types ────────────────────────────────────────────────────────────────────
interface HoursEntry {
  day: string;
  time: string;
}

interface WineryData {
  name: string;
  images: string[];
  description: string[];
  pullQuote?: string;
  phone: string;
  website: string;
  hours: HoursEntry[];
  byAppointmentOnly?: boolean;
  dogFriendly?: boolean;
  hasRestaurant?: boolean;
  isOrganic?: boolean;
  isBiodynamic?: boolean;
  rating?: number;
  userRatingsTotal?: number;
}

const FEATURE_BADGES: { key: keyof WineryData; label: string; icon: string }[] = [
  { key: "dogFriendly",   label: "Dog Friendly", icon: "🐕" },
  { key: "hasRestaurant", label: "Restaurant",   icon: "🍽"  },
  { key: "isOrganic",     label: "Organic",      icon: "🌿"  },
  { key: "isBiodynamic",  label: "Biodynamic",   icon: "🌱"  },
];

function normaliseHours(raw: unknown): HoursEntry[] {
  if (Array.isArray(raw) && raw.length > 0) return raw as HoursEntry[];
  if (typeof raw === "string" && raw.trim())
    return [{ day: "Hours", time: raw.trim() }];
  return [{ day: "Hours", time: "N/A" }];
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function WineryDetailsScreen() {
  const { slug, from } = useLocalSearchParams<{ slug: string; from?: string }>();
  const backLabel =
    from === "events"   ? "‹ Events"   :
    from === "wineries" ? "‹ Wineries" :
    from === "home"     ? "‹ Home"     : "‹ Back";

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [winery, setWinery] = useState<WineryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hoursVisible, setHoursVisible] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  // Parallax scroll tracking
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });
  const heroParallaxStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [0, HERO_HEIGHT],
          [0, -PARALLAX_EXTRA],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const docRef = doc(db, "wineries", slug);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setWinery({
            name:            data.name || "Unnamed Winery",
            images:          Array.isArray(data.images) ? data.images : [],
            description:     Array.isArray(data.description)
                               ? data.description
                               : [String(data.description || "")],
            pullQuote:       data.pullQuote || undefined,
            phone:           (data.phone || "N/A").trim(),
            website:         (data.website || "").trim(),
            hours:           normaliseHours(data.hoursStructured ?? data.hours),
            byAppointmentOnly: !!data.byAppointmentOnly,
            dogFriendly:     !!data.dogFriendly,
            hasRestaurant:   !!data.hasRestaurant,
            isOrganic:       !!data.isOrganic,
            isBiodynamic:    !!data.isBiodynamic,
            rating:          typeof data.rating === "number" ? data.rating : undefined,
            userRatingsTotal: typeof data.userRatingsTotal === "number"
                               ? data.userRatingsTotal : undefined,
          });
        } else {
          console.warn("No such winery found!");
        }
      } catch (error) {
        console.error("Error fetching winery:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  // ── Check whether this winery is already saved ────────────────────────────
  useEffect(() => {
    if (!user || !slug) return;
    const savedRef = doc(db, "users", user.uid, "savedWineries", slug);
    getDoc(savedRef).then((snap) => setIsSaved(snap.exists()));
  }, [user, slug]);

  // ── Toggle save / unsave ──────────────────────────────────────────────────
  async function toggleSave() {
    if (!user || !slug || !winery || saveLoading) return;
    setSaveLoading(true);
    try {
      const savedRef = doc(db, "users", user.uid, "savedWineries", slug);
      if (isSaved) {
        await deleteDoc(savedRef);
        setIsSaved(false);
      } else {
        await setDoc(savedRef, {
          name:      winery.name,
          region:    REGION_NAME,
          rating:    winery.rating ?? 0,
          distance:  "",
          image:     winery.images[0] ?? "",
          savedAt:   serverTimestamp(),
        });
        setIsSaved(true);
      }
    } catch (e) {
      console.warn("toggleSave error:", e);
    } finally {
      setSaveLoading(false);
    }
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.container}>
        <SkeletonBox
          style={{ height: HERO_HEIGHT, borderRadius: 0, backgroundColor: colors.surfaceDeep }}
        />
        <View style={skeletonStyles.infoGrid}>
          <View style={skeletonStyles.infoCell}>
            <SkeletonBox style={[skeletonStyles.labelLine, { backgroundColor: colors.surfaceDeep }]} />
            <SkeletonBox style={[skeletonStyles.valueLine, { backgroundColor: colors.surfaceDeep }]} />
            <SkeletonBox style={[skeletonStyles.subLine,   { backgroundColor: colors.surfaceDeep }]} />
          </View>
          <View style={[skeletonStyles.infoCell, skeletonStyles.infoCellBorderLeft]}>
            <SkeletonBox style={[skeletonStyles.labelLine, { backgroundColor: colors.surfaceDeep }]} />
            <SkeletonBox style={[skeletonStyles.valueLine, { backgroundColor: colors.surfaceDeep }]} />
          </View>
        </View>
        <View style={skeletonStyles.contactRow}>
          <View style={skeletonStyles.infoCell}>
            <SkeletonBox style={[skeletonStyles.labelLine, { backgroundColor: colors.surfaceDeep }]} />
            <SkeletonBox style={[skeletonStyles.valueLine, { width: "60%", backgroundColor: colors.surfaceDeep }]} />
          </View>
          <View style={[skeletonStyles.infoCell, skeletonStyles.infoCellBorderLeft]}>
            <SkeletonBox style={[skeletonStyles.labelLine, { backgroundColor: colors.surfaceDeep }]} />
            <SkeletonBox style={[skeletonStyles.valueLine, { width: "70%", backgroundColor: colors.surfaceDeep }]} />
          </View>
        </View>
        <View style={skeletonStyles.aboutSection}>
          <View style={skeletonStyles.dividerSkeleton}>
            <View style={skeletonStyles.dividerLine} />
            <SkeletonBox style={[skeletonStyles.dividerLabel, { backgroundColor: colors.surfaceDeep }]} />
            <View style={skeletonStyles.dividerLine} />
          </View>
          <SkeletonBox style={[skeletonStyles.textLineLg, { backgroundColor: colors.surfaceDeep }]} />
          <SkeletonBox style={[skeletonStyles.textLineLg, { backgroundColor: colors.surfaceDeep }]} />
          <SkeletonBox style={[skeletonStyles.textLineLg, { width: "75%", backgroundColor: colors.surfaceDeep }]} />
          <SkeletonBox style={{ height: 12, marginTop: 20, backgroundColor: colors.surfaceDeep }} />
          <SkeletonBox style={[skeletonStyles.textLineSm, { backgroundColor: colors.surfaceDeep }]} />
          <SkeletonBox style={[skeletonStyles.textLineSm, { backgroundColor: colors.surfaceDeep }]} />
          <SkeletonBox style={[skeletonStyles.textLineSm, { width: "60%", backgroundColor: colors.surfaceDeep }]} />
        </View>
      </View>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (!winery) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFoundLabel}>WINERY NOT FOUND</Text>
        <Text style={styles.notFoundText}>This winery could not be loaded.</Text>
      </View>
    );
  }

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out ${winery.name} — a winery in ${REGION_NAME}!`,
        url: winery.website || "",
      });
    } catch (e) {
      console.warn("Share failed:", e);
    }
  };

  return (
    <>
      <Animated.ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* ── Hero Carousel ─────────────────────────────────────────────────── */}
        <View style={styles.heroContainer}>

          {/* Glass header buttons */}
          <View style={[styles.headerOverlay, { top: insets.top + 10 }]}>
            <Pressable style={styles.headerBtn} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={16} color={colors.textOnDark} />
              <Text style={styles.headerBtnText}>{backLabel}</Text>
            </Pressable>
            <View style={styles.headerRight}>
              <Pressable
                style={styles.headerIconBtn}
                onPress={toggleSave}
                disabled={saveLoading}
                accessibilityRole="button"
                accessibilityLabel={isSaved ? "Unsave winery" : "Save winery"}
              >
                <Ionicons
                  name={isSaved ? "heart" : "heart-outline"}
                  size={16}
                  color={isSaved ? colors.accentSoft : colors.textOnDark}
                />
              </Pressable>
              <Pressable style={styles.headerIconBtn} onPress={handleShare}>
                <Ionicons name="share-outline" size={16} color={colors.textOnDark} />
              </Pressable>
            </View>
          </View>

          {/* Images */}
          {winery.images.length > 0 ? (
            <Carousel
              width={width}
              height={HERO_HEIGHT}
              data={winery.images}
              loop={winery.images.length > 1}
              autoPlay={winery.images.length > 1}
              autoPlayInterval={4000}
              scrollAnimationDuration={800}
              onSnapToItem={(index) => setCurrentIndex(index)}
              mode="parallax"
              modeConfig={{
                parallaxScrollingScale: 0.9,
                parallaxScrollingOffset: 50,
              }}
              renderItem={({ item }) => (
                <View style={styles.heroCardFrame}>
                  <Animated.View style={heroParallaxStyle}>
                    <ImageBackground
                      source={{ uri: String(item) }}
                      style={styles.heroImage}
                    >
                      {/* Gradient fades to dark bg so content below blends */}
                      {/* Dark scrim deepens toward the bottom so the title
                          overlay reads cleanly on any photo. The page below
                          (paper) begins right at the photo's edge. */}
                      <LinearGradient
                        colors={[
                          "transparent",
                          colors.photoOverlaySoft,
                          colors.photoOverlayStrong,
                        ]}
                        locations={[0, 0.5, 1]}
                        style={styles.heroGradient}
                      />
                    </ImageBackground>
                  </Animated.View>
                </View>
              )}
            />
          ) : (
            <Animated.View style={[styles.heroPlaceholder, heroParallaxStyle]}>
              <Text style={styles.heroPlaceholderEmoji}>🍷</Text>
              <Text style={styles.heroPlaceholderName}>{winery.name}</Text>
            </Animated.View>
          )}

          {/* Winery name + region overlaid on hero */}
          <View style={styles.heroContent}>
            <Text style={styles.heroRegion}>
              {REGION_NAME_UPPER} · Estate
            </Text>
            <Text style={styles.heroTitle}>{winery.name}</Text>
            {winery.rating != null && (
              <View style={styles.heroRatingRow}>
                <Text style={styles.heroRatingStar}>
                  ★ {winery.rating.toFixed(1)}
                </Text>
                {winery.userRatingsTotal != null && (
                  <Text style={styles.heroRatingCount}>
                    ({winery.userRatingsTotal.toLocaleString()})
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Pagination dashes */}
          {winery.images.length > 1 && (
            <View style={styles.dotsContainer}>
              {winery.images.map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i === currentIndex && styles.dotActive]}
                />
              ))}
            </View>
          )}
        </View>

        {/* ── Info Grid — Hours | Location ──────────────────────────────────── */}
        <View style={styles.infoGrid}>
          {/* Hours cell */}
          {winery.byAppointmentOnly ? (
            <Pressable
              style={styles.infoCell}
              onPress={() => winery.website ? safeOpenURL(winery.website) : undefined}
            >
              <Text style={styles.infoCellLabel}>HOURS</Text>
              <View style={styles.valueRow}>
                <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                <Text style={styles.appointmentLink}>By Appointment Only</Text>
              </View>
              {winery.website ? (
                <Text style={styles.infoCellTap}>Book via website ›</Text>
              ) : null}
            </Pressable>
          ) : (
            <Pressable
              style={styles.infoCell}
              onPress={() => setHoursVisible(true)}
            >
              <Text style={styles.infoCellLabel}>HOURS</Text>
              <View style={styles.valueRow}>
                <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                <Text style={styles.infoCellValue}>
                  {winery.hours[0]?.time ?? "N/A"}
                </Text>
              </View>
              <Text style={styles.infoCellTap}>See all hours ›</Text>
            </Pressable>
          )}

          {/* Location cell */}
          <View style={[styles.infoCell, styles.infoCellBorderLeft]}>
            <Text style={styles.infoCellLabel}>LOCATION</Text>
            <View style={styles.valueRow}>
              <Ionicons name="location-outline" size={14} color={colors.textMuted} />
              <Text style={styles.infoCellValue}>{REGION_NAME}</Text>
            </View>
          </View>
        </View>

        {/* ── Contact Row — Call | Website ──────────────────────────────────── */}
        <View style={styles.contactRow}>
          {winery.phone !== "N/A" && (
            <Pressable
              style={styles.contactBtn}
              onPress={() =>
                Linking.openURL(
                  `tel:${winery.phone.replace(/\s/g, "")}`
                ).catch(() => console.warn("Could not open phone link"))
              }
            >
              <Text style={styles.contactLabel}>CALL</Text>
              <View style={styles.valueRow}>
                <Ionicons name="call-outline" size={14} color={colors.textMuted} />
                <Text style={styles.contactValue}>{winery.phone}</Text>
              </View>
            </Pressable>
          )}

          {winery.website ? (
            <Pressable
              style={[
                styles.contactBtn,
                winery.phone !== "N/A" && styles.contactBtnBorderLeft,
              ]}
              onPress={() => safeOpenURL(winery.website)}
            >
              <Text style={styles.contactLabel}>WEBSITE</Text>
              <View style={styles.valueRow}>
                <Ionicons name="globe-outline" size={14} color={colors.textMuted} />
                <Text style={styles.contactLink} numberOfLines={1}>
                  {winery.website
                    .replace(/^https?:\/\//, "")
                    .replace(/^www\./, "")
                    .replace(/\/.*$/, "")}
                </Text>
              </View>
            </Pressable>
          ) : null}
        </View>

        {/* ── Feature Badges ────────────────────────────────────────────────── */}
        {FEATURE_BADGES.some(({ key }) => winery[key]) && (
          <View style={styles.badgesRow}>
            {FEATURE_BADGES.filter(({ key }) => winery[key]).map(
              ({ key, label, icon }) => (
                <View key={key} style={styles.badge}>
                  <Text style={styles.badgeIcon}>{icon}</Text>
                  <Text style={styles.badgeText}>{label}</Text>
                </View>
              )
            )}
          </View>
        )}

        {/* ── About Section ─────────────────────────────────────────────────── */}
        <View style={styles.aboutSection}>

          {/* Section header */}
          <View style={styles.aboutHeader}>
            <View style={styles.goldLine} />
            <Text style={styles.aboutLabel}>ABOUT</Text>
          </View>

          {/* Paragraphs */}
          {winery.description.map((para, idx) => (
            <React.Fragment key={idx}>
              <Text
                style={idx === 0 ? styles.ledeParagraph : styles.paragraph}
              >
                {"  "}
                {para}
              </Text>

              {/* Pull quote after first paragraph */}
              {idx === 0 && winery.pullQuote ? (
                <View style={styles.pullQuoteBlock}>
                  <View style={styles.pullQuoteBar} />
                  <Text style={styles.pullQuoteText}>{winery.pullQuote}</Text>
                </View>
              ) : null}
            </React.Fragment>
          ))}
        </View>
      </Animated.ScrollView>

      {/* ── Hours Modal ───────────────────────────────────────────────────────── */}
      <Modal
        visible={hoursVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHoursVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setHoursVisible(false)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>OPENING HOURS</Text>

            {winery.hours.map((entry, i) => (
              <View
                key={i}
                style={[
                  styles.hoursRow,
                  i < winery.hours.length - 1 && styles.hoursRowBorder,
                ]}
              >
                <Text style={styles.hoursDay}>{entry.day}</Text>
                <Text style={styles.hoursTime}>{entry.time}</Text>
              </View>
            ))}

            <Pressable
              style={styles.modalClose}
              onPress={() => setHoursVisible(false)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    paddingBottom: 120,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
    gap: 10,
  },
  notFoundLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 3,
    color: colors.textMuted,
    marginBottom: 8,
  },
  notFoundText: {
    fontSize: 14,
    color: colors.textMuted,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  headerOverlay: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 10,
  },
  // Header buttons sit ON TOP of the hero photo, so they use dark glass
  // chrome regardless of the page bg — keeps icons + text legible on any image.
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.photoChrome,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  headerBtnText: {
    color: colors.textOnDark,
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.2,
  },
  headerRight: {
    flexDirection: "row",
    gap: 8,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.photoChrome,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  heroContainer: {
    position: "relative",
    height: HERO_HEIGHT,
  },
  heroCardFrame: {
    height: HERO_HEIGHT,
    borderRadius: 0,
    overflow: "hidden",
  },
  heroImage: {
    width,
    height: HERO_HEIGHT + PARALLAX_EXTRA,
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroPlaceholder: {
    height: HERO_HEIGHT + PARALLAX_EXTRA,
    backgroundColor: colors.surface,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  heroPlaceholderEmoji: {
    fontSize: 48,
  },
  heroPlaceholderName: {
    fontFamily: "Georgia",
    fontSize: 22,
    fontStyle: "italic",
    color: colors.textSecondary,
  },
  heroContent: {
    position: "absolute",
    bottom: 28,
    left: 24,
    right: 24,
  },
  heroRegion: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.accentSoft,
    marginBottom: 8,
  },
  // Hero text sits over the photo's dark scrim — uses on-dark tokens.
  heroTitle: {
    fontFamily: "Georgia",
    fontSize: 34,
    fontStyle: "italic",
    fontWeight: "400",
    color: colors.textOnDark,
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  heroRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  heroRatingStar: {
    fontSize: 13,
    color: colors.accentSoft,
    fontWeight: "600",
  },
  heroRatingCount: {
    fontSize: 12,
    color: colors.textOnDarkSubtle,
  },

  // Pagination dashes — also overlaid on hero photo
  dotsContainer: {
    position: "absolute",
    bottom: 14,
    right: 20,
    flexDirection: "row",
    gap: 4,
  },
  dot: {
    width: 16,
    height: 2,
    backgroundColor: colors.textOnDarkSubtle,
    borderRadius: 1,
  },
  dotActive: {
    width: 24,
    backgroundColor: colors.accent,
  },

  // ── Info Grid ─────────────────────────────────────────────────────────────
  infoGrid: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  infoCell: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  infoCellBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  infoCellLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2.5,
    color: colors.textMuted,
    marginBottom: 7,
  },
  infoCellValue: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "500",
  },
  appointmentLink: {
    fontSize: 13,
    color: colors.accentSoft,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  infoCellTap: {
    fontSize: 11,
    color: colors.accentSoft,
    marginTop: 6,
    letterSpacing: 0.2,
  },

  // ── Contact Row ───────────────────────────────────────────────────────────
  contactRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  contactBtn: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  contactBtnBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  contactLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2.5,
    color: colors.textMuted,
    marginBottom: 6,
  },
  contactValue: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "500",
  },
  contactLink: {
    fontSize: 13,
    color: colors.accentSoft,
    fontWeight: "500",
    textDecorationLine: "underline",
  },

  // ── Feature Badges ────────────────────────────────────────────────────────
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  badgeIcon: {
    fontSize: 13,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "500",
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },

  // ── About Section ─────────────────────────────────────────────────────────
  aboutSection: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
  },
  aboutHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 28,
  },
  goldLine: {
    width: 24,
    height: 1,
    backgroundColor: colors.accent,
  },
  aboutLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 3,
    color: colors.accentSoft,
  },
  // First paragraph — editorial lede (italic, slightly larger)
  ledeParagraph: {
    fontFamily: "Georgia",
    fontSize: 17,
    fontStyle: "italic",
    color: colors.textSecondary,
    lineHeight: 29,
    marginBottom: 22,
  },
  // Body paragraphs
  paragraph: {
    fontFamily: "Georgia",
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 27,
    marginBottom: 18,
  },
  // Pull quote
  pullQuoteBlock: {
    flexDirection: "row",
    alignItems: "stretch",
    marginVertical: 24,
    marginHorizontal: 4,
  },
  pullQuoteBar: {
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
    marginRight: 18,
  },
  pullQuoteText: {
    flex: 1,
    fontFamily: "Georgia",
    fontSize: 20,
    fontStyle: "italic",
    color: colors.textPrimary,
    lineHeight: 32,
    letterSpacing: 0.2,
  },

  // ── Hours Modal ───────────────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 24,
  },
  modalTitle: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 3,
    color: colors.accentSoft,
    marginBottom: 20,
  },
  hoursRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
  },
  hoursRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hoursDay: {
    fontFamily: "Georgia",
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  hoursTime: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "500",
    textAlign: "right",
  },
  modalClose: {
    marginTop: 24,
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
  },
  modalCloseText: {
    fontSize: 12,
    letterSpacing: 1,
    color: colors.textMuted,
  },
});

// ─── Skeleton styles ──────────────────────────────────────────────────────────
const skeletonStyles = StyleSheet.create({
  infoGrid: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  infoCell: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 24,
    gap: 8,
  },
  infoCellBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  contactRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  labelLine:  { height: 8,  width: "40%", borderRadius: 4 },
  valueLine:  { height: 13, width: "80%", borderRadius: 4 },
  subLine:    { height: 9,  width: "50%", borderRadius: 4 },
  textLineLg: { height: 14, borderRadius: 4 },
  textLineSm: { height: 12, borderRadius: 4 },
  aboutSection: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
    gap: 14,
  },
  dividerSkeleton: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerLabel: { height: 8, width: 48, borderRadius: 4 },
});
