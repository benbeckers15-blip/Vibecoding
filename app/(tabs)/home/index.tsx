// app/(tabs)/home/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  GestureResponderEvent,
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Carousel from "react-native-reanimated-carousel";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SkeletonBox from "../../../components/SkeletonBox";
import { db } from "../../../firebaseConfig";

const { width } = Dimensions.get("window");

// ─── Explore card background images ──────────────────────────────────────────
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

type CarouselSlide = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  linkTo: string;
  order: number;
  active: boolean;
};

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

// ─── Carousel skeleton ────────────────────────────────────────────────────────
function CarouselSkeleton() {
  return (
    <View style={skeletonStyles.carouselWrapper}>
      <SkeletonBox style={skeletonStyles.carouselBlock} />
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const touchStartX = useRef(0);
  const [slides, setSlides] = useState<CarouselSlide[]>([]);
  const [loadingSlides, setLoadingSlides] = useState(true);
  const [featuredWinery, setFeaturedWinery] = useState<FeaturedWinery | null>(null);

  useEffect(() => {
    async function fetchSlides() {
      try {
        const snapshot = await getDocs(collection(db, "homepage_carousel"));
        const data: CarouselSlide[] = snapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<CarouselSlide, "id">) }))
          .filter((slide) => slide.active)
          .sort((a, b) => a.order - b.order);
        setSlides(data);
      } catch (err) {
        console.error("Error fetching carousel:", err);
      } finally {
        setLoadingSlides(false);
      }
    }

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
          setFeaturedWinery({ id: doc.id, ...(doc.data() as Omit<FeaturedWinery, "id">) });
        }
      } catch (err) {
        console.error("Error fetching featured winery:", err);
      }
    }

    fetchSlides();
    fetchFeatured();
  }, []);

  const handlePressIn = (e: GestureResponderEvent) => {
    touchStartX.current = e.nativeEvent.pageX;
  };

  const handleSlidePress = (e: GestureResponderEvent, linkTo: string) => {
    const distance = Math.abs(e.nativeEvent.pageX - touchStartX.current);
    if (distance < 10) router.push(linkTo as any);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingTop: insets.top + 16 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Carousel */}
      <View style={styles.carouselWrapper}>
        {loadingSlides ? (
          <CarouselSkeleton />
        ) : slides.length > 0 ? (
          <Carousel
            loop
            width={width * 0.92}
            height={280}
            autoPlay
            data={slides}
            scrollAnimationDuration={3000}
            renderItem={({ item }) => (
              <Pressable
                style={styles.carouselCard}
                onPressIn={handlePressIn}
                onPress={(e) => handleSlidePress(e, item.linkTo)}
              >
                <Image source={{ uri: item.imageUrl }} style={styles.image} />
                <LinearGradient
                  colors={["transparent", "rgba(0,0,0,0.75)"]}
                  style={styles.gradient}
                />
                <View style={styles.captionBox}>
                  <Text style={styles.captionTitle}>{item.title}</Text>
                  <Text style={styles.captionText}>{item.description}</Text>
                </View>
              </Pressable>
            )}
          />
        ) : null}
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
            onPress={() => router.push(`/wineries/${featuredWinery.slug}?from=home` as any)}
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
                  <Text style={styles.featuredRegion}>MARGARET RIVER</Text>
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
                <Text style={styles.featuredRegion}>MARGARET RIVER</Text>
                <Text style={styles.featuredNameDark}>{featuredWinery.name}</Text>
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

const skeletonStyles = StyleSheet.create({
  carouselWrapper: {
    width: width * 0.92,
    alignItems: "center",
  },
  carouselBlock: {
    width: "100%",
    height: 280,
    borderRadius: 16,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#faf9f6",
  },
  contentContainer: {
    paddingBottom: 120,
    alignItems: "center",
  },

  // Carousel
  carouselWrapper: {
    width: "100%",
    alignItems: "center",
    marginBottom: 28,
  },
  carouselCard: {
    borderRadius: 16,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: 280,
    resizeMode: "cover",
  },
  gradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
  },
  captionBox: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
  },
  captionTitle: {
    fontSize: 24,
    fontWeight: "700",
    fontFamily: "Georgia",
    color: "#fff",
    marginBottom: 4,
  },
  captionText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
    letterSpacing: 0.3,
  },

  // Featured winery
  featuredWrapper: {
    width: "90%",
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
