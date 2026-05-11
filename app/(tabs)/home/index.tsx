// app/(tabs)/home/index.tsx
// Redesigned with Direction B — Cinematic Dusk aesthetic
// Dark bg · Georgia serif · gold accents · glass search · editorial grid

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
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
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REGION_NAME, REGION_NAME_UPPER } from "../../../constants/region";
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
const HERO_HEIGHT = 440;          // taller than the original 340
const PARALLAX_EXTRA = 100;       // extra px the image extends beyond the container (50 each side)
const PARALLAX_TRANSLATE = 60;    // max px the image translates as the hero scrolls away


// ─── Editorial tiles ──────────────────────────────────────────────────────────
const EXPLORE_TILES: {
  key: string;
  label: string;
  headline: string;
  image: string;
}[] = [
  {
    key:      "hasRestaurant",
    label:    "DINING",
    headline: "Best for\nLunch",
    image:    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&q=80",
  },
  {
    key:      "dogFriendly",
    label:    "OUTDOORS",
    headline: "Dog-Friendly\nEstates",
    image:    "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=400&q=80",
  },
  {
    key:      "walkinWelcome",
    label:    "CASUAL",
    headline: "Walk In,\nNo Booking",
    image:    "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=400&q=80",
  },
  {
    key:      "isOrganic",
    label:    "SUSTAINABLE",
    headline: "Organic\nProducers",
    image:    "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=400&q=80",
  },
  {
    key:      "isBiodynamic",
    label:    "NATURAL",
    headline: "Biodynamic\nWines",
    image:    "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=400&q=80",
  },
];

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

type ArticleEntry = {
  key: string;
  kicker: string;
  title: string;
  blurb: string;
  image: string;
  cadence: string;            // e.g. "Weekly", "Monthly", "Series"
  href?: string;              // tap target — undefined ⇒ shows "Coming soon"
  order: number;
};

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState<string>(HERO_FALLBACK);
  // Crop anchor for the cover-fit hero photo. Stored in Firestore so the
  // image can be re-positioned without an app store release. Defaults to
  // dead-center (matches expo-image's default contentPosition).
  const [heroImagePosition, setHeroImagePosition] = useState<{
    top: string;
    left: string;
  }>({ top: "50%", left: "50%" });
  // Extra zoom on top of `contentFit="cover"`. 1 = raw cover crop (default).
  // > 1 enlarges the image and crops more aggressively around the focal point.
  const [heroImageZoom, setHeroImageZoom] = useState<number>(1);
  const [featuredWinery, setFeaturedWinery] = useState<FeaturedWinery | null>(null);
  const [wineryCount, setWineryCount] = useState<number>(0);
  const [pour, setPour] = useState<FeaturedPour | null>(null);
  const [loadingPour, setLoadingPour] = useState(true);
  const [articles, setArticles] = useState<ArticleEntry[]>([]);

  // Parallax scroll driver
  const scrollY = useRef(new Animated.Value(0)).current;
  const heroImageTranslate = scrollY.interpolate({
    inputRange: [0, HERO_HEIGHT],
    outputRange: [0, -PARALLAX_TRANSLATE],
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
  }, []);

  // Fetch total winery count for hero kicker
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "wineries"));
        setWineryCount(snap.size);
      } catch {}
    })();
  }, []);

  // Fetch explore_articles directory (relocated from the explore tab)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const q = query(
          collection(db, "explore_articles"),
          orderBy("order", "asc")
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        setArticles(
          snap.docs
            .filter((d) => d.data().active !== false)
            .map((d) => ({ key: d.id, ...(d.data() as Omit<ArticleEntry, "key">) }))
        );
      } catch {
        // Silently fail — article list stays empty.
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Fetch latest active Pour issue (relocated from the explore tab)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const q = query(
          collection(db, "pour_articles"),
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
  }, []);

  const handleSearchSubmit = () => {
    const trimmed = search.trim();
    const t = Date.now();
    router.push(
      (trimmed
        ? `/wineries?search=${encodeURIComponent(trimmed)}&t=${t}`
        : `/wineries?t=${t}`) as any
    );
  };


  return (
    <Animated.ScrollView
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
        {/* Hero image with subtle parallax — image extends beyond the container
            so it never shows gaps as it translates upward on scroll.
            The transform lives on the Animated.View wrapper because
            expo-image's <Image> doesn't pick up native-driven transforms. */}
        <Animated.View
          style={[
            {
              position: "absolute",
              left: 0,
              right: 0,
              top: -(PARALLAX_EXTRA / 2),
              height: HERO_HEIGHT + PARALLAX_EXTRA,
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
              // Extra zoom on top of `cover`. transformOrigin is pinned to
              // the focal point so increasing zoom keeps the same area
              // visible — it just crops more tightly around it.
              transform: [{ scale: heroImageZoom }],
              transformOrigin: `${heroImagePosition.left} ${heroImagePosition.top}`,
            }}
            contentFit="cover"
            contentPosition={heroImagePosition}
            transition={200}
          />
        </Animated.View>
        {/* Brand header overlaid on photo */}
        <View style={[styles.heroHeader, { paddingTop: insets.top + 10 }]}>
          <Text style={styles.logo}>
            Sip<Text style={styles.logoAccent}>Local</Text>
          </Text>
        </View>
      </View>

      {/* ── Hero editorial copy — on warm paper below the image ──────────────── */}
      <View style={styles.heroCopySection}>
        <Text style={[styles.heroKicker, { textAlign: "right" }]}>
          Issue No. 1
        </Text>
        <Text style={styles.heroHeadline}>
          {"Tasmania,\nby the glass."}
        </Text>
      </View>

      {/* ── Search + filter chips ─────────────────────────────────────────────── */}
      <View style={styles.searchSection}>
        {/* Glass search pill */}
        <View style={styles.searchBar}>
          <Ionicons
            name="search"
            size={15}
            color={colors.textSecondary}
            style={{ marginRight: 10 }}
          />
          <TextInput
            style={styles.searchInput}
            placeholder={`Search ${REGION_NAME}…`}
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={handleSearchSubmit}
          />
          <Pressable onPress={handleSearchSubmit} style={styles.searchBtn}>
            <Ionicons name="options-outline" size={14} color={colors.onAccent} />
          </Pressable>
        </View>

      </View>

      {/* ── Featured winery card ─────────────────────────────────────────────── */}
      {featuredWinery && (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View style={styles.goldLine} />
            <Text style={styles.sectionKicker}>
              {(featuredWinery.featuredLabel ?? "FEATURED").toUpperCase()} · PARTNER
            </Text>
          </View>

          <Pressable
            onPress={() =>
              router.push(`/wineries/${featuredWinery.slug}?from=home` as any)
            }
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
                {REGION_NAME_UPPER} · Estate
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
              <Text style={styles.featCta}>Visit cellar door →</Text>
            </View>
          </Pressable>
        </View>
      )}

      {/* ── Editorial tiles — Explore by ─────────────────────────────────────── */}
      <View style={[styles.section, { paddingHorizontal: 0 }]}>
        <View style={[styles.sectionHead, { paddingHorizontal: 20 }]}>
          <View style={styles.goldLine} />
          <Text style={styles.sectionKicker}>EXPLORE BY</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tilesRow}
        >
          {EXPLORE_TILES.map((tile) => (
            <Pressable
              key={tile.key}
              style={styles.tile}
              onPress={() =>
                router.push(
                  `/home/articles/collections/${tile.key}` as any
                )
              }
            >
              <Image
                source={{ uri: tile.image }}
                style={styles.tileImg}
                contentFit="cover"
                transition={150}
              />
              {/* Double-stop scrim: top + bottom darkened so kicker AND headline
                  remain legible regardless of the photo's exposure. */}
              <LinearGradient
                colors={[
                  colors.photoOverlayTop,
                  "transparent",
                  colors.photoOverlayBottom,
                ]}
                locations={[0, 0.4, 1]}
                style={[StyleSheet.absoluteFill, { borderRadius: radius.card }]}
              />
              <View style={styles.tileOverlay}>
                <Text style={styles.tileKicker}>{tile.label}</Text>
                <Text style={styles.tileTitle}>{tile.headline}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* ── Featured: The Pour (live from Firestore) ──────────────────────────
          Relocated from the former Explore tab. Same layout & data source. */}
      <View style={styles.featuredSection}>
        <View style={styles.sectionHead}>
          <View style={styles.goldLine} />
          <Text style={styles.sectionKicker}>THIS WEEK</Text>
        </View>

        {loadingPour ? (
          <View style={styles.featuredLoading}>
            <ActivityIndicator color={colors.accentSoft} size="small" />
          </View>
        ) : pour ? (
          <Pressable
            style={styles.featuredCard}
            onPress={() => router.push("/(tabs)/home/pour" as any)}
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
                <Text style={styles.featuredIssue}>
                  {pour.issueLabel} · {pour.kicker}
                </Text>
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
                <Text style={styles.featuredIssue}>THE POUR · WEEKLY</Text>
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
        <View style={styles.sectionHead}>
          <View style={styles.goldLine} />
          <Text style={styles.sectionKicker}>THE LIBRARY</Text>
        </View>

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
          >
            <Image source={{ uri: item.image }} style={styles.articleCardImg} contentFit="cover" transition={150} />
            <View style={styles.articleCardBody}>
              <View style={styles.articleKickerRow}>
                <Text style={styles.articleKicker}>{item.kicker}</Text>
                <Text style={styles.articleCadence}>· {item.cadence}</Text>
              </View>
              <Text style={styles.articleTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.articleBlurb} numberOfLines={2}>
                {item.blurb}
              </Text>
              <View style={styles.articleFooter}>
                {item.href ? (
                  <View style={styles.readMore}>
                    <Text style={styles.readMoreText}>READ</Text>
                    <Ionicons
                      name="arrow-forward"
                      size={11}
                      color={colors.accent}
                    />
                  </View>
                ) : (
                  <Text style={styles.comingSoon}>COMING SOON</Text>
                )}
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </Animated.ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 120,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    height: HERO_HEIGHT,        // taller hero; copy stays below
    overflow: "hidden",         // clip the parallax image extension
  },
  heroHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xxl,
  },
  logo: {
    fontFamily: fonts.display,          // Bebas Neue — tall condensed brand mark
    fontSize: 28,                       // bumped slightly — Bebas reads smaller per-pt
    color: colors.textOnDark,           // hardcoded light — overlaid on photograph
    letterSpacing: 1.2,                 // wide tracking suits Bebas's narrow letterforms
  },
  logoAccent: {
    fontFamily: fonts.display,          // keep the same family so the wordmark reads as one
    color: colors.accentSoft,
  },
  // Editorial copy section — sits on the dark slate page below the photo.
  // Pulled up over the hero with rounded top corners so the page surface reads
  // as a card overlaid on the photograph (rather than a hard horizontal seam).
  heroCopySection: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -15,                          // overlap the hero image
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.sm,
  },
  heroKicker: {
    ...type.kicker,
    color: colors.accent,
  },
  heroHeadline: {
    ...type.display,                          // 54 / 58 / 1.5 / Bebas Neue
    color: colors.textPrimary,                // soft off-white on dark slate — pops confidently
    marginTop: spacing.md,
  },

  // ── Search + chips ────────────────────────────────────────────────────────
  searchSection: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xxl,           // standardised to 24
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputSurface,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    minHeight: spacing.hitTarget,             // 44pt — Apple HIG
  },
  searchInput: {
    flex: 1,
    fontSize: type.body.fontSize,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchBtn: {
    width: 36,                                 // bumped from 30 to 36
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Section header ────────────────────────────────────────────────────────
  section: {
    marginTop: spacing.hero,                  // 40 — new section rhythm (Fix 5)
    paddingHorizontal: spacing.xxl,           // standardised 20 → 24 (Fix 2)
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  goldLine: {
    width: 24,
    height: 1,
    backgroundColor: colors.accent,
  },
  sectionKicker: {
    ...type.kicker,
    color: colors.accentSoft,
  },

  // ── Featured winery ───────────────────────────────────────────────────────
  featImgWrap: {
    height: 200,
    borderRadius: radius.card,
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
  featCta: {
    ...type.caption,
    color: colors.accentSoft,
    fontWeight: weights.emphasis,
    marginTop: spacing.md,
  },

  // ── Editorial tiles ───────────────────────────────────────────────────────
  tilesRow: {
    paddingHorizontal: spacing.xxl,           // standardised to 24
    gap: spacing.md,                           // bumped 10 → 12
  },
  tile: {
    width: 140,
    height: 200,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  tileImg: {
    width: "100%",
    height: "100%",
  },
  tileOverlay: {
    position: "absolute",
    bottom: spacing.md,
    left: spacing.md,
    right: spacing.md,
  },
  tileKicker: {
    ...type.kicker,                           // bumped from 9pt → 10pt (kicker minimum)
    color: colors.accentSoft,
    marginBottom: spacing.xs,
  },
  tileTitle: {
    fontFamily: fonts.serif,
    fontSize: type.lede.fontSize,             // 17pt
    color: colors.textOnDark,
    lineHeight: 22,
  },

  // ── Explore cards ─────────────────────────────────────────────────────────
  exploreCards: {
    gap: spacing.md,
  },
  exploreCard: {
    borderRadius: radius.card,
    overflow: "hidden",
  },
  exploreSmall: {
    flex: 1,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  smallRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  exploreCardBg: {
    height: 150,
  },
  cardGrad: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.xl,            // card body padding 20 (Fix 3)
    paddingBottom: spacing.xl,
    paddingTop: 50,
  },
  cardKicker: {
    ...type.kicker,                           // bumped 9 → 10
    color: colors.textOnDarkSubtle,
    marginBottom: spacing.xs,
  },
  cardTitle: {
    ...type.h3,                               // 22 / bold / Georgia
    color: colors.textOnDark,
    marginBottom: spacing.xs,
  },
  cardBody: {
    ...type.caption,                          // 12 / 16
    color: colors.textOnDarkMuted,
  },
  smallCardTitle: {
    fontFamily: fonts.serif,
    fontSize: type.lede.fontSize,             // 17pt
    fontWeight: weights.emphasis,
    color: colors.textOnDark,
    lineHeight: 22,
  },

  // ── Featured (The Pour) — relocated from the explore tab ────────────────
  featuredSection: {
    marginTop: spacing.hero,                  // 40 — section rhythm
  },
  featuredLoading: {
    height: 280,
    marginHorizontal: spacing.xxl,            // 24
    borderRadius: 6,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  featuredCard: {
    marginHorizontal: spacing.xxl,
    borderRadius: 6,
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
    fontStyle: "italic",
    fontWeight: weights.body,
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
    paddingVertical: 11,
    borderRadius: radius.pill,
    minHeight: spacing.hitTarget,
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
    marginHorizontal: spacing.xxl,            // 24 — matches featured card
    marginBottom: spacing.md,
    borderRadius: radius.cardLg,
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
    width: "100%",
    height: 150,
    backgroundColor: colors.surfaceDeep,
  },
  articleCardBody: {
    padding: spacing.xl,                      // 20
  },
  articleKickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  articleKicker: {
    ...type.kicker,
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
    fontSize: type.lede.fontSize,             // 17
    fontWeight: weights.emphasis,
    color: colors.textPrimary,
    lineHeight: 23,
    letterSpacing: -0.2,
    marginBottom: spacing.sm,
  },
  articleBlurb: {
    ...type.caption,                          // 12 / 16
    color: colors.textSecondary,
    lineHeight: 18,
  },
  articleFooter: {
    marginTop: spacing.md,
  },
  readMore: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  readMoreText: {
    ...type.kicker,
    letterSpacing: 1.8,
    fontWeight: weights.emphasis,
    color: colors.accent,
  },
  comingSoon: {
    ...type.kicker,
    letterSpacing: 1.6,
    color: colors.textMuted,
  },
});
