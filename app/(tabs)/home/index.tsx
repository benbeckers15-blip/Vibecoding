// app/(tabs)/home/index.tsx
// Cinematic Dusk aesthetic — dark bg · serif headlines · forest/lime accents.
//
// Two-part home experience:
//   1. HomeCover — a full-screen opening "primer" (photo + region title +
//      centered concierge bar) that the reader slides open like a magazine
//      cover. While it's up the floating tab bar is hidden (see CoverContext).
//   2. This content page — revealed once the cover flips away: a concierge
//      search bar pinned at the top, then June Field Notes, the Featured
//      winery, and The Library.

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ConciergeChat from "../../../components/ConciergeChat";
import HomeCover from "../../../components/HomeCover";
import SectionHeader from "../../../components/SectionHeader";
import { withScreenErrorBoundary } from "../../../components/ScreenErrorBoundary";
import { colors, fonts, radius, spacing, type, weights } from "../../../constants/theme";
import { useActiveRegionId, useRegionConfig } from "../../../context/RegionContext";
import { useCover } from "../../../context/CoverContext";
import { db } from "../../../firebaseConfig";

// Corner geometry for the photo/card seam. The dark content card laps up over
// the bottom of the hero photo by CARD_OVERLAP, and each side gets a matching
// rounded treatment:
//   • RIGHT: the card's rounded top-right corner (CARD_RADIUS_BIG) opens a
//     pocket where the photo (square corner) runs down beside it.
//   • LEFT: the dark card sweeps UP over the photo's bottom-left as a concave
//     ("inverted") corner of radius SWEEP_RADIUS, so the photo reads as tucked
//     under the card. A plain border-radius can only make a *convex* corner, so
//     the concave sweep is painted with a small SVG <Path> overlay (see hero).
const HERO_HEIGHT = 430;
const CARD_RADIUS_BIG = 72;    // card's rounded top-right corner (right pocket) — larger
                               //   curve so the photo sliver runs further down the right edge.
const SWEEP_RADIUS = 72;       // bottom-left concave sweep — dark card over photo
                               //   (matched to CARD_RADIUS_BIG so both corners curve equally)
const CARD_OVERLAP = 72;       // how far the card laps up over the photo — matched to
                               //   CARD_RADIUS_BIG so the right pocket is filled with photo
                               //   (visible sliver length = min(radius, overlap)).

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

  // Opening cover (primer) state — lives in CoverContext so the tab layout can
  // hide the floating nav bar while the cover is showing.
  const { coverVisible, dismissCover } = useCover();

  const [featuredWinery, setFeaturedWinery] = useState<FeaturedWinery | null>(null);
  const [pour, setPour] = useState<FeaturedPour | null>(null);
  const [loadingPour, setLoadingPour] = useState(true);
  const [articles, setArticles] = useState<ArticleEntry[]>([]);

  // Concierge chat modal — opened from either the cover's centered search bar
  // or the content page's top search bar. State lives here so both entry
  // points and the modal stay coupled; the modal manages all chat state.
  const [chatOpen, setChatOpen] = useState(false);
  // A suggestion chip stuffs its prompt here and opens the chat; ConciergeChat
  // auto-sends it on open, then calls onPromptConsumed to clear it. Null when
  // the chat is opened via the bare search bar (no pre-filled prompt).
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  const openConcierge = () => {
    setPendingPrompt(null);
    setChatOpen(true);
  };

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

  // Fetch featured (hero-tier) winery
  useEffect(() => {
    (async () => {
      try {
        const q = query(
          collection(db, "wineries"),
          where("regionId", "==", regionId),
          where("featured", "==", true)
        );
        const snap = await getDocs(q);
        if (snap.empty) return;

        const candidates = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<FeaturedWinery, "id">),
        }));
        const hasImages = (w: FeaturedWinery) =>
          Array.isArray(w.images) && w.images.length > 0;

        // Prefer a hero-tier winery that has a photo; otherwise the first
        // featured winery with a photo; otherwise just the first featured one.
        const chosen =
          candidates.find((w) => w.featuredTier === "hero" && hasImages(w)) ??
          candidates.find(hasImages) ??
          candidates[0];

        setFeaturedWinery(chosen);
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

  // Hero photo = the featured (hero-tier) winery's first image. When present
  // it leads the page; the concierge bar and the rest sit below it.
  const heroImageUri =
    featuredWinery?.images && featuredWinery.images.length > 0
      ? featuredWinery.images[0]
      : undefined;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Brand header — lime pin + SIPLOCAL wordmark, sitting against the
              page background ABOVE the hero photo (not overlaid on it) ─────── */}
        <View
          style={[styles.brandHeader, { paddingTop: insets.top + spacing.md }]}
        >
          <Image
            source={require("../../../assets/images/logo-pin.png")}
            style={styles.brandLogo}
            contentFit="contain"
          />
          <Text style={styles.brandTitle}>SIPLOCAL</Text>
        </View>

        {/* ── Hero — the featured winery's photo, rounded top corners ───────── */}
        {heroImageUri && featuredWinery && (
          <Pressable
            style={styles.hero}
            onPress={() =>
              router.push(`/wineries/${featuredWinery.slug}?from=home` as any)
            }
            accessibilityRole="button"
            accessibilityLabel={`Open featured winery, ${featuredWinery.name}`}
          >
            <Image
              source={{ uri: heroImageUri }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              transition={200}
            />
            <LinearGradient
              colors={["rgba(0,0,0,0.32)", "transparent", "rgba(0,0,0,0.34)"]}
              locations={[0, 0.5, 1]}
              style={StyleSheet.absoluteFill}
            />

            {/* Bottom-left concave sweep: paints the dark card colour up over
                the photo's bottom-left corner (radius SWEEP_RADIUS). Sits just
                above the lapping card's flat top edge so the two read as one
                continuous dark sweep. The card colour fills the region under a
                convex arc, so the photo above keeps a rounded bottom-left.
                Rendered before heroBottom so the title/rating stay on top. */}
            <Svg
              width={SWEEP_RADIUS}
              height={SWEEP_RADIUS}
              pointerEvents="none"
              style={styles.heroSweep}
            >
              <Path
                d={`M0 0 A${SWEEP_RADIUS} ${SWEEP_RADIUS} 0 0 0 ${SWEEP_RADIUS} ${SWEEP_RADIUS} L0 ${SWEEP_RADIUS} Z`}
                fill={colors.background}
              />
            </Svg>

            <View style={styles.heroBottom}>
              {/* Location tag — glassy pill w/ pin icon, reads as a photo geotag */}
              <View style={styles.heroLocationTag}>
                <Ionicons
                  name="location-sharp"
                  size={13}
                  color={colors.accentSoft}
                />
                <Text style={styles.heroLocationText} numberOfLines={1}>
                  {featuredWinery.name}
                </Text>
              </View>
            </View>
          </Pressable>
        )}

        {/* ── Content card — laps up over the bottom of the hero with rounded
              top corners and a soft shadow (the overlapping card-over-photo
              treatment). When no hero loads, it's just a flat dark panel. ──── */}
        <View
          style={[styles.contentCard, heroImageUri ? styles.contentCardOverlap : null]}
        >
        {/* ── Concierge search ──────────────────────────────────────────────── */}
        <View
          style={[
            styles.topBar,
            { paddingTop: heroImageUri ? 0 : insets.top + spacing.lg },
          ]}
        >
          <Pressable
            style={styles.searchBar}
            onPress={openConcierge}
            accessibilityRole="button"
            accessibilityLabel={`Ask the ${
              region.regionAdjective ?? region.displayName
            } wine concierge`}
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
        </View>
      </ScrollView>

      {/* ── Opening cover (primer) — sits on top until slid open ──────────────── */}
      {coverVisible && <HomeCover onOpened={dismissCover} />}

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

  // ── Content card (laps over the hero, nested rounded corners) ───────────
  contentCard: {
    backgroundColor: colors.background,
  },
  // Lap the card up over the bottom of the hero. Left top corner rounds
  // normally; right top corner rounds more, opening a pocket where the photo
  // runs down the right edge. Soft upward shadow for depth.
  contentCardOverlap: {
    marginTop: -CARD_OVERLAP,
    borderTopLeftRadius: 0,                 // left curve is the photo's own rounded bottom-left
    borderTopRightRadius: CARD_RADIUS_BIG,  // rounds in on the right → photo runs down beside it
    // Pull the concierge search bar up toward the top of the card overlay.
    // (Was CARD_OVERLAP - spacing.sm ≈ 64px.)
    paddingTop: spacing.xxl + spacing.sm,
    // Soft upward lift for the card-over-photo pocket. Kept low-opacity so the
    // black halo doesn't darken the heroSweep above the card's top edge — on
    // the lighter background a stronger shadow makes the sweep read as a
    // slightly darker shade than the card it's meant to blend into.
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 16,
  },

  // ── Brand header (lime pin + SIPLOCAL wordmark) — against page background ─
  brandHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: colors.background,
  },
  brandLogo: {
    width: 18,
    height: 24,                                // 0.75 aspect of logo-pin.png
  },
  brandTitle: {
    fontFamily: fonts.display,                 // Bebas Neue — condensed brand wordmark
    fontSize: 26,
    color: colors.textPrimary,                 // sits on the dark page bg now, not a photo
    letterSpacing: 2,
    marginTop: 2,                              // optically centers Bebas against the pin
  },

  // ── Hero (featured winery photo) ────────────────────────────────────────
  hero: {
    width: "100%",
    height: HERO_HEIGHT,
    backgroundColor: colors.surfaceDeep,
    justifyContent: "flex-end",
    // Top corners rounded — the photo now sits below the brand header against
    // the page background, so it reads as a card. Both bottom corners stay
    // square: the RIGHT pocket comes from the card's rounded top-right corner,
    // and the LEFT concave sweep is painted by the heroSweep <Svg> below.
    // overflow:hidden keeps the photo within the frame.
    borderTopLeftRadius: radius.cardLg,
    borderTopRightRadius: radius.cardLg,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    overflow: "hidden",
  },
  // Concave bottom-left sweep, sitting flush on top of the lapping card's flat
  // top edge (CARD_OVERLAP up from the photo's bottom).
  heroSweep: {
    position: "absolute",
    left: 0,
    bottom: CARD_OVERLAP,
  },
  heroBottom: {
    paddingHorizontal: spacing.xxl,
    // Sit above the card that laps over the bottom of the photo.
    paddingBottom: CARD_OVERLAP + spacing.lg,
  },
  // Location tag — small glassy pill (pin + name) that reads as a photo geotag.
  heroLocationTag: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.photoChrome,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    borderRadius: radius.pill,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    paddingVertical: 6,
  },
  heroLocationText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 0.2,
    color: colors.textOnDark,
  },
  heroRating: {
    ...type.caption,
    color: colors.accentSoft,
    fontWeight: weights.emphasis,
    marginTop: spacing.sm,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },

  // ── Top concierge bar (content page) ────────────────────────────────────
  topBar: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
    // Transparent (not colors.background) so the bar can sit high in the card
    // overlay without its background band reading as a halo/outline around the
    // search pill over the photo.
    backgroundColor: "transparent",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputSurfaceLight,
    borderRadius: 56,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Section ────────────────────────────────────────────────────────────────
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
    marginTop: spacing.xl,                    // sits just under the top bar
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
