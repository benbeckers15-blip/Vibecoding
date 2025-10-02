// app/(tabs)/home/index.tsx
import { useRouter } from "expo-router";
import { useRef } from "react";
import {
  Dimensions,
  GestureResponderEvent,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Carousel from "react-native-reanimated-carousel";

const { width } = Dimensions.get("window");

const mockAds = [
  { id: "1", uri: "https://picsum.photos/800/400?random=1" },
  { id: "2", uri: "https://picsum.photos/800/400?random=2" },
  { id: "3", uri: "https://picsum.photos/800/400?random=3" },
  { id: "4", uri: "https://picsum.photos/800/400?random=4" },
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
    <View style={styles.container}>
      {/* Floating carousel */}
      <View style={styles.carouselWrapper}>
        <Carousel
          loop
          width={width * 0.9}
          height={200}
          autoPlay
          data={mockAds}
          scrollAnimationDuration={1000}
          renderItem={({ item }) => (
            <Pressable
              style={styles.slide}
              onPressIn={handlePressIn}
              onPress={handlePress}
            >
              <Image source={{ uri: item.uri }} style={styles.image} />
            </Pressable>
          )}
        />
      </View>

      {/* Cards Section */}
      <View style={styles.cardsWrapper}>
        {/* Card 1 */}
        <Pressable style={styles.card} onPress={() => router.push("/events")}>
          <Text style={styles.cardTitle}>Upcoming Events</Text>
          <Text style={styles.cardText}>
            Discover wine festivals, tastings, and more.
          </Text>
        </Pressable>

        {/* Card 2 */}
        <Pressable style={styles.card} onPress={() => router.push("/specials")}>
          <Text style={styles.cardTitle}>Exclusive Specials</Text>
          <Text style={styles.cardText}>
            Browse limited-time winery deals.
          </Text>
        </Pressable>

        {/* Row of two cards */}
        <View style={styles.row}>
          {/* Somm's Picks */}
          <Pressable
            style={[styles.smallCard, { marginRight: 10 }]}
            onPress={() => router.push("/somms-picks")}
          >
            <Text style={styles.cardTitle}>Somm's Picks</Text>
            <Text style={styles.cardText}>
              Curated by sommeliers: the best of Margaret River wines.
            </Text>
          </Pressable>

          {/* Private Dinners */}
          <Pressable
            style={[styles.smallCard, { marginLeft: 10 }]}
            onPress={() => router.push("/private-dinners")}
          >
            <Text style={styles.cardTitle}>Private Dinners</Text>
            <Text style={styles.cardText}>
              Book intimate in-home dinners with guided wine tastings.
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 40,
  },
  carouselWrapper: {
    width: "100%",
    alignItems: "center",
    marginBottom: 30,
  },
  slide: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },
  image: {
    width: "100%",
    height: 200,
    resizeMode: "cover",
  },
  cardsWrapper: {
    width: "90%",
    gap: 20,
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
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  smallCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 6,
    color: "#720969",
  },
  cardText: {
    fontSize: 13,
    color: "#555",
  },
});



