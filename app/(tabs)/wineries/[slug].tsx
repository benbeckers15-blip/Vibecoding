import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  ImageBackground,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Carousel from "react-native-reanimated-carousel";
import { db } from "../../../firebaseConfig";
import { fetchPlaceDetails } from "../../../lib/googlePlaces"; // ✅ Import the helper

const { width } = Dimensions.get("window");

interface WineryData {
  name: string;
  images: string[];
  description: string[];
  phone: string;
  website: string;
  hours: string;
  googlePlaceId?: string;
  latitude?: number;
  longitude?: number;
}

export default function WineryDetailsScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [winery, setWinery] = useState<WineryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  // ✅ Fetch Firestore + Google Places
  useEffect(() => {
    if (!slug) return;

    const fetchWinery = async () => {
      try {
        const docRef = doc(db, "wineries", slug);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          console.warn("No such winery found!");
          setLoading(false);
          return;
        }

        const data = docSnap.data();
        let mergedData: WineryData = {
          name: data.name || "Unnamed Winery",
          images: Array.isArray(data.images) ? data.images : [],
          description: Array.isArray(data.description)
            ? data.description
            : [String(data.description || "")],
          phone: data.phone || "N/A",
          website: data.website || "",
          hours: data.hours || "N/A",
          googlePlaceId: data.googlePlaceId || null,
        };

        // 🌐 Merge Google API data
        if (mergedData.googlePlaceId) {
          try {
            const gData = await fetchPlaceDetails(mergedData.googlePlaceId);

            mergedData = {
              ...mergedData,
              phone: gData.formatted_phone_number || mergedData.phone,
              website: gData.website || mergedData.website,
              hours:
                gData.opening_hours?.weekday_text?.join("\n") ||
                mergedData.hours,
              latitude: gData.geometry?.location?.lat,
              longitude: gData.geometry?.location?.lng,
              images:
                mergedData.images.length > 0
                  ? mergedData.images
                  : gData.photos?.map(
                      (p: any) =>
                        `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photoreference=${p.photo_reference}&key=${process.env.EXPO_PUBLIC_GOOGLE_API_KEY}`
                    ) || [],
            };
          } catch (err) {
            console.warn("Google API fetch failed:", err);
          }
        }

        setWinery(mergedData);
      } catch (error) {
        console.error("Error fetching winery:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchWinery();
  }, [slug]);

  // ⏳ Loading
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#723FEB" />
        <Text>Loading winery details...</Text>
      </View>
    );
  }

  // ❌ Not Found
  if (!winery) {
    return (
      <View style={styles.center}>
        <Text>Winery not found</Text>
      </View>
    );
  }

  // ✅ Main UI
  return (
    <ScrollView style={styles.container}>
      {/* 🖼 Hero Carousel */}
      <View style={styles.heroContainer}>
        {winery.images.length > 0 ? (
          <Carousel
            width={width}
            height={260}
            data={winery.images}
            loop
            autoPlay
            autoPlayInterval={4000}
            scrollAnimationDuration={800}
            onSnapToItem={(index) => setCurrentIndex(index)}
            mode="parallax"
            modeConfig={{
              parallaxScrollingScale: 0.9,
              parallaxScrollingOffset: 50,
            }}
            renderItem={({ item }) => (
              <View style={styles.heroCard}>
                <ImageBackground
                  source={{ uri: String(item) }}
                  style={styles.heroImage}
                >
                  <LinearGradient
                    colors={["rgba(0,0,0,0.6)", "transparent"]}
                    style={styles.overlay}
                  />
                  <View style={styles.heroContent}>
                    <Text style={styles.heroTitle}>{winery.name}</Text>
                  </View>
                </ImageBackground>
              </View>
            )}
          />
        ) : (
          <View style={styles.heroPlaceholder}>
            <Text>No images available</Text>
          </View>
        )}

        {/* 🔵 Pagination Dots */}
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
      </View>

      {/* 📞 Info Section */}
      <View style={styles.infoBox}>
        {winery.phone !== "N/A" && (
          <Pressable onPress={() => Linking.openURL(`tel:${winery.phone}`)}>
            <Text style={styles.link}>📞 {winery.phone}</Text>
          </Pressable>
        )}

        {winery.website && (
          <Pressable onPress={() => Linking.openURL(winery.website)}>
            <Text style={styles.link}>🌐 Visit Website</Text>
          </Pressable>
        )}

        {winery.hours && <Text style={styles.hours}>⏰ {winery.hours}</Text>}

        {/* 🧭 Directions */}
        {(winery.latitude && winery.longitude) ? (
          <Pressable
            onPress={() =>
              Linking.openURL(
                `https://www.google.com/maps/dir/?api=1&destination=${winery.latitude},${winery.longitude}`
              )
            }
          >
            <Text style={[styles.link, { marginTop: 8 }]}>🧭 Get Directions</Text>
          </Pressable>
        ) : winery.name ? (
          <Pressable
            onPress={() =>
              Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  winery.name
                )}`
              )
            }
          >
            <Text style={[styles.link, { marginTop: 8 }]}>🧭 Get Directions</Text>
          </Pressable>
        ) : null}
      </View>

      {/* 📖 Descriptions */}
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
  heroContainer: { position: "relative" },
  heroCard: {
    borderRadius: 16,
    overflow: "hidden",
    marginHorizontal: 12,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  heroImage: {
    width: width - 24,
    height: 260,
    justifyContent: "flex-end",
  },
  overlay: { ...StyleSheet.absoluteFillObject },
  heroContent: { padding: 16 },
  heroTitle: { fontSize: 28, fontWeight: "700", color: "#fff" },
  heroPlaceholder: {
    height: 260,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#eee",
    borderRadius: 12,
    margin: 12,
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginVertical: 8,
    position: "absolute",
    bottom: 10,
    width: "100%",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ccc",
    marginHorizontal: 4,
  },
  activeDot: {
    backgroundColor: "#723FEB",
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
  link: { fontSize: 16, color: "#0066cc", marginBottom: 8 },
  hours: { fontSize: 15, color: "#444", marginTop: 4 },
  paragraph: {
    fontSize: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    lineHeight: 22,
  },
});


