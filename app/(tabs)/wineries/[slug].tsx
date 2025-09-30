// app/(tabs)/wineries/[slug].tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

// Dummy details data (replace with Firestore later)
const WINERY_DETAILS: Record<
  string,
  { name: string; images: string[]; description: string[] }
> = {
  "vasse-felix": {
    name: "Vasse Felix",
    images: [
      "https://picsum.photos/400/200?1",
      "https://picsum.photos/400/200?2",
      "https://picsum.photos/400/200?3",
    ],
    description: [
      "Vasse Felix is one of the oldest wineries in Margaret River.",
      "It specializes in Chardonnay and Cabernet Sauvignon.",
      "Guests enjoy tours, tastings, and seasonal events on the estate.",
    ],
  },
  "oak-valley": {
    name: "Oak Valley Winery",
    images: ["https://picsum.photos/400/200?4", "https://picsum.photos/400/200?5"],
    description: [
      "Known for its oak-aged reds.",
      "Family-owned for three generations.",
    ],
  },
  // add more wineries...
};

export default function WineryDetailsScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();

  const winery = slug ? WINERY_DETAILS[slug] : undefined;

  if (!winery) {
    return (
      <View style={styles.center}>
        <Text>Winery not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Back button */}
    <Pressable
  onPress={() => {
    if (router.canGoBack()) {
      router.back(); // go back if there's history
    } else {
      router.replace("/wineries"); // fallback to Wineries tab
    }
  }}
  style={({ pressed }) => [
    styles.backButton,
    pressed && { opacity: 0.6 },
  ]}
>
  <Text style={styles.backButtonText}>← Back</Text>
</Pressable>


      {/* Slideshow */}
      {winery.images.map((uri, idx) => (
        <Image key={idx} source={{ uri }} style={styles.image} />
      ))}

      <Text style={styles.title}>{winery.name}</Text>

      {winery.description.map((para, idx) => (
        <Text key={idx} style={styles.paragraph}>
          {para}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  image: { width: "100%", height: 200, marginBottom: 10 },
  title: { fontSize: 22, fontWeight: "bold", margin: 16 },
  paragraph: {
    fontSize: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    lineHeight: 22,
  },
  backButton: {
    margin: 16,
    padding: 8,
    backgroundColor: "#eee",
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  backButtonText: { fontSize: 16 },
});
