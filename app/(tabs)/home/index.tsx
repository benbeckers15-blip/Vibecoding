// app/(tabs)/home/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
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
import { db } from "../../../firebaseConfig";

// ─── Static assets ───────────────────────────────────────────────────────────
const HERO_IMAGE_FALLBACK =
  "https://images.unsplash.com/photo-1734517648070-2e8d4ed686ac?q=80&w=1035&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D";

const CARD_IMAGES = {
  events:
    "https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=800&q=80",
  specials:
    "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80",
  somms:
    "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=800&q=80",
  dinners:
    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80",
};

// ─── Editorial tiles configuration ───────────────────────────────────────────
type FilterKey =
  | "dogFriendly"
  | "hasRestaurant"
  | "isOrganic"
  | "isBiodynamic"
  | "walkinWelcome";

type EditorialTile = {
  key: FilterKey | "nearMe";
  label: string;
  headline: string;
  image: string;
};

const EDITORIAL_TILES: EditorialTile[] = [
  {
    key: "hasRestaurant",
    label: "DINING",
    headline: "Best for\nLunch",
    image: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&q=80",
  },
  {
    key: "dogFriendly",
    label: "OUTDOORS",
    headline: "Dog-Friendly\nEstates",
    image: "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=400&q=80",
  },
  {
    key: "walkinWelcome",
    label: "CASUAL",
    headline: "Walk In,\nNo Booking",
    image: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=400&q=80",
  },
  {
    key: "isOrganic",
    label: "SUSTAINABLE",
    headline: "Organic\nProducers",
    image: "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=400&q=80",
  },
  {
    key: "isBiodynamic",
    label: "NATURAL",
    headline: "Biodynamic\nWines",
    image: "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=400&q=80",
  },
  {
    key: "nearMe",
    label: "LOCATION",
    headline: "Wineries\nNear Me",
    image: "https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=400&q=80",
  },
];

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
  const [heroImageUrl, setHeroImageUrl] = useState<string>(HERO_IMAGE_FALLBACK);
  const [featuredWinery, setFeaturedWinery] = useState<FeaturedWinery | null>(
    null
  );

  useEffect(() => {
    async function fetchHeroImage() {
      try {
        const snap = await getDoc(doc(db, "config", "homepage"));
        if (snap.exists() && snap.data().heroImageUrl) {
          setHeroImageUrl(snap.data().heroImageUrl);
        }
      } catch (err) {
        console.error("Error fetching hero image:", err);
        // Falls back to HERO_IMAGE_FALLBACK
      }
    }
    fetchHeroImage();
  }, []);

  useEffect(() => {
    async function fetchFeatured() {
      try {
        const q = query(
          collection(db, "wineries"),
          where("featured", "==", true),
          where("featuredTier", "==", "hero")
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          setFeaturedWinery({
            id: doc.id,
            ...(doc.data() as Omit<FeaturedWinery, "id">),
          });
        }
      } catch (err) {
        console.error("Error fetching featured winery:", err);
      }
    }
    fetchFeatured();
  }, []);

  const handleSearchSubmit = () => {
    const trimmed = search.trim();
    const t = Date.now();
    const url =
      trimmed.length > 0
        ? `/wineries?search=${encodeURIComponent(trimmed)}&t=${t}`
        : `/wineries?t=${t}`;
    router.push(url as any);
  };

  const [nearMeLoading, setNearMeLoading] = useState(false);

  const handleFilterCardPress = async (key: EditorialTile["key"]) => {
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
      } catch (err) {
        console.error("Location error:", err);
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
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* Logo header */}
      <View style={[styles.logoHeader, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.logoText}>
          <Text style={styles.logoSip}>sip</Text>
          <Text style={styles.logoLocal}>Local</Text>
        </Text>
      </View>

      {/* Hero with search bar */}
      <View style={styles.hero}>
        <Image source={{ uri: heroImageUrl }} style={styles.heroImage} />
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.65)"]}
          style={styles.heroGradient}
        />
        <View style={styles.heroCaption}>
          <Text style={styles.heroLabel}>{REGION_NAME_UPPER}</Text>
          <Text style={styles.heroTitle}>Discover the region</Text>
        </View>
        <View style={styles.heroSearchWrapper}>
          <Ionicons
            name="search"
            size={16}
            color="#888"
            style={styles.heroSearchIcon}
          />
          <TextInput
            style={styles.heroSearch}
            placeholder={`Search ${REGION_NAME} wineries...`}
            placeholderTextColor="#999"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={handleSearchSubmit}
          />
        </View>
      </View>

      {/* Editorial strip */}
      <View style={styles.editorialSection}>
        <View style={styles.editorialHeader}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>EXPLORE BY</Text>
          <View style={styles.dividerLine} />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.editorialStrip}
        >
          {EDITORIAL_TILES.map((tile) => {
            const isLoading = tile.key === "nearMe" && nearMeLoading;
            return (
              <Pressable
                key={tile.key}
                style={styles.editorialTile}
                onPress={() => handleFilterCardPress(tile.key)}
                disabled={isLoading}
              >
                <ImageBackground
                  source={{ uri: tile.image }}
                  style={styles.editorialTileBg}
                  imageStyle={styles.editorialTileImage}
                >
                  <LinearGradient
                    colors={["transparent", "rgba(0,0,0,0.78)"]}
                    style={styles.editorialTileGradient}
                  >
                    <Text style={styles.editorialTileLabel}>{tile.label}</Text>
                    {isLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.editorialTileHeadline}>
                        {tile.headline}
                      </Text>
                    )}
                  </LinearGradient>
                </ImageBackground>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Featured Winery */}
      {featuredWinery && (
        <View style={styles.featuredWrapper}>
          <View style={styles.featuredDividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.featuredDividerLabel}>
              {featuredWinery.featuredLabel?.toUpperCase() || "THIS WEEK"}
            </Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            style={styles.featuredCard}
            onPress={() =>
              router.push(`/wineries/${featuredWinery.slug}?from=home` as any)
            }
          >
            {featuredWinery.images && featuredWinery.images.length > 0 ? (
              <View style={styles.featuredImageWrapper}>
                <Image
                  source={{ uri: featuredWinery.images[0] }}
                  style={styles.featuredImage}
                />
                <LinearGradient
                  colors={["transparent", "rgba(0,0,0,0.8)"]}
                  style={styles.featuredGradient}
                />
                <View style={styles.featuredOverlay}>
                  <Text style={styles.featuredRegion}>{REGION_NAME_UPPER}</Text>
                  <Text style={styles.featuredName}>{featuredWinery.name}</Text>
                  {featuredWinery.rating && (
                    <View style={styles.ratingRow}>
                      <Ionicons name="star" size={11} color="#C8860A" />
                      <Text style={styles.featuredRating}>
                        {featuredWinery.rating.toFixed(1)}
                        {featuredWinery.userRatingsTotal
                          ? `  ·  ${featuredWinery.userRatingsTotal.toLocaleString()} reviews`
                          : ""}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.featuredCta}>VIEW WINERY ›</Text>
                </View>
              </View>
            ) : (
              <View style={styles.featuredNoImage}>
                <Text style={styles.featuredRegion}>{REGION_NAME_UPPER}</Text>
                <Text style={styles.featuredNameDark}>
                  {featuredWinery.name}
                </Text>
                {featuredWinery.rating && (
                  <View style={styles.ratingRowDark}>
                    <Ionicons name="star" size={11} color="#C8860A" />
                    <Text style={styles.featuredRatingDark}>
                      {featuredWinery.rating.toFixed(1)}
                    </Text>
                  </View>
                )}
                <Text style={styles.featuredCtaDark}>VIEW WINERY ›</Text>
              </View>
            )}
          </Pressable>
        </View>
      )}

      {/* EXPLORE Divider */}
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerLabel}>EXPLORE</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Explore Cards */}
      <View style={styles.cardsWrapper}>
        <Pressable style={styles.card} onPress={() => router.push("/events")}>
          <ImageBackground
            source={{ uri: CARD_IMAGES.events }}
            style={styles.cardImageBg}
          >
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.80)"]}
              style={styles.cardGradient}
            >
              <Text style={styles.cardLabel}>CALENDAR</Text>
              <Text style={styles.cardTitle}>Upcoming Events</Text>
              <Text style={styles.cardText}>
                Discover wine festivals, tastings, and more.
              </Text>
            </LinearGradient>
          </ImageBackground>
        </Pressable>

        <Pressable style={styles.card} onPress={() => router.push("/specials")}>
          <ImageBackground
            source={{ uri: CARD_IMAGES.specials }}
            style={styles.cardImageBg}
          >
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.80)"]}
              style={styles.cardGradient}
            >
              <Text style={styles.cardLabel}>OFFERS</Text>
              <Text style={styles.cardTitle}>Exclusive Specials</Text>
              <Text style={styles.cardText}>
                Browse limited-time winery deals.
              </Text>
            </LinearGradient>
          </ImageBackground>
        </Pressable>

        <View style={styles.row}>
          <Pressable
            style={[styles.smallCard, { marginRight: 8 }]}
            onPress={() => router.push("/wineries")}
          >
            <ImageBackground
              source={{ uri: CARD_IMAGES.somms }}
              style={styles.cardImageBg}
            >
              <LinearGradient
                colors={["transparent", "rgba(0,0,0,0.80)"]}
                style={styles.cardGradient}
              >
                <Text style={styles.cardLabel}>CURATED</Text>
                <Text style={styles.smallCardTitle}>Somm's{"\n"}Picks</Text>
                <Text style={styles.cardText}>
                  The best of the region, selected by experts.
                </Text>
              </LinearGradient>
            </ImageBackground>
          </Pressable>

          <Pressable
            style={[styles.smallCard, { marginLeft: 8 }]}
            onPress={() => router.push("/wineries")}
          >
            <ImageBackground
              source={{ uri: CARD_IMAGES.dinners }}
              style={styles.cardImageBg}
            >
              <LinearGradient
                colors={["transparent", "rgba(0,0,0,0.80)"]}
                style={styles.cardGradient}
              >
                <Text style={styles.cardLabel}>EXCLUSIVE</Text>
                <Text style={styles.smallCardTitle}>Private{"\n"}Dinners</Text>
                <Text style={styles.cardText}>
                  Intimate guided tastings in stunning settings.
                </Text>
              </LinearGradient>
            </ImageBackground>
          </Pressable>
        </View>
      </View>
    </ScrollView>
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

  // Logo header
  logoHeader: {
    paddingHorizontal: 24,
    paddingBottom: 14,
  },
  logoText: {
    fontSize: 24,
    fontFamily: "Georgia",
    letterSpacing: -0.5,
  },
  logoSip: {
    fontStyle: "italic",
    color: "#1a1a1a",
  },
  logoLocal: {
    fontWeight: "700",
    color: "#940c0c",
  },

  // Hero
  hero: {
    width: "100%",
    height: 340,
    position: "relative",
    marginBottom: 28,
  },
  heroImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  heroGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 260,
  },
  heroCaption: {
    position: "absolute",
    top: 28,
    left: 24,
    right: 24,
  },
  heroLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "rgba(255,255,255,0.85)",
    marginBottom: 6,
    fontWeight: "600",
  },
  heroTitle: {
    fontSize: 28,
    fontFamily: "Georgia",
    fontWeight: "700",
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroSearchWrapper: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 20,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 48,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  heroSearchIcon: {
    marginRight: 10,
  },
  heroSearch: {
    flex: 1,
    fontSize: 14,
    color: "#1a1a1a",
    letterSpacing: 0.3,
    paddingVertical: 0,
  },

  // Editorial strip
  editorialSection: {
    marginBottom: 28,
  },
  editorialHeader: {
    flexDirection: "row",
    alignItems: "center",
    width: "90%",
    alignSelf: "center",
    marginBottom: 16,
  },
  editorialStrip: {
    paddingHorizontal: 20,
    gap: 12,
  },
  editorialTile: {
    width: 148,
    height: 196,
    borderRadius: 4,
    overflow: "hidden",
  },
  editorialTileBg: {
    flex: 1,
  },
  editorialTileImage: {
    borderRadius: 4,
  },
  editorialTileGradient: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 14,
  },
  editorialTileLabel: {
    fontSize: 9,
    letterSpacing: 2.5,
    color: "rgba(255,255,255,0.7)",
    marginBottom: 5,
    fontWeight: "600",
  },
  editorialTileHeadline: {
    fontSize: 18,
    fontFamily: "Georgia",
    fontWeight: "700",
    color: "#fff",
    lineHeight: 22,
  },

  // Featured winery
  featuredWrapper: {
    width: "90%",
    alignSelf: "center",
    marginBottom: 28,
  },
  featuredDividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  featuredDividerLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    marginHorizontal: 12,
  },
  featuredCard: {
    borderWidth: 1,
    borderColor: "#e8e8e8",
    borderRadius: 16,
    overflow: "hidden",
  },
  featuredImageWrapper: {
    height: 220,
    position: "relative",
  },
  featuredImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  featuredGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
  },
  featuredOverlay: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
  },
  featuredRegion: {
    fontSize: 9,
    letterSpacing: 3,
    color: "rgba(255,255,255,0.7)",
    marginBottom: 6,
  },
  featuredName: {
    fontSize: 26,
    fontFamily: "Georgia",
    fontWeight: "700",
    color: "#fff",
    marginBottom: 6,
    lineHeight: 30,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 10,
  },
  featuredRating: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    letterSpacing: 0.3,
  },
  featuredCta: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#fff",
    fontWeight: "600",
  },
  featuredNoImage: {
    padding: 24,
    backgroundColor: "#f5f5f0",
  },
  featuredNameDark: {
    fontSize: 26,
    fontFamily: "Georgia",
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 6,
    lineHeight: 30,
  },
  ratingRowDark: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 10,
  },
  featuredRatingDark: {
    fontSize: 12,
    color: "#666",
    letterSpacing: 0.3,
  },
  featuredCtaDark: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#1a1a1a",
    fontWeight: "600",
  },

  // Dividers
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "90%",
    alignSelf: "center",
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e0e0e0",
  },
  dividerLabel: {
    fontSize: 10,
    letterSpacing: 3,
    color: "#999",
    marginHorizontal: 12,
  },

  // Explore cards
  cardsWrapper: {
    width: "90%",
    alignSelf: "center",
    gap: 16,
  },
  card: {
    overflow: "hidden",
    borderRadius: 4,
  },
  cardImageBg: {
    height: 160,
  },
  cardGradient: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 60,
  },
  cardLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "rgba(255,255,255,0.7)",
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Georgia",
    color: "#fff",
    marginBottom: 5,
  },
  cardText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.75)",
    lineHeight: 17,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  smallCard: {
    flex: 1,
    overflow: "hidden",
    borderRadius: 4,
  },
  smallCardTitle: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Georgia",
    color: "#fff",
    marginBottom: 5,
    lineHeight: 24,
  },
});
