// app/(tabs)/home/index.tsx
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  GestureResponderEvent,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Carousel from "react-native-reanimated-carousel";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { db } from "../../../firebaseConfig";

const { width } = Dimensions.get("window");

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
          <View style={styles.carouselPlaceholder}>
            <ActivityIndicator color="#999" />
          </View>
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
            onPress={() => router.push(`/wineries/${featuredWinery.slug}` as any)}
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
                    <Text style={styles.featuredRating}>
                      ⭐ {featuredWinery.rating.toFixed(1)}
                      {featuredWinery.userRatingsTotal
                        ? `  ·  ${featuredWinery.userRatingsTotal.toLocaleString()} reviews`
                        : ""}
                    </Text>
                  )}
                  <Text style={styles.featuredCta}>VIEW WINERY ›</Text>
                </View>
              </View>
            ) : (
              <View style={styles.featuredNoImage}>
                <Text style={styles.featuredRegion}>MARGARET RIVER</Text>
                <Text style={styles.featuredNameDark}>{featuredWinery.name}</Text>
                {featuredWinery.rating && (
                  <Text style={styles.featuredRatingDark}>
                    ⭐ {featuredWinery.rating.toFixed(1)}
                  </Text>
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

      {/* Cards */}
      <View style={styles.cardsWrapper}>

        <Pressable style={styles.card} onPress={() => router.push("/events")}>
          <Text style={styles.cardLabel}>CALENDAR</Text>
          <Text style={styles.cardTitle}>Upcoming Events</Text>
          <Text style={styles.cardText}>
            Discover wine festivals, tastings, and more.
          </Text>
          <View style={styles.cardBorder} />
        </Pressable>

        <Pressable style={styles.card} onPress={() => router.push("/specials")}>
          <Text style={styles.cardLabel}>OFFERS</Text>
          <Text style={styles.cardTitle}>Exclusive Specials</Text>
          <Text style={styles.cardText}>
            Browse limited-time winery deals.
          </Text>
          <View style={styles.cardBorder} />
        </Pressable>

        <View style={styles.row}>
          <Pressable
            style={[styles.smallCard, { marginRight: 8 }]}
            onPress={() => router.push("/wineries")}
          >
            <Text style={styles.cardLabel}>CURATED</Text>
            <Text style={styles.smallCardTitle}>Somm's{"\n"}Picks</Text>
            <Text style={styles.cardText}>
              The best of the region, selected by experts.
            </Text>
          </Pressable>

          <Pressable
            style={[styles.smallCard, { marginLeft: 8 }]}
            onPress={() => router.push("/wineries")}
          >
            <Text style={styles.cardLabel}>EXCLUSIVE</Text>
            <Text style={styles.smallCardTitle}>Private{"\n"}Dinners</Text>
            <Text style={styles.cardText}>
              Intimate guided tastings in stunning settings.
            </Text>
          </Pressable>
        </View>

      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
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
  carouselPlaceholder: {
    width: width * 0.92,
    height: 280,
    backgroundColor: "#f5f5f0",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 4,
  },
  carouselCard: {
    borderRadius: 4,
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
  featuredRating: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    marginBottom: 10,
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
  featuredRatingDark: {
    fontSize: 12,
    color: "#666",
    marginBottom: 10,
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

  // Cards
  cardsWrapper: {
    width: "90%",
    gap: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e8e8e8",
    padding: 20,
  },
  cardBorder: {
    height: 1,
    backgroundColor: "#f0f0f0",
    marginTop: 16,
  },
  cardLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Georgia",
    color: "#940c0c",
    marginBottom: 6,
  },
  cardText: {
    fontSize: 13,
    color: "#666",
    lineHeight: 19,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  smallCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e8e8e8",
    padding: 16,
  },
  smallCardTitle: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Georgia",
    color: "#1a1a1a",
    marginBottom: 6,
    lineHeight: 24,
  },
});