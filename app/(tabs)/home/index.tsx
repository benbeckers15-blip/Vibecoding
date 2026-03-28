import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
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
import { Fonts } from "../../lib/fonts";

const { width, height } = Dimensions.get("window");
const TAB_BAR_HEIGHT = 60;

const mockAds = [
  {
    id: "1",
    uri: "https://firebasestorage.googleapis.com/v0/b/solid-garden-474012-q4.firebasestorage.app/o/homescreen%2Fpexels-rossogston-16219938%20(1).jpg?alt=media&token=d398eb5c-27b2-475d-b99d-3af822bb2c25",
    title: "Explore Margaret River",
    description: "Discover iconic wineries and their best vintages.",
  },
  {
    id: "2",
    uri: "https://firebasestorage.googleapis.com/v0/b/solid-garden-474012-q4.firebasestorage.app/o/homescreen%2Fpexels-line-knipst-574109081-21383903%20(1).jpg?alt=media&token=0bf7e921-8577-4ca0-9c51-93621a08959f",
    title: "Exclusive Tastings",
    description: "Join intimate events hosted by world-class sommeliers.",
  },
  {
    id: "3",
    uri: "https://picsum.photos/800/400?random=3",
    title: "Seasonal Specials",
    description: "Limited-time offers from your favorite wineries.",
  },
  {
    id: "4",
    uri: "https://picsum.photos/800/400?random=4",
    title: "Private Wine Tours",
    description: "Book tailored vineyard experiences for groups or couples.",
  },
];

export default function HomeScreen() {
  const router = useRouter();
  const touchStartX = useRef(0);
  const [imagesLoaded, setImagesLoaded] = useState(false);

  useEffect(() => {
    const loadImages = async () => {
      const cachePromises = mockAds.map((ad) =>
        Image.prefetch(ad.uri).catch(() => null)
      );
      await Promise.all(cachePromises);
      setImagesLoaded(true);
    };
    loadImages();
  }, []);

  const handlePressIn = (e: GestureResponderEvent) => {
    touchStartX.current = e.nativeEvent.pageX;
  };

  const handlePress = (e: GestureResponderEvent) => {
    const touchEndX = e.nativeEvent.pageX;
    const distance = Math.abs(touchEndX - touchStartX.current);
    if (distance < 10) {
      router.push("/wineries");
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        alignItems: "center",
        paddingBottom: TAB_BAR_HEIGHT + 20,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Carousel with overlayed header */}
      <View style={styles.carouselWrapper}>
        {!imagesLoaded ? (
          <ActivityIndicator size="large" color="#723FEB" style={{ height: 400 }} />
        ) : (
          <View style={{ position: "relative" }}>
            <Carousel
              loop
              width={width}
              height={400}
              autoPlay
              autoPlayInterval={5000}
              scrollAnimationDuration={1000}
              data={mockAds}
              pagingEnabled
              style={{ borderRadius: 0 }}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.carouselCard}
                  onPressIn={handlePressIn}
                  onPress={handlePress}
                >
                  <Image
                    source={{ uri: item.uri }}
                    style={styles.image}
                    fadeDuration={0}
                  />
                  <LinearGradient
                    colors={[
                      "rgba(255,255,255,0)",
                      "rgba(255,255,255,0.35)",
                      "rgba(255,255,255,0.6)",
                    ]}
                    start={{ x: 0, y: 0.6 }}
                    end={{ x: 0, y: 1 }}
                    style={[styles.captionOverlay, { paddingBottom: 40 }]}
                  >
                    <Text style={styles.captionTitle}>{item.title}</Text>
                    <Text style={styles.captionText}>{item.description}</Text>
                  </LinearGradient>
                </Pressable>
              )}
            />
            {/* Overlayed Header Text */}
            <Text style={styles.overlayHeader}>SipLocal</Text>
          </View>
        )}
      </View>

      {/* Rounded White Content Area */}
      <View style={styles.contentWrapper}>
        {/* Learn About Margaret River Section */}
        <View style={styles.learnWrapper}>
          <Text style={styles.sectionTitle}>Learn About Margaret River</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.learnScroll}
          >
            <Pressable
              style={styles.learnCard}
              onPress={() => router.push("/facet-climate")}
            >
              <Image
                source={{ uri: "https://picsum.photos/240/140?random=10" }}
                style={styles.learnCardImage}
              />
              <Text style={styles.cardTitle}>Climate</Text>
              <Text style={styles.cardText}>
                Mediterranean climate shapes grape ripening and wine balance.
              </Text>
            </Pressable>

            <Pressable
              style={styles.learnCard}
              onPress={() => router.push("/facet-soil")}
            >
              <Image
                source={{ uri: "https://picsum.photos/240/140?random=11" }}
                style={styles.learnCardImage}
              />
              <Text style={styles.cardTitle}>Soil & Geology</Text>
              <Text style={styles.cardText}>
                Gravelly loam and clay provide drainage and complexity.
              </Text>
            </Pressable>

            <Pressable
              style={styles.learnCard}
              onPress={() => router.push("/facet-topography")}
            >
              <Image
                source={{ uri: "https://picsum.photos/240/140?random=12" }}
                style={styles.learnCardImage}
              />
              <Text style={styles.cardTitle}>Topography</Text>
              <Text style={styles.cardText}>
                Hills and valleys influence sun exposure and temperature.
              </Text>
            </Pressable>

            <Pressable
              style={styles.learnCard}
              onPress={() => router.push("/facet-ocean")}
            >
              <Image
                source={{ uri: "https://picsum.photos/240/140?random=13" }}
                style={styles.learnCardImage}
              />
              <Text style={styles.cardTitle}>Proximity to Ocean</Text>
              <Text style={styles.cardText}>
                Cooling sea breezes moderate heat and preserve acidity.
              </Text>
            </Pressable>
          </ScrollView>
        </View>

        {/* Sommelier Recommendations Section */}
        <View style={styles.learnWrapper}>
          <Text style={styles.sectionTitleLarge}>Sommelier Recommendations</Text>
          <Text style={styles.sectionDescription}>
            Curated by a local wine expert
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.learnScroll}
          >
            <Pressable
              style={styles.learnCard}
              onPress={() => router.push("/sommelier-underrated-wineries")}
            >
              <Image
                source={{ uri: "https://picsum.photos/240/140?random=21" }}
                style={styles.learnCardImage}
              />
              <Text style={styles.cardTitle}>Underrated Wineries</Text>
              <Text style={styles.cardText}>
                Hidden gems producing exceptional wines, waiting to be discovered.
              </Text>
            </Pressable>

            <Pressable
              style={styles.learnCard}
              onPress={() => router.push("/sommelier-underrated-wines")}
            >
              <Image
                source={{ uri: "https://picsum.photos/240/140?random=22" }}
                style={styles.learnCardImage}
              />
              <Text style={styles.cardTitle}>Underrated Wines</Text>
              <Text style={styles.cardText}>
                Lesser-known bottles with unique flavors recommended by our sommelier.
              </Text>
            </Pressable>

            <Pressable
              style={styles.learnCard}
              onPress={() => router.push("/sommelier-tasting-notes")}
            >
              <Image
                source={{ uri: "https://picsum.photos/240/140?random=23" }}
                style={styles.learnCardImage}
              />
              <Text style={styles.cardTitle}>Tasting Notes</Text>
              <Text style={styles.cardText}>
                Expert tasting highlights of the region’s finest wines.
              </Text>
            </Pressable>

            <Pressable
              style={styles.learnCard}
              onPress={() => router.push("/sommelier-pairing-tips")}
            >
              <Image
                source={{ uri: "https://picsum.photos/240/140?random=24" }}
                style={styles.learnCardImage}
              />
              <Text style={styles.cardTitle}>Food Pairing Tips</Text>
              <Text style={styles.cardText}>
                Pairing recommendations from the local wine expert.
              </Text>
            </Pressable>
          </ScrollView>
        </View>

        {/* Cards Section */}
        <View style={styles.cardsWrapper}>
          <Pressable style={styles.card} onPress={() => router.push("/events")}>
            <Text style={styles.cardTitle}>Upcoming Events</Text>
            <Text style={styles.cardText}>
              Discover wine festivals, tastings, and more.
            </Text>
          </Pressable>

          <Pressable style={styles.card} onPress={() => router.push("/specials")}>
            <Text style={styles.cardTitle}>Exclusive Specials</Text>
            <Text style={styles.cardText}>
              Browse limited-time winery deals.
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  overlayHeader: {
    position: "absolute",
    top: 50,
    left: 20,
    fontSize: 28,
    fontFamily: Fonts.heading,
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.3)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    zIndex: 2,
  },
  carouselWrapper: { width: "100%", alignItems: "stretch", marginBottom: -10 },
  carouselCard: { backgroundColor: "#fff", overflow: "hidden" },
  image: { width: "100%", height: 400, resizeMode: "cover" },
  captionOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 0,
  },
  captionTitle: {
    fontSize: 16,
    fontFamily: Fonts.subHeading,
    color: "#fff",
    marginBottom: 4,
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  captionText: {
    fontSize: 14,
    fontFamily: Fonts.body,
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  contentWrapper: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    marginTop: -15,
    paddingTop: 30,
    paddingBottom: 60,
    width: "100%",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 6,
  },
  learnWrapper: { width: "100%", marginBottom: 30 },
  sectionTitle: {
    fontSize: 20,
    fontFamily: Fonts.heading,
    color: "#723FEB",
    marginLeft: 20,
    marginBottom: 12,
  },
  sectionTitleLarge: {
    fontSize: 24,
    fontFamily: Fonts.heading,
    color: "#723FEB",
    marginLeft: 20,
    marginBottom: 4,
  },
  sectionDescription: {
    fontSize: 14,
    fontFamily: Fonts.body,
    color: "#555",
    marginLeft: 20,
    marginBottom: 12,
  },
  learnScroll: { paddingHorizontal: 20, gap: 15 },
  learnCard: {
    width: 240,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 4,
    marginBottom: 10,
  },
  learnCardImage: { width: "100%", height: 120, borderRadius: 12, marginBottom: 8 },
  cardsWrapper: { width: "90%", gap: 20, marginBottom: 20, alignSelf: "center" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: Fonts.subHeading,
    marginBottom: 6,
    color: "#723FEB",
  },
  cardText: {
    fontSize: 13,
    fontFamily: Fonts.body,
    color: "#555",
  },
});

