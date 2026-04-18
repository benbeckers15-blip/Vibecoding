import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
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
import { db } from "../../../firebaseConfig";

function safeOpenURL(url: string) {
  const trimmed = url.trim();
  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  Linking.openURL(withProtocol).catch(() => {
    console.warn("Could not open URL:", withProtocol);
  });
}

const { width } = Dimensions.get("window");
const HERO_HEIGHT = 380;
const PARALLAX_EXTRA = 80; // extra image height that stays hidden, giving the parallax room to travel

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
  dogFriendly?: boolean;
  hasRestaurant?: boolean;
  isOrganic?: boolean;
  isBiodynamic?: boolean;
}

const FEATURE_BADGES: { key: keyof WineryData; label: string; icon: string }[] = [
  { key: "dogFriendly",   label: "Dog Friendly", icon: "🐕" },
  { key: "hasRestaurant", label: "Restaurant",   icon: "🍽" },
  { key: "isOrganic",     label: "Organic",      icon: "🌿" },
  { key: "isBiodynamic",  label: "Biodynamic",   icon: "🌱" },
];

/** Normalises the hours field from Firestore.
 *  Accepts either the new hoursStructured array or the old hours string. */
function normaliseHours(raw: unknown): HoursEntry[] {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw as HoursEntry[];
  }
  if (typeof raw === "string" && raw.trim()) {
    // Fallback: treat the whole string as a single entry
    return [{ day: "Hours", time: raw.trim() }];
  }
  return [{ day: "Hours", time: "N/A" }];
}

export default function WineryDetailsScreen() {
  const { slug, from } = useLocalSearchParams<{ slug: string; from?: string }>();
  const backLabel =
    from === "events"   ? "‹ Events"   :
    from === "wineries" ? "‹ Wineries" :
    from === "home"     ? "‹ Home"     : "‹ Back";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [winery, setWinery] = useState<WineryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hoursVisible, setHoursVisible] = useState(false);

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

    const fetchWinery = async () => {
      try {
        const docRef = doc(db, "wineries", slug);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setWinery({
            name: data.name || "Unnamed Winery",
            images: Array.isArray(data.images) ? data.images : [],
            description: Array.isArray(data.description)
              ? data.description
              : [String(data.description || "")],
            pullQuote: data.pullQuote || undefined,
            phone: (data.phone || "N/A").trim(),
            website: (data.website || "").trim(),
            // Prefer the new structured field; fall back to the legacy string
            hours: normaliseHours(data.hoursStructured ?? data.hours),
            dogFriendly:   !!data.dogFriendly,
            hasRestaurant: !!data.hasRestaurant,
            isOrganic:     !!data.isOrganic,
            isBiodynamic:  !!data.isBiodynamic,
          });
        } else {
          console.warn("No such winery found!");
        }
      } catch (error) {
        console.error("Error fetching winery:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchWinery();
  }, [slug]);

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Hero skeleton */}
        <SkeletonBox style={{ height: HERO_HEIGHT, borderRadius: 0 }} />

        {/* Info grid skeleton */}
        <View style={skeletonStyles.infoGrid}>
          <View style={skeletonStyles.infoCell}>
            <SkeletonBox style={skeletonStyles.labelLine} />
            <SkeletonBox style={skeletonStyles.valueLine} />
            <SkeletonBox style={skeletonStyles.subLine} />
          </View>
          <View style={[skeletonStyles.infoCell, skeletonStyles.infoCellBorderLeft]}>
            <SkeletonBox style={skeletonStyles.labelLine} />
            <SkeletonBox style={skeletonStyles.valueLine} />
          </View>
        </View>

        {/* Contact row skeleton */}
        <View style={skeletonStyles.contactRow}>
          <View style={skeletonStyles.infoCell}>
            <SkeletonBox style={skeletonStyles.labelLine} />
            <SkeletonBox style={[skeletonStyles.valueLine, { width: "60%" }]} />
          </View>
          <View style={[skeletonStyles.infoCell, skeletonStyles.infoCellBorderLeft]}>
            <SkeletonBox style={skeletonStyles.labelLine} />
            <SkeletonBox style={[skeletonStyles.valueLine, { width: "70%" }]} />
          </View>
        </View>

        {/* About section skeleton */}
        <View style={skeletonStyles.aboutSection}>
          <View style={skeletonStyles.dividerSkeleton}>
            <View style={skeletonStyles.dividerLine} />
            <SkeletonBox style={skeletonStyles.dividerLabel} />
            <View style={skeletonStyles.dividerLine} />
          </View>
          <SkeletonBox style={skeletonStyles.textLineLg} />
          <SkeletonBox style={skeletonStyles.textLineLg} />
          <SkeletonBox style={[skeletonStyles.textLineLg, { width: "75%" }]} />
          <SkeletonBox style={{ height: 12, marginTop: 20 }} />
          <SkeletonBox style={skeletonStyles.textLineSm} />
          <SkeletonBox style={skeletonStyles.textLineSm} />
          <SkeletonBox style={[skeletonStyles.textLineSm, { width: "60%" }]} />
        </View>
      </View>
    );
  }

  if (!winery) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFoundLabel}>WINERY NOT FOUND</Text>
        <Text style={styles.notFoundText}>
          This winery could not be loaded.
        </Text>
      </View>
    );
  }

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out ${winery.name} — a winery in Margaret River!`,
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
        {/* Hero Carousel */}
        <View style={styles.heroContainer}>

          {/* Custom header overlay */}
          <View style={[styles.headerOverlay, { top: insets.top + 10 }]}>
            <Pressable style={styles.headerBtn} onPress={() => router.back()}>
              <Text style={styles.headerBtnText}>{backLabel}</Text>
            </Pressable>
            <Pressable style={styles.headerBtn} onPress={handleShare}>
              <Text style={styles.headerBtnText}>⬆ Share</Text>
            </Pressable>
          </View>
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
                // Fixed rounded card frame — only the image inside pans
                <View style={styles.heroCardFrame}>
                  <Animated.View style={heroParallaxStyle}>
                    <ImageBackground
                      source={{ uri: String(item) }}
                      style={styles.heroImage}
                    >
                      <LinearGradient
                        colors={["transparent", "rgba(0,0,0,0.75)"]}
                        locations={[0.3, HERO_HEIGHT / (HERO_HEIGHT + PARALLAX_EXTRA)]}
                        style={styles.heroGradient}
                      />
                    </ImageBackground>
                  </Animated.View>
                </View>
              )}
            />
          ) : (
            <Animated.View style={[styles.heroPlaceholder, heroParallaxStyle]}>
              <Text style={styles.heroPlaceholderText}>🍷</Text>
              <Text style={styles.heroPlaceholderName}>{winery.name}</Text>
            </Animated.View>
          )}

          {/* Winery title — fixed, does not move with parallax image */}
          <View style={styles.heroContent}>
            <Text style={styles.heroRegion}>MARGARET RIVER</Text>
            <Text style={styles.heroTitle}>{winery.name}</Text>
          </View>

          {/* Pagination dashes */}
          {winery.images.length > 1 && (
            <View style={styles.dotsContainer}>
              {winery.images.map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.dot,
                    currentIndex === index && styles.activeDot,
                  ]}
                />
              ))}
            </View>
          )}
        </View>

        {/* Info Grid */}
        <View style={styles.infoGrid}>

          {/* Hours cell — tappable, opens modal */}
          <Pressable style={styles.infoCell} onPress={() => setHoursVisible(true)}>
            <Text style={styles.infoCellLabel}>HOURS</Text>
            <Text style={styles.infoCellValue}>
              {winery.hours[0]?.time ?? "N/A"}
            </Text>
            <Text style={styles.infoCellTap}>See all hours ›</Text>
          </Pressable>

          <View style={[styles.infoCell, styles.infoCellBorderLeft]}>
            <Text style={styles.infoCellLabel}>LOCATION</Text>
            <Text style={styles.infoCellValue}>Margaret River</Text>
          </View>
        </View>

        {/* Contact Buttons */}
        <View style={styles.contactRow}>
          {winery.phone !== "N/A" && (
            <Pressable
              style={styles.contactButton}
              onPress={() =>
                Linking.openURL(`tel:${winery.phone.replace(/\s/g, "")}`).catch(
                  () => console.warn("Could not open phone link")
                )
              }
            >
              <Text style={styles.contactButtonText}>CALL</Text>
              <Text style={styles.contactButtonSub}>{winery.phone}</Text>
            </Pressable>
          )}

          {winery.website ? (
            <Pressable
              style={[
                styles.contactButton,
                winery.phone !== "N/A" && styles.contactButtonBorderLeft,
              ]}
              onPress={() => safeOpenURL(winery.website)}
            >
              <Text style={styles.contactButtonText}>WEBSITE</Text>
              <Text style={styles.contactButtonLink} numberOfLines={1}>
                {winery.website.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Feature Badges — only shown if true in Firestore */}
        {FEATURE_BADGES.some(({ key }) => winery[key]) && (
          <View style={styles.badgesRow}>
            {FEATURE_BADGES.filter(({ key }) => winery[key]).map(({ key, label, icon }) => (
              <View key={key} style={styles.badge}>
                <Text style={styles.badgeIcon}>{icon}</Text>
                <Text style={styles.badgeText}>{label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* About Section */}
        <View style={styles.aboutSection}>

          {/* Section header */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>ABOUT</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Paragraphs — first is styled as editorial lede */}
          {winery.description.map((para, idx) => (
            <React.Fragment key={idx}>
              <Text style={idx === 0 ? styles.ledeParagraph : styles.paragraph}>
                {'\u2003\u2003'}{para}
              </Text>
              {/* Pull quote injected after the first paragraph */}
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

      {/* Hours Modal */}
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
          {/* Inner view stops tap-through closing when tapping the sheet itself */}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#faf9f6",
  },
  contentContainer: {
    paddingBottom: 120,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#faf9f6",
    gap: 10,
  },
  loadingText: {
    fontSize: 11,
    letterSpacing: 2,
    color: "#999",
  },
  notFoundLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#ccc",
    marginBottom: 8,
  },
  notFoundText: {
    fontSize: 14,
    color: "#999",
  },

  // Custom header overlay
  headerOverlay: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 10,
  },
  headerBtn: {
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  headerBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },

  // Hero
  heroContainer: {
    position: "relative",
    height: HERO_HEIGHT,
  },
  // Per-card rounded frame — clips the panning image, all 4 corners always visible
  heroCardFrame: {
    height: HERO_HEIGHT,
    borderRadius: 16,
    overflow: "hidden",
  },
  heroImage: {
    width: width,
    height: HERO_HEIGHT + PARALLAX_EXTRA,
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroContent: {
    position: "absolute",
    bottom: 32,
    left: 24,
    right: 24,
  },
  heroRegion: {
    fontSize: 9,
    letterSpacing: 3,
    color: "rgba(255,255,255,0.7)",
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: "700",
    fontFamily: "Georgia",
    color: "#fff",
    lineHeight: 38,
  },
  heroPlaceholder: {
    height: HERO_HEIGHT + PARALLAX_EXTRA,
    backgroundColor: "#f5f5f0",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  heroPlaceholderText: {
    fontSize: 48,
  },
  heroPlaceholderName: {
    fontSize: 24,
    fontFamily: "Georgia",
    color: "#1a1a1a",
  },

  // Pagination
  dotsContainer: {
    position: "absolute",
    bottom: 16,
    right: 20,
    flexDirection: "row",
    gap: 4,
  },
  dot: {
    width: 16,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.4)",
    borderRadius: 1,
  },
  activeDot: {
    width: 24,
    backgroundColor: "#fff",
  },

  // Info Grid
  infoGrid: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderTopWidth: 1,
    borderColor: "#e0e0e0",
  },
  infoCell: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  infoCellBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: "#e0e0e0",
  },
  infoCellLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    marginBottom: 6,
  },
  infoCellValue: {
    fontSize: 13,
    color: "#1a1a1a",
    fontWeight: "500",
  },
  infoCellTap: {
    fontSize: 10,
    color: "#940c0c",
    marginTop: 5,
    letterSpacing: 0.2,
  },

  // Contact
  contactRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#e0e0e0",
  },
  contactButton: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  contactButtonBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: "#e0e0e0",
  },
  contactButtonText: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    marginBottom: 4,
  },
  contactButtonSub: {
    fontSize: 13,
    color: "#1a1a1a",
    fontWeight: "500",
  },
  contactButtonLink: {
    fontSize: 13,
    color: "#940c0c",
    fontWeight: "500",
    textDecorationLine: "underline",
  },

  // Feature badges
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeIcon: {
    fontSize: 13,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#1a1a1a",
    letterSpacing: 0.3,
  },

  // About
  aboutSection: {
    backgroundColor: "#faf9f6",
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
    marginTop: 2,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 28,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e0e0e0",
  },
  dividerLabel: {
    fontSize: 9,
    letterSpacing: 4,
    color: "#940c0c",
    marginHorizontal: 14,
    fontWeight: "600",
  },
  // First paragraph — larger, italic lede style
  ledeParagraph: {
    fontSize: 17,
    color: "#2a2a2a",
    lineHeight: 29,
    marginBottom: 22,
    fontFamily: "Georgia",
    fontStyle: "italic",
  },
  // Body paragraphs
  paragraph: {
    fontSize: 15,
    color: "#444",
    lineHeight: 27,
    marginBottom: 18,
    fontFamily: "Georgia",
  },
  // Pull quote block
  pullQuoteBlock: {
    flexDirection: "row",
    alignItems: "stretch",
    marginVertical: 24,
    marginHorizontal: 4,
  },
  pullQuoteBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: "#940c0c",
    marginRight: 18,
  },
  pullQuoteText: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Georgia",
    fontStyle: "italic",
    color: "#1a1a1a",
    lineHeight: 32,
    letterSpacing: 0.2,
  },

  // Hours Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: "#e0e0e0",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 9,
    letterSpacing: 4,
    color: "#940c0c",
    fontWeight: "600",
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
    borderBottomColor: "#f0f0f0",
  },
  hoursDay: {
    fontSize: 14,
    color: "#555",
    fontFamily: "Georgia",
    flex: 1,
  },
  hoursTime: {
    fontSize: 14,
    color: "#1a1a1a",
    fontWeight: "500",
    textAlign: "right",
  },
  modalClose: {
    marginTop: 24,
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 999,
  },
  modalCloseText: {
    fontSize: 12,
    letterSpacing: 1,
    color: "#555",
  },
});

const skeletonStyles = StyleSheet.create({
  infoGrid: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderTopWidth: 1,
    borderColor: "#e0e0e0",
  },
  infoCell: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 24,
    gap: 8,
  },
  infoCellBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: "#e0e0e0",
  },
  contactRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#e0e0e0",
  },
  labelLine: {
    height: 8,
    width: "40%",
    borderRadius: 4,
  },
  valueLine: {
    height: 13,
    width: "80%",
    borderRadius: 4,
  },
  subLine: {
    height: 9,
    width: "50%",
    borderRadius: 4,
  },
  aboutSection: {
    backgroundColor: "#faf9f6",
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
    marginTop: 2,
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
    backgroundColor: "#e0e0e0",
  },
  dividerLabel: {
    height: 8,
    width: 48,
    borderRadius: 4,
  },
  textLineLg: {
    height: 14,
    borderRadius: 4,
  },
  textLineSm: {
    height: 12,
    borderRadius: 4,
  },
});
