// app/(tabs)/home/index.tsx
// Redesigned with Direction B — Cinematic Dusk aesthetic
// Dark bg · Georgia serif · gold accents · glass search · editorial grid

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { useActiveRegionId, useRegionConfig } from "../../../context/RegionContext";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ConciergeChat from "../../../components/ConciergeChat";
import SectionHeader from "../../../components/SectionHeader";
import { withScreenErrorBoundary } from "../../../components/ScreenErrorBoundary";
import { colors, fonts, radius, spacing, type, weights } from "../../../constants/theme";
import { db } from "../../../firebaseConfig";

// We can't reliably drive expo-image's <Image> via Animated.createAnimatedComponent
// — its native view doesn't forward the native-driver transform props, so
// translateY just gets dropped (the value updates but the image never moves).
// Instead, we wrap a plain <Image> in an Animated.View and animate the wrapper.

// ─── Static assets ────────────────────────────────────────────────────────────
const HERO_FALLBACK =
  "https://images.unsplash.com/photo-1734517648070-2e8d4ed686ac?q=80&w=1035&auto=format&fit=crop";

// ─── Hero parallax constants ──────────────────────────────────────────────────
const SCREEN_W = Dimensions.get("window").width;
const SCREEN_H = Dimensions.get("window").height;

// Rounded top corners on the content card that overlaps the hero image
const CARD_OVERLAP = 24;
const CARD_RADIUS  = 20;  // rounded top corners on the content card that lips over the hero

// Hero is sized so its *visible* portion (the part above the overlapping
// content card) is a dominant 75% of the screen. We add CARD_OVERLAP because
// the bottom CARD_OVERLAP points of the hero container sit underneath the
// rounded-corner card, so HERO_HEIGHT must be a bit taller than the target
// visible height.
const HERO_VISIBLE_RATIO = 1.0;
const HERO_HEIGHT = Math.round(SCREEN_H * HERO_VISIBLE_RATIO) + CARD_OVERLAP;
const PARALLAX_EXTRA = 100;       // extra px the image extends beyond the container
const PARALLAX_TRANSLATE = 10;    // max px the image translates as the hero scrolls away (very subtle)
const PARALLAX_TOP_BIAS = 100;    // how far above the hero container the image starts (shifts image up)


// ─── Types ────────────────────────────────────────────────────────────────────
type FeaturedWinery = {
  id: string;
  name: string;
  slug: string;
  featuredLabel: string;
  featuredTier: string;
  images?: string[];
  rating?: number;
  userRatingsTotal?: number;
};

interface FeaturedPour {
  issueLabel: string;
  kicker: string;
  headline: string;
  author: string;
  date: string;
  readTime: string;
  heroImage: string;
}

// Home-page Library rail entry. The thumbnail-* fields are the new, clearly
// labeled shape persisted in Firestore. Legacy fields (image/title/blurb/
// kicker/cadence) are still accepted as a fallback so a partial migration of
// the `explore_articles` collection doesn't break the rail.
type ArticleEntry = {
  key: string;
  thumbnailKicker: string;
  thumbnailTitle: string;
  thumbnailBlurb: string;
  thumbnailImage: string;
  thumbnailCadence: string;
  href?: string;              // tap target — undefined ⇒ shows "Coming soon"
  order: number;
};

// ─── Screen ───────────────────────────────────────────────────────────────────
function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const regionId = useActiveRegionId();
  const region = useRegionConfig();
  const [heroImageUrl, setHeroImageUrl] = useState<string>(HERO_FALLBACK);
  // Crop anchor for the cover-fit hero photo. Stored in Firestore so the
  // image can be re-positioned without an app store release. Defaults to
  // dead-center (matches expo-image's default contentPosition).
  const [heroImagePosition, setHeroImagePosition] = useState<{
    top: string;
    left: string;
  }>({ top: "70%", left: "50%" });
  // Extra zoom on top of `contentFit="cover"`. 1 = raw cover crop (default).
  // > 1 enlarges the image and crops more aggressively around the focal point.
  const [heroImageZoom, setHeroImageZoom] = useState<number>(1);
  const [featuredWinery, setFeaturedWinery] = useState<FeaturedWinery | null>(null);
  const [pour, setPour] = useState<FeaturedPour | null>(null);
  const [loadingPour, setLoadingPour] = useState(true);
  const [articles, setArticles] = useState<ArticleEntry[]>([]);
  // Concierge chat modal — opened by the floating FAB pinned bottom-right.
  // State lives on the home screen so the entry point and the modal stay
  // tightly coupled; the modal itself manages all chat state internally.
  const [chatOpen, setChatOpen] = useState(false);
  // A suggestion chip stuffs its prompt here and opens the chat; ConciergeChat
  // auto-sends it on open, then calls onPromptConsumed to clear it. Null when
  // the chat is opened via the bare search bar (no pre-filled prompt).
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  // Reopen-chat trigger. When the user taps a winery card inside the
  // concierge, navigates to the detail screen, and then taps "Chat"
  // back, the winery detail screen routes them here with
  // `?openConcierge=1`. We respond by re-showing the modal and
  // immediately clear the param so subsequent renders (or a fresh
  // visit to the home tab) don't pop the chat open again.
  const params = useLocalSearchParams<{ openConcierge?: string }>();
  useEffect(() => {
    if (params.openConcierge === "1") {
      setChatOpen(true);
      router.setParams({ openConcierge: undefined });
    }
  }, [params.openConcierge, router]);

  // Parallax scroll driver
  const scrollY = useRef(new Animated.Value(0)).current;
  // Ref to the scroll view so the scroll cue can drive a programmatic scroll.
  const scrollRef = useRef<ScrollView | null>(null);

  // Slide the editorial card section into view. Target = the top of the
  // rounded card overlay (hero height minus the lip it tucks under), so the
  // "This Month" / field-notes content lands at the top of the viewport.
  const handleScrollCuePress = () => {
    scrollRef.current?.scrollTo({
      y: HERO_HEIGHT - CARD_OVERLAP,
      animated: true,
    });
  };
  const heroImageTranslate = scrollY.interpolate({
    inputRange: [0, HERO_HEIGHT],
    outputRange: [0, -PARALLAX_TRANSLATE],
    extrapolate: "clamp",
  });

  // Scroll cue — a gently bouncing down-chevron near the bottom of the hero
  // that signals there's an editorial section below the fold. It fades out as
  // soon as the reader starts scrolling so it never lingers over content.
  const cueBounce = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(cueBounce, {
          toValue: 1,
          duration: 950,
          useNativeDriver: true,
        }),
        Animated.timing(cueBounce, {
          toValue: 0,
          duration: 950,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [cueBounce]);
  const cueTranslate = cueBounce.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 8],
  });
  const cueOpacity = scrollY.interpolate({
    inputRange: [0, 80],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  // Fetch hero image + its crop anchor (both live in config/homepage so they
  // can be tweaked from a script without shipping a new build).
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "config", "homepage"));
        if (!snap.exists()) return;
        const data = snap.data();
        if (data.heroImageUrl) {
          setHeroImageUrl(data.heroImageUrl as string);
        }
        // heroImagePositionX / heroImagePositionY are CSS-style strings
        // e.g. "50%" (center), "0%" (top/left edge), "100%" (bottom/right
        // edge). Falls back to center if either field is missing.
        const x = data.heroImagePositionX;
        const y = data.heroImagePositionY;
        if (typeof x === "string" || typeof y === "string") {
          setHeroImagePosition({
            top: typeof y === "string" ? y : "50%",
            left: typeof x === "string" ? x : "50%",
          });
        }
        // heroImageZoom is a numeric scale multiplier applied on top of
        // contentFit="cover" so we can crop tighter without pre-cropping
        // the source image. Clamp to a sane range (1× to 4×).
        const z = data.heroImageZoom;
        if (typeof z === "number" && Number.isFinite(z)) {
          setHeroImageZoom(Math.min(Math.max(z, 1), 4));
        }
      } catch {}
    })();
  }, []);

  // Fetch featured (hero-tier) winery
  useEffect(() => {
    (async () => {
      try {
        const q = query(
          collection(db, "wineries"),
          where("regionId", "==", regionId),
          where("featured", "==", true),
          where("featuredTier", "==", "hero")
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0];
          setFeaturedWinery({
            id: d.id,
            ...(d.data() as Omit<FeaturedWinery, "id">),
          });
        }
      } catch {}
    })();
  }, [regionId]);

  // Fetch explore_articles directory (relocated from the explore tab)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const q = query(
          collection(db, "explore_articles"),
          where("regionId", "==", regionId),
          orderBy("order", "asc")
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        setArticles(
          snap.docs
            .filter((d) => d.data().active !== false)
            .map((d) => {
              // Read clearly labeled `thumbnail*` fields first; fall back to
              // legacy `image / title / blurb / kicker / cadence` for docs
              // that haven't been re-seeded yet.
              const data = d.data();
              return {
                key: d.id,
                thumbnailImage:
                  data.thumbnailImage ?? data.image ?? "",
                thumbnailTitle:
                  data.thumbnailTitle ?? data.title ?? "",
                thumbnailBlurb:
                  data.thumbnailBlurb ?? data.blurb ?? "",
                thumbnailKicker:
                  data.thumbnailKicker ?? data.kicker ?? "",
                thumbnailCadence:
                  data.thumbnailCadence ?? data.cadence ?? "",
                href: data.href,
                order: data.order ?? 0,
              } as ArticleEntry;
            })
        );
      } catch {
        // Silently fail — article list stays empty.
      }
    })();

    return () => { cancelled = true; };
  }, [regionId]);

  // Fetch latest active Pour issue (relocated from the explore tab)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const q = query(
          collection(db, "pour_articles"),
          where("regionId", "==", regionId),
          orderBy("issueNumber", "desc"),
          limit(10)
        );
        const snap = await getDocs(q);
        if (cancelled || snap.empty) return;

        const active = snap.docs.find((d) => d.data().active !== false);
        if (active) {
          const d = active.data() as FeaturedPour;
          setPour({
            issueLabel: d.issueLabel,
            kicker:     d.kicker,
            headline:   d.headline,
            author:     d.author,
            date:       d.date,
            readTime:   d.readTime,
            heroImage:  d.heroImage,
          });
        }
      } catch {
        // Silently fail — featured card just won't render.
      } finally {
        if (!cancelled) setLoadingPour(false);
      }
    })();

    return () => { cancelled = true; };
  }, [regionId]);



  return (
    <View style={styles.screen}>
    <Animated.ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={Animated.event(
        [{ nativeEvent: { contentOffset: { y: scrollY } } }],
        { useNativeDriver: true }
      )}
    >
      {/* ── Daylight hero — image only, full saturation ───────────────────────── */}
      <View style={styles.hero}>
        {/* Hero image with subtle parallax — extended beyond the container so
            it never shows gaps as it translates upward on scroll. */}
        <Animated.View
          style={[
            {
              position: "absolute",
              left: 0,
              top: -PARALLAX_TOP_BIAS,
              width: SCREEN_W,
              height: HERO_HEIGHT + PARALLAX_TOP_BIAS + PARALLAX_TRANSLATE,
            },
            { transform: [{ translateY: heroImageTranslate }] },
          ]}
        >
          <Image
            source={{ uri: heroImageUrl }}
            style={{
              width: "100%",
              height: "100%",
              opacity: 0.96,
              transform: [{ scale: heroImageZoom }],
              transformOrigin: `${heroImagePosition.left} ${heroImagePosition.top}`,
            }}
            contentFit="cover"
            contentPosition={heroImagePosition}
            transition={200}
          />
        </Animated.View>

        {/* Dark gradient on the top edge of the hero — anchors the logo against
            light/bright photography. Sits above the image but below the UI. */}
        <LinearGradient
          colors={["rgba(0,0,0,0.68)", "rgba(0,0,0,0)"]}
          style={styles.heroTopGradient}
          pointerEvents="none"
        />

        {/* Dark gradient on the bottom edge of the hero — fades the photo into
            the editorial copy section below and adds contrast under the search
            bar when it sits near the bottom of bright imagery. */}
        <LinearGradient
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.78)"]}
          style={styles.heroBottomGradient}
          pointerEvents="none"
        />

        {/* Region title overlaid on the photo, top-left — the local-focus
            anchor in Bebas Neue (replaces the old SipLocal wordmark). */}
        <View style={[styles.heroHeader, { paddingTop: insets.top + spacing.xxxl * 2 }]} pointerEvents="none">
          <View style={styles.heroTitleWrap}>
            <Text style={styles.heroTitle}>{region.displayNameUpper}</Text>
            <View style={styles.heroTitleDivider} />
            <Text style={styles.heroSubtitle}>WELCOME TO WINE COUNTRY</Text>
          </View>
        </View>

        {/* ── Concierge entry — search bar anchored near the vertical center of
              the hero. Tapping it opens a chat with the sommelier. */}
        <View style={styles.searchSection}>
          <Pressable
            style={styles.searchBar}
            onPress={() => {
              setPendingPrompt(null);
              setChatOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Ask the ${region.regionAdjective ?? region.displayName} wine concierge`}
            accessibilityHint="Opens an in-app chat with the sommelier"
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={15}
              color={colors.textOnLightMuted}
              style={{ marginRight: 10 }}
            />
            <Text style={styles.searchPlaceholder} numberOfLines={1}>
              Ask me anything
            </Text>
            <View style={styles.searchBtn}>
              <Ionicons name="arrow-up" size={14} color={colors.onAccent} />
            </View>
          </Pressable>
        </View>

        {/* ── Scroll cue — bouncing chevron hinting at the editorial section
              below the fold. Fades out as soon as the reader scrolls.
              Tapping it slides the editorial card section into view. */}
        <Animated.View
          style={[styles.scrollCue, { opacity: cueOpacity }]}
          pointerEvents="box-none"
        >
          <Pressable
            style={styles.scrollCuePress}
            onPress={handleScrollCuePress}
            accessibilityRole="button"
            accessibilityLabel="Scroll down to this month's editorial section"
          >
            <Text style={styles.scrollCueLabel}>Discover</Text>
            <Animated.View
              style={[
                styles.scrollCueChevron,
                { transform: [{ translateY: cueTranslate }] },
              ]}
            >
              <Ionicons name="chevron-down" size={20} color={colors.textOnDark} />
            </Animated.View>
          </Pressable>
        </Animated.View>
      </View>

      {/* ── Rounded card overlay — softens the bottom of the hero photo
            with rounded top corners that lip over the image. */}
      <View style={styles.heroCopySection} />

      {/* ── Featured winery card ─────────────────────────────────────────────── */}
      {featuredWinery && (
        <View style={styles.section}>
          <SectionHeader eyebrow="Partner" title="Featured" />

          <Pressable
            onPress={() =>
              router.push(`/wineries/${featuredWinery.slug}?from=home` as any)
            }
            accessibilityRole="button"
            accessibilityLabel={`Open featured winery, ${featuredWinery.name}`}
          >
            {featuredWinery.images && featuredWinery.images.length > 0 && (
              <View style={styles.featImgWrap}>
                <Image
                  source={{ uri: featuredWinery.images[0] }}
                  style={styles.featImg}
                  contentFit="cover"
                  transition={150}
                />
                <LinearGradient
                  colors={["transparent", colors.photoOverlayMedium]}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            )}
            <View style={styles.featBody}>
              <Text style={styles.featRegion}>
                {region.displayNameUpper} · Estate
              </Text>
              <Text style={styles.featName}>{featuredWinery.name}</Text>
              {featuredWinery.rating != null && (
                <Text style={styles.featRating}>
                  {"★ "}
                  {featuredWinery.rating.toFixed(1)}
                  {featuredWinery.userRatingsTotal != null
                    ? `  ·  ${featuredWinery.userRatingsTotal.toLocaleString()} reviews`
                    : ""}
                </Text>
              )}
              <View style={styles.ctaRow}>
                <View style={styles.readBtn}>
                  <Text style={styles.readBtnText}>VISIT</Text>
                  <Ionicons name="arrow-forward" size={12} color={colors.onAccent} />
                </View>
              </View>
            </View>
          </Pressable>
        </View>
      )}

      {/* ── Featured: The Pour (live from Firestore) ──────────────────────────
          Relocated from the former Explore tab. Same layout & data source. */}
      <View style={styles.featuredSection}>
        <SectionHeader
          eyebrow="This month"
          title="June Field Notes"
          style={styles.sectionHeaderInset}
        />

        {loadingPour ? (
          <View style={styles.featuredLoading}>
            <ActivityIndicator color={colors.accentSoft} size="small" />
          </View>
        ) : pour ? (
          <Pressable
            style={styles.featuredCard}
            onPress={() => router.push("/(tabs)/home/pour" as any)}
            accessibilityRole="button"
            accessibilityLabel={`Read this week's Pour: ${pour.headline}`}
          >
            <View style={styles.featuredImg}>
              <Image
                source={{ uri: pour.heroImage }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                transition={150}
              />
              <LinearGradient
                colors={[
                  colors.photoOverlayTop,
                  "transparent",
                  colors.photoOverlayDeep,
                ]}
                locations={[0, 0.4, 1]}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.featuredOverlay}>
                <Text style={styles.featuredHeadline} numberOfLines={3}>
                  {pour.headline}
                </Text>
                <View style={styles.featuredMetaRow}>
                  <Text style={styles.featuredMeta}>
                    {pour.author} · {pour.readTime}
                  </Text>
                  <View style={styles.readBtn}>
                    <Text style={styles.readBtnText}>READ</Text>
                    <Ionicons name="arrow-forward" size={12} color={colors.onAccent} />
                  </View>
                </View>
              </View>
            </View>
          </Pressable>
        ) : (
          // Fallback card if Firestore is unreachable — still routes to reader
          <Pressable
            style={styles.featuredCard}
            onPress={() => router.push("/(tabs)/home/pour" as any)}
            accessibilityRole="button"
            accessibilityLabel="Read the latest issue of The Pour"
          >
            <View style={styles.featuredImg}>
              <Image
                source={{
                  uri: "https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=900&q=80",
                }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                transition={150}
              />
              <LinearGradient
                colors={[
                  colors.photoOverlayTop,
                  "transparent",
                  colors.photoOverlayDeep,
                ]}
                locations={[0, 0.4, 1]}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.featuredOverlay}>
                <Text style={styles.featuredHeadline}>
                  A weekly taste of local vineyards, vintages, and voices.
                </Text>
                <View style={styles.featuredMetaRow}>
                  <Text style={styles.featuredMeta}>Read the latest issue</Text>
                  <View style={styles.readBtn}>
                    <Text style={styles.readBtnText}>READ</Text>
                    <Ionicons name="arrow-forward" size={12} color={colors.onAccent} />
                  </View>
                </View>
              </View>
            </View>
          </Pressable>
        )}
      </View>

      {/* ── Article directory ──────────────────────────────────────────────
          Relocated from the former Explore tab. Same cards, same routes. */}
      <View style={styles.directorySection}>
        <SectionHeader
          eyebrow="Editorial"
          title="The Library"
          meta={
            articles.length > 0
              ? `${articles.length} ${articles.length === 1 ? "Story" : "Stories"}`
              : undefined
          }
          style={styles.sectionHeaderInset}
        />

        {articles.map((item) => (
          <Pressable
            key={item.key}
            style={({ pressed }) => [
              styles.articleCard,
              pressed && styles.articleCardPressed,
            ]}
            onPress={() => {
              if (item.href) {
                router.push(item.href as any);
              }
              // No-op for placeholders. Swap for navigation when each
              // article's detail screen / collection is ready.
            }}
            disabled={!item.href}
            accessibilityRole="button"
            accessibilityLabel={
              item.href
                ? `Read ${item.thumbnailTitle}`
                : `${item.thumbnailTitle}, coming soon`
            }
            accessibilityState={{ disabled: !item.href }}
          >
            <Image
              source={{ uri: item.thumbnailImage }}
              style={styles.articleCardImg}
              contentFit="cover"
              transition={150}
            />
            <View style={styles.articleCardBody}>
              <View style={styles.articleKickerRow}>
                <Text style={styles.articleKicker}>{item.thumbnailKicker}</Text>
                <Text style={styles.articleCadence}>· {item.thumbnailCadence}</Text>
              </View>
              <Text style={styles.articleTitle} numberOfLines={2}>
                {item.thumbnailTitle}
              </Text>
              {item.href ? (
                <Text style={styles.articleBlurb} numberOfLines={1}>
                  {item.thumbnailBlurb}
                </Text>
              ) : (
                <Text style={styles.comingSoon}>COMING SOON</Text>
              )}
            </View>
          </Pressable>
        ))}
      </View>
    </Animated.ScrollView>

      <ConciergeChat
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        initialPrompt={pendingPrompt}
        onPromptConsumed={() => setPendingPrompt(null)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Outer wrapper that hosts both the scroll view and the floating FAB so the
  // FAB can be absolutely positioned over the scrolling content without
  // joining the scroll itself.
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 120,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    height: HERO_HEIGHT,
    overflow: "hidden",                   // clip the parallax image
  },
  // Dark vignette at the top of the hero — gives the SipLocal logo a readable
  // backdrop against bright/light photography. Sized to cover roughly the top
  // quarter of the hero.
  heroTopGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: Math.round(HERO_HEIGHT * 0.28),
  },
  // Dark vignette at the bottom of the hero — softens the join with the
  // content card below and adds contrast under the search bar / lower edge.
  heroBottomGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: Math.round(HERO_HEIGHT * 0.32),
  },
  // Title block is absolutely centered over the full hero so "TASMANIA /
  // WINE COUNTRY" sits dead-center of the photo. pointerEvents="none" on the
  // wrapper lets taps fall through to the search bar beneath it.
  heroHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    // Anchored to the top of the hero photo (paddingTop set inline from the
    // safe-area inset so the title clears the notch/status bar), horizontally
    // centered.
    justifyContent: "flex-start",
    paddingHorizontal: spacing.xxl,
  },
  // Card overlay that floats over the bottom of the hero photo with rounded
  // top corners that lip over the image for a soft transition into content.
  heroCopySection: {
    backgroundColor: colors.background,
    borderTopLeftRadius: CARD_RADIUS,
    borderTopRightRadius: CARD_RADIUS,
    marginTop: -CARD_OVERLAP,
    height: CARD_OVERLAP + 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },

  // ── Search bar ──────────────────────────────────────────────────────────
  // The concierge entry (search bar) is anchored toward the vertical center of
  // the hero via `bottom`, scaling with hero height so it stays roughly
  // centered across every device size.
  searchSection: {
    position: "absolute",
    left: 0,
    right: 0,
    // Anchored a touch below the vertical center of the visible hero image
    // (~34% of the hero height from the bottom).
    bottom: Math.round(HERO_HEIGHT * 0.33),
    paddingHorizontal: spacing.xxl,           // standardised to 24
  },
  // Region name overlaid on the hero in Bebas Neue — the local-focus anchor.
  // A subtle text shadow keeps it legible over bright/light photography where
  // the hero gradients don't reach.
  heroTitleWrap: {
    alignItems: "center",
  },
  // Thin white rule between the region name and "WINE COUNTRY".
  heroTitleDivider: {
    width: 56,
    height: 1,
    backgroundColor: colors.textOnDark,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  heroTitle: {
    fontFamily: fonts.display,                // Bebas Neue
    fontSize: 76,
    lineHeight: 76,
    color: colors.textOnDark,
    letterSpacing: 2,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 12,
  },
  heroSubtitle: {
    fontFamily: fonts.sansBold,                // medium → bold for photo legibility
    fontSize: type.body.fontSize,
    letterSpacing: 5,
    color: colors.textOnDark,                  // ivory — matches the title above
    textAlign: "center",
    marginTop: spacing.xs,
    // Tight halo reads crisper on bright imagery than a wide blur.
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputSurfaceLight,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: type.body.fontSize,
    color: colors.textOnLightMuted,
  },
  searchBtn: {
    width: 36,                                 // bumped from 30 to 36
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Scroll cue ──────────────────────────────────────────────────────────
  // Centered at the bottom of the hero, just above the rounded card lip.
  scrollCue: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 125,
    alignItems: "center",
  },
  // Tappable inner wrapper — padded out to a comfortable hit target.
  scrollCuePress: {
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    minHeight: spacing.hitTarget,
    justifyContent: "center",
  },
  scrollCueLabel: {
    ...type.kicker,
    fontSize: 13,                              // 12 → 13 for legibility on photo
    fontWeight: weights.emphasis,
    letterSpacing: 3,
    color: colors.textOnDark,
    // Bare text on the photo — a tight, near-opaque shadow halo does the
    // legibility work without any chrome behind the word.
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scrollCueChevron: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.textOnDark,
    backgroundColor: colors.photoChrome,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Section header ────────────────────────────────────────────────────────
  section: {
    marginTop: spacing.hero,                  // 40 — new section rhythm (Fix 5)
    paddingHorizontal: spacing.xxl,           // standardised 20 → 24 (Fix 2)
  },
  // Inset for section headers in sections that aren't themselves padded
  // (The Pour, The Library) so the header aligns with their cards.
  sectionHeaderInset: {
    paddingHorizontal: spacing.xxl,
  },

  // ── Featured winery ───────────────────────────────────────────────────────
  featImgWrap: {
    height: 200,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: "hidden",
  },
  featImg: {
    width: "100%",
    height: "100%",
  },
  featBody: {
    padding: spacing.xl,                      // card body padding standardised to 20 (Fix 3)
    backgroundColor: colors.surface,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  featRegion: {
    ...type.kicker,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.textMuted,
  },
  featName: {
    ...type.h2,                               // 28 / bold / Georgia
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  featRating: {
    ...type.caption,
    color: colors.accentSoft,
    fontWeight: weights.emphasis,
    marginTop: spacing.sm,
  },
  ctaRow: {
    flexDirection: "row",
    marginTop: spacing.lg,
  },

  // ── Featured (The Pour) — relocated from the explore tab ────────────────
  featuredSection: {
    marginTop: spacing.hero,                  // 40 — section rhythm
  },
  featuredLoading: {
    height: 280,
    marginHorizontal: spacing.xxl,            // 24
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  featuredCard: {
    marginHorizontal: spacing.xxl,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  featuredImg: {
    height: 320,
    justifyContent: "flex-end",
  },
  featuredOverlay: {
    paddingHorizontal: spacing.xl,            // 20
    paddingBottom: spacing.xl,
  },
  featuredIssue: {
    ...type.kicker,
    letterSpacing: 2,
    color: colors.accentSoft,
    marginBottom: spacing.md,
  },
  featuredHeadline: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: colors.textOnDark,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  featuredMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  featuredMeta: {
    ...type.kicker,
    letterSpacing: 1.4,
    color: colors.textOnDarkSubtle,
    flex: 1,
  },
  readBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  readBtnText: {
    ...type.kicker,
    letterSpacing: 1.8,
    fontWeight: weights.emphasis,
    color: colors.onAccent,
  },

  // ── Article directory — relocated from the explore tab ─────────────────
  directorySection: {
    marginTop: spacing.hero,                  // 40
  },
  articleCard: {
    flexDirection: "row",                     // thumbnail left · text right
    alignItems: "stretch",
    height: 112,
    marginHorizontal: spacing.xxl,            // 24 — matches featured card
    marginBottom: spacing.xl,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.surfaceElevated,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 4,
  },
  articleCardPressed: {
    opacity: 0.92,
  },
  articleCardImg: {
    width: 104,                               // compact thumbnail, full card height
    height: "100%",
    backgroundColor: colors.surfaceDeep,
  },
  articleCardBody: {
    flex: 1,
    paddingHorizontal: spacing.lg,            // 16
    paddingVertical: spacing.md,              // 12
    justifyContent: "center",
  },
  articleKickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  articleKicker: {
    ...type.kicker,
    fontSize: 12,
    letterSpacing: 1.8,
    color: colors.accentSoft,
  },
  articleCadence: {
    ...type.kicker,
    letterSpacing: 1.4,
    color: colors.textMuted,
  },
  articleTitle: {
    fontFamily: fonts.serif,
    fontSize: type.lede.fontSize,             // 17 — fits the compact row card
    fontWeight: weights.emphasis,
    color: colors.textPrimary,
    lineHeight: 22,
    letterSpacing: -0.3,
    marginBottom: spacing.xs,
  },
  articleBlurb: {
    ...type.caption,                          // 12 / 16
    color: colors.textSecondary,
    lineHeight: 18,
  },
  articleFooter: {
    marginTop: spacing.md,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  comingSoon: {
    ...type.kicker,
    letterSpacing: 1.6,
    color: colors.textMuted,
  },
});

export default withScreenErrorBoundary(HomeScreen, "home/index");
