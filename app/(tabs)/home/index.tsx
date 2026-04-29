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
import { colors, fonts } from "../../../constants/theme";
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
        {/* Subtle warm vignette at the bottom edge only — keeps logo legible */}
        <LinearGradient
          colors={["transparent", colors.photoOverlaySoft]}
          locations={[0.65, 1]}
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
              <LinearGradient
                colors={["transparent", colors.photoOverlayStrong]}
                style={[StyleSheet.absoluteFill, { borderRadius: 4 }]}
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
                colors={["transparent", colors.photoOverlayStrong]}
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
                colors={["transparent", colors.photoOverlayStrong]}
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
                  colors={["transparent", colors.photoOverlayStrong]}
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
                  colors={["transparent", colors.photoOverlayStrong]}
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
    paddingHorizontal: 24,
  },
  logo: {
    fontFamily: "Georgia",
    fontSize: 22,
    fontStyle: "italic",
    color: colors.textOnDark,           // hardcoded light — overlaid on photograph
    letterSpacing: 0.3,
  },
  logoAccent: {
    fontStyle: "normal",
    fontWeight: "700",
    color: colors.accentSoft,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.photoChrome,              // dark glass for photo overlay
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    alignItems: "center",
    justifyContent: "center",
  },
  // Editorial copy section — sits on warm paper below the image
  heroCopySection: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 8,
  },
  heroKicker: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.5,
    color: colors.accent,
  },
  heroHeadline: {
    fontFamily: "Georgia",
    fontSize: 42,
    fontStyle: "italic",
    color: colors.textPrimary,               // deep aubergine-black on paper — confident
    lineHeight: 46,
    marginTop: 12,
    letterSpacing: -0.8,
  },

  // ── Search + chips ────────────────────────────────────────────────────────
  searchSection: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  chipsScroll: {
    marginTop: 12,
  },
  chipsRow: {
    gap: 8,
    paddingRight: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 60,
    alignItems: "center",
  },
  chipText: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.textPrimary,
  },

  // ── Section header ────────────────────────────────────────────────────────
  section: {
    marginTop: 40,
    paddingHorizontal: 20,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  goldLine: {
    width: 24,
    height: 1,
    backgroundColor: colors.accent,
  },
  sectionKicker: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.5,
    color: colors.accentSoft,
  },

  // ── Featured winery ───────────────────────────────────────────────────────
  featImgWrap: {
    height: 200,
    borderRadius: 4,
    overflow: "hidden",
  },
  featImg: {
    width: "100%",
    height: "100%",
  },
  featBody: {
    padding: 18,
    backgroundColor: colors.surface,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
  },
  featRegion: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.textMuted,
  },
  featName: {
    fontFamily: "Georgia",
    fontSize: 24,
    fontWeight: "500",
    color: colors.textPrimary,
    marginTop: 6,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  featRating: {
    fontSize: 12,
    color: colors.accentSoft,
    fontWeight: "600",
    marginTop: 8,
  },
  featCta: {
    fontSize: 12,
    color: colors.accentSoft,
    fontWeight: "600",
    marginTop: 14,
  },

  // ── Editorial tiles ───────────────────────────────────────────────────────
  tilesRow: {
    paddingHorizontal: 20,
    gap: 10,
  },
  tile: {
    width: 140,
    height: 200,
    borderRadius: 4,
    overflow: "hidden",
  },
  tileImg: {
    width: "100%",
    height: "100%",
  },
  tileOverlay: {
    position: "absolute",
    bottom: 14,
    left: 14,
    right: 14,
  },
  tileKicker: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    color: colors.accentSoft,
    marginBottom: 5,
  },
  tileTitle: {
    fontFamily: "Georgia",
    fontSize: 17,
    color: colors.textOnDark,
    lineHeight: 21,
  },

  // ── Explore cards ─────────────────────────────────────────────────────────
  exploreCards: {
    gap: 12,
  },
  exploreCard: {
    borderRadius: 4,
    overflow: "hidden",
  },
  exploreSmall: {
    flex: 1,
    borderRadius: 4,
    overflow: "hidden",
  },
  smallRow: {
    flexDirection: "row",
    gap: 12,
  },
  exploreCardBg: {
    height: 150,
  },
  cardGrad: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: 50,
  },
  cardKicker: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2.5,
    color: colors.textOnDarkSubtle,
    marginBottom: 4,
  },
  cardTitle: {
    fontFamily: "Georgia",
    fontSize: 20,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: 4,
  },
  cardBody: {
    fontSize: 11,
    color: colors.textOnDarkMuted,
    lineHeight: 16,
  },
  smallCardTitle: {
    fontFamily: "Georgia",
    fontSize: 17,
    fontWeight: "700",
    color: colors.textOnDark,
    lineHeight: 22,
  },
});
