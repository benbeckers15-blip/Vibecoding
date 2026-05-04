// app/(tabs)/home/index.tsx
// Redesigned with Direction B — Cinematic Dusk aesthetic
// Dark bg · Georgia serif · gold accents · glass search · editorial grid

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
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

// ─── Static assets ────────────────────────────────────────────────────────────
const HERO_FALLBACK =
  "https://images.unsplash.com/photo-1734517648070-2e8d4ed686ac?q=80&w=1035&auto=format&fit=crop";

// ─── Filter chip config ───────────────────────────────────────────────────────
type FilterKey =
  | "dogFriendly"
  | "hasRestaurant"
  | "isOrganic"
  | "isBiodynamic"
  | "walkinWelcome"
  | "nearMe";

const CHIPS: { key: FilterKey; label: string }[] = [
  { key: "hasRestaurant", label: "Restaurant" },
  { key: "dogFriendly",   label: "Dog OK"     },
  { key: "walkinWelcome", label: "Walk-ins"   },
  { key: "isOrganic",     label: "Organic"    },
  { key: "isBiodynamic",  label: "Biodynamic" },
  { key: "nearMe",        label: "Near me"    },
];

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

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState<string>(HERO_FALLBACK);
  const [featuredWinery, setFeaturedWinery] = useState<FeaturedWinery | null>(null);
  const [wineryCount, setWineryCount] = useState<number>(0);
  const [nearMeLoading, setNearMeLoading] = useState(false);

  // Fetch hero image
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "config", "homepage"));
        if (snap.exists() && snap.data().heroImageUrl) {
          setHeroImageUrl(snap.data().heroImageUrl as string);
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

  const handleSearchSubmit = () => {
    const trimmed = search.trim();
    const t = Date.now();
    router.push(
      (trimmed
        ? `/wineries?search=${encodeURIComponent(trimmed)}&t=${t}`
        : `/wineries?t=${t}`) as any
    );
  };

  const handleChipPress = async (key: FilterKey) => {
    const t = Date.now();
    if (key === "nearMe") {
      if (nearMeLoading) return;
      setNearMeLoading(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Location needed",
            "Enable location access to see wineries near you."
          );
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        router.push(
          `/wineries?near=1&lat=${loc.coords.latitude}&lng=${loc.coords.longitude}&t=${t}` as any
        );
      } catch {
        Alert.alert(
          "Location unavailable",
          "We couldn't get your location. Please try again."
        );
      } finally {
        setNearMeLoading(false);
      }
      return;
    }
    router.push(`/wineries?filter=${key}&t=${t}` as any);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Daylight hero — image only, full saturation ───────────────────────── */}
      <View style={styles.hero}>
        {/* Hero image — full saturation, landscape does the heavy lifting */}
        <Image
          source={{ uri: heroImageUrl }}
          style={[StyleSheet.absoluteFill, { opacity: 0.96 }]}
          resizeMode="cover"
        />
        {/* Double-stop gradient: dark scrim at top (keeps brand + heart legible
            on bright photos like a sunlit vineyard) AND a soft bottom vignette
            so the headline overlay below the image edge reads cleanly too. */}
        <LinearGradient
          colors={[
            colors.photoOverlayTop,
            "transparent",
            colors.photoOverlayBottom,
          ]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* Brand header overlaid on photo */}
        <View style={[styles.heroHeader, { paddingTop: insets.top + 10 }]}>
          <Text style={styles.logo}>
            Cellar<Text style={styles.logoAccent}>Door</Text>
          </Text>
          <View style={styles.iconBtn}>
            <Ionicons name="heart-outline" size={15} color={colors.textOnDark} />
          </View>
        </View>
      </View>

      {/* ── Hero editorial copy — on warm paper below the image ──────────────── */}
      <View style={styles.heroCopySection}>
        <Text style={styles.heroKicker}>
          {REGION_NAME_UPPER}
          {wineryCount > 0 ? ` · ${wineryCount} CELLAR DOORS` : ""}
        </Text>
        <Text style={styles.heroHeadline}>
          {"The region,\nby the glass."}
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
            <Ionicons name="options-outline" size={14} color={colors.background} />
          </Pressable>
        </View>

        {/* Scrollable filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          {CHIPS.map((chip) => {
            const loading = chip.key === "nearMe" && nearMeLoading;
            return (
              <Pressable
                key={chip.key}
                style={styles.chip}
                onPress={() => handleChipPress(chip.key)}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Text style={styles.chipText}>{chip.label}</Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
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
                  resizeMode="cover"
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
                  `/wineries?filter=${tile.key}&t=${Date.now()}` as any
                )
              }
            >
              <Image
                source={{ uri: tile.image }}
                style={styles.tileImg}
                resizeMode="cover"
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

      {/* ── Explore cards — Events / Specials / Curated ──────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <View style={styles.goldLine} />
          <Text style={styles.sectionKicker}>CURATED</Text>
        </View>

        <View style={styles.exploreCards}>
          {/* Events */}
          <Pressable
            style={styles.exploreCard}
            onPress={() => router.push("/explore" as any)}
          >
            <ImageBackground
              source={{
                uri: "https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=800&q=80",
              }}
              style={styles.exploreCardBg}
            >
              <LinearGradient
                colors={[
                  colors.photoOverlayTop,
                  "transparent",
                  colors.photoOverlayBottom,
                ]}
                locations={[0, 0.35, 1]}
                style={styles.cardGrad}
              >
                <Text style={styles.cardKicker}>CALENDAR</Text>
                <Text style={styles.cardTitle}>Upcoming Events</Text>
                <Text style={styles.cardBody}>
                  Wine festivals, tastings & more
                </Text>
              </LinearGradient>
            </ImageBackground>
          </Pressable>

          {/* The Tassie Pour */}
          <Pressable
            style={styles.exploreCard}
            onPress={() => router.push("/(tabs)/home/pour" as any)}
          >
            <ImageBackground
              source={{
                uri: "https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=800&q=80",
              }}
              style={styles.exploreCardBg}
            >
              <LinearGradient
                colors={[
                  colors.photoOverlayTop,
                  "transparent",
                  colors.photoOverlayBottom,
                ]}
                locations={[0, 0.35, 1]}
                style={styles.cardGrad}
              >
                <Text style={styles.cardKicker}>EDITORIAL</Text>
                <Text style={styles.cardTitle}>The Tassie Pour</Text>
                <Text style={styles.cardBody}>
                  A weekly taste of local vineyards, vintages, and voices
                </Text>
              </LinearGradient>
            </ImageBackground>
          </Pressable>

          {/* Small pair */}
          <View style={styles.smallRow}>
            <Pressable
              style={styles.exploreSmall}
              onPress={() => router.push("/wineries")}
            >
              <ImageBackground
                source={{
                  uri: "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=400&q=80",
                }}
                style={styles.exploreCardBg}
              >
                <LinearGradient
                  colors={[
                    colors.photoOverlayTop,
                    "transparent",
                    colors.photoOverlayBottom,
                  ]}
                  locations={[0, 0.35, 1]}
                  style={styles.cardGrad}
                >
                  <Text style={styles.cardKicker}>CURATED</Text>
                  <Text style={styles.smallCardTitle}>{"Somm's\nPicks"}</Text>
                </LinearGradient>
              </ImageBackground>
            </Pressable>

            <Pressable
              style={styles.exploreSmall}
              onPress={() => router.push("/wineries")}
            >
              <ImageBackground
                source={{
                  uri: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&q=80",
                }}
                style={styles.exploreCardBg}
              >
                <LinearGradient
                  colors={[
                    colors.photoOverlayTop,
                    "transparent",
                    colors.photoOverlayBottom,
                  ]}
                  locations={[0, 0.35, 1]}
                  style={styles.cardGrad}
                >
                  <Text style={styles.cardKicker}>EXCLUSIVE</Text>
                  <Text style={styles.smallCardTitle}>{"Private\nDinners"}</Text>
                </LinearGradient>
              </ImageBackground>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
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
    height: 340,                // image-only; copy moves below
  },
  heroHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xxl,
  },
  logo: {
    fontFamily: fonts.serif,
    fontSize: type.h3.fontSize,
    fontStyle: "italic",
    color: colors.textOnDark,           // hardcoded light — overlaid on photograph
    letterSpacing: 0.3,
  },
  logoAccent: {
    fontStyle: "normal",
    fontWeight: weights.emphasis,
    color: colors.accentSoft,
  },
  iconBtn: {
    width: spacing.hitTarget,           // 44pt — Apple HIG minimum touch target
    height: spacing.hitTarget,
    borderRadius: spacing.hitTarget / 2,
    backgroundColor: colors.photoChrome,              // dark glass for photo overlay
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    alignItems: "center",
    justifyContent: "center",
  },
  // Editorial copy section — sits on warm paper below the image
  heroCopySection: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.sm,
  },
  heroKicker: {
    ...type.kicker,
    color: colors.accent,
  },
  heroHeadline: {
    ...type.display,                          // 44 / 50 / -0.3 / italic Georgia
    color: colors.textPrimary,                // deep aubergine-black on paper — confident
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
    backgroundColor: colors.surface,
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
  chipsScroll: {
    marginTop: spacing.md,
  },
  chipsRow: {
    gap: spacing.sm,
    paddingRight: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.lg,             // bumped 14 → 16 for breathing room
    paddingVertical: 11,                       // bumped 7 → 11 (Fix 4)
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 60,
    minHeight: spacing.hitTarget,              // 44pt floor (Apple HIG)
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    ...type.caption,                            // 12 / 16 line-height
    fontWeight: weights.body,
    color: colors.textPrimary,
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
});
