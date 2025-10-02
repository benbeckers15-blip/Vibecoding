import { useRouter } from "expo-router";
import { FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";

// Dummy event data (replace with Firestore later)
const EVENTS = [
  {
    id: "1",
    title: "Wine Tasting & Live Music",
    wineryName: "Vasse Felix", // readable for users
    winerySlug: "vasse-felix", // used for routing
    date: "Oct 15, 2025",
    description: "Join us for an evening of Chardonnay tastings with a local jazz band.",
    image: "https://picsum.photos/400/200?random=1",
  },
  {
    id: "2",
    title: "Harvest Celebration",
    wineryName: "Oak Valley Winery",
    winerySlug: "oak-valley",
    date: "Oct 20, 2025",
    description: "Celebrate the harvest season with food trucks, live folk music, and wine specials.",
    image: "https://picsum.photos/400/200?random=2",
  },
  {
    id: "3",
    title: "Cabernet Sauvignon Masterclass",
    wineryName: "Leeuwin Estate",
    winerySlug: "leeuwin-estate",
    date: "Oct 22, 2025",
    description: "Learn from expert winemakers in this deep dive into cabernet sauvignon.",
    image: "https://picsum.photos/400/200?random=3",
  },
];

export default function EventsScreen() {
  const router = useRouter();

  return (
    <FlatList
      data={EVENTS}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable
          style={styles.card}
          // ✅ pass `from=events` as query param
          onPress={() => router.push(`/wineries/${item.winerySlug}?from=events`)}
        >
          {item.image && <Image source={{ uri: item.image }} style={styles.image} />}
          <View style={styles.content}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.subtitle}>{item.wineryName}</Text>
            <Text style={styles.date}>{item.date}</Text>
            <Text style={styles.description}>{item.description}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 16,
    backgroundColor: "#fff",
  },
  card: {
    marginBottom: 16,
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
    overflow: "hidden",
    elevation: 2, // shadow for Android
    shadowColor: "#000", // shadow for iOS
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  image: {
    width: "100%",
    height: 180,
  },
  content: {
    padding: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 4,
    color: "#720969",
  },
  subtitle: {
    fontSize: 16,
    fontStyle: "italic",
    color: "#444",
  },
  date: {
    marginTop: 4,
    fontSize: 14,
    color: "#888",
  },
  description: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 20,
  },
});
