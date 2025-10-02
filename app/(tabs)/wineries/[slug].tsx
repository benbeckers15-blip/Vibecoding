// app/(tabs)/wineries/[slug].tsx
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Dimensions, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Carousel from "react-native-reanimated-carousel";

const { width } = Dimensions.get("window");

// Dummy details data (replace with Firestore later)
const WINERY_DETAILS: Record<
  string,
  {
    name: string;
    images: string[];
    description: string[];
    phone: string;
    website: string;
    hours: string;
  }
> = {
  "vasse-felix": {
    name: "Vasse Felix",
    images: [
      "https://picsum.photos/400/200?1",
      "https://picsum.photos/400/200?2",
      "https://picsum.photos/400/200?3",
    ],
    description: [
      "I stole a lot of wine from here.",
      "Also banged the manager.",
    ],
    phone: "+61 8 1234 5678",
    website: "https://www.vassefelix.com.au",
    hours: "Mon–Sun: 10:00 AM – 5:00 PM",
  },
  "oak-valley": {
    name: "Oak Valley Winery",
    images: ["https://picsum.photos/400/200?4", "https://picsum.photos/400/200?5"],
    description: [
      "Known for its oak-aged reds.",
      "Family-owned for three generations.",
    ],
    phone: "+61 8 9876 5432",
    website: "https://www.oakvalley.com",
    hours: "Wed–Sun: 11:00 AM – 6:00 PM",
  },
};

export default function WineryDetailsScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const winery = slug ? WINERY_DETAILS[slug] : undefined;
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!winery) {
    return (
      <View style={styles.center}>
        <Text>Winery not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Image Carousel */}
      <Carousel
        width={width}
        height={220}
        data={winery.images}
        loop
        autoPlay
        autoPlayInterval={3000}
        scrollAnimationDuration={800}
        onSnapToItem={(index) => setCurrentIndex(index)}
        renderItem={({ item }) => (
          <Image source={{ uri: item }} style={styles.image} />
        )}
      />

      {/* Pagination Dots */}
      <View style={styles.dotsContainer}>
        {winery.images.map((_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              currentIndex === index && styles.activeDot,
            ]}
          />
        ))}
      </View>

      {/* Info Container */}
      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>{winery.name}</Text>

        <Pressable onPress={() => Linking.openURL(`tel:${winery.phone}`)}>
          <Text style={styles.link}>📞 {winery.phone}</Text>
        </Pressable>

        <Pressable onPress={() => Linking.openURL(winery.website)}>
          <Text style={styles.link}>🌐 Visit Website</Text>
        </Pressable>

        <Text style={styles.hours}>⏰ {winery.hours}</Text>
      </View>

      {/* Descriptions */}
      {winery.description.map((para, idx) => (
        <Text key={idx} style={styles.paragraph}>
          {para}
        </Text>
      ))}
    </ScrollView>
  );
}

// Dynamic header title
export const options = ({ route }: { route: { params?: { slug?: string } } }) => {
  const slug = route.params?.slug;
  const winery = slug ? WINERY_DETAILS[slug] : undefined;

  return {
    headerTitle: winery ? winery.name : "Winery Details",
  };
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  image: {
    width: width,
    height: 220,
    resizeMode: "cover",
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginVertical: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ccc",
    marginHorizontal: 4,
  },
  activeDot: {
    backgroundColor: "#720969",
    width: 10,
    height: 10,
  },
  infoBox: {
    backgroundColor: "#f8f8f8",
    padding: 16,
    margin: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 10,
    color: "#720969",
  },
  link: {
    fontSize: 16,
    color: "#0066cc",
    marginBottom: 8,
  },
  hours: {
    fontSize: 15,
    color: "#444",
    marginTop: 4,
  },
  paragraph: {
    fontSize: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    lineHeight: 22,
  },
});
 
