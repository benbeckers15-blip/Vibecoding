// app/(tabs)/home/index.tsx
import { useRouter } from "expo-router";
import { useRef } from "react";
import {
  Dimensions,
  GestureResponderEvent,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import Carousel from "react-native-reanimated-carousel";

const { width } = Dimensions.get("window");
const TAB_BAR_HEIGHT = 60; // Adjust this if your tab bar is taller

const mockAds = [
  {
    id: "1",
    uri: "https://picsum.photos/800/400?random=1",
    title: "Explore Margaret River",
    description: "Discover iconic wineries and their best vintages.",
  },
  {
    id: "2",
    uri: "https://picsum.photos/800/400?random=2",
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
      contentContainerStyle={{ alignItems: "center", paddingTop: 40, paddingBottom: TAB_BAR_HEIGHT + 20 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Text style={styles.header}>SipLocal</Text>

      {/* Floating carousel */}
      <View style={styles.carouselWrapper}>
        <Carousel
          loop
          width={width * 0.9}
          height={300}
          autoPlay
          data={mockAds}
          scrollAnimationDuration={3000}
          renderItem={({ item }) => (
            <Pressable
              style={styles.carouselCard}
              onPressIn={handlePressIn}
              onPress={handlePress}
            >
              <Image source={{ uri: item.uri }} style={styles.image} />
              <View style={styles.captionBox}>
                <Text style={styles.captionTitle}>{item.title}</Text>
                <Text style={styles.captionText}>{item.description}</Text>
              </View>
            </Pressable>
          )}
        />
      </View>

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
        <Text style={styles.sectionDescription}>Curated by a local wine expert</Text>

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#723FEB",
    marginBottom: 20,
    alignSelf: "flex-start",
    paddingHorizontal: 20,
  },
  carouselWrapper: {
    width: "100%",
    alignItems: "center",
    marginBottom: 30,
  },
  carouselCard: {
    borderRadius: 16,
    backgroundColor: "#fff",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  image: {
    width: "100%",
    height: 200,
    resizeMode: "cover",
  },
  captionBox: {
    backgroundColor: "#fff",
    padding: 12,
  },
  captionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
    color: "#723FEB",
  },
  captionText: {
    fontSize: 14,
    color: "#444",
  },
  learnWrapper: {
    width: "100%",
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#723FEB",
    marginLeft: 20,
    marginBottom: 12,
  },
  sectionTitleLarge: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#723FEB",
    marginLeft: 20,
    marginBottom: 4,
  },
  sectionDescription: {
    fontSize: 14,
    color: "#555",
    marginLeft: 20,
    marginBottom: 12,
  },
  learnScroll: {
    paddingHorizontal: 20,
    gap: 15,
  },
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
  learnCardImage: {
    width: "100%",
    height: 120,
    borderRadius: 12,
    marginBottom: 8,
  },
  cardsWrapper: {
    width: "90%",
    gap: 20,
    marginBottom: 20,
  },
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
    fontWeight: "bold",
    marginBottom: 6,
    color: "#723FEB",
  },
    cardText: {
      fontSize: 13,
      color: "#555",
    },
  });