import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";

function safeOpenURL(url: string) {
  const trimmed = url.trim();
  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  Linking.openURL(withProtocol).catch(() => {
    console.warn("Could not open URL:", withProtocol);
  });
}
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

const { width } = Dimensions.get("window");

interface WineryData {
  name: string;
  images: string[];
  description: string[];
  phone: string;
  website: string;
  hours: string;
}

export default function WineryDetailsScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [winery, setWinery] = useState<WineryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!slug) return;

    const fetchWinery = async () => {
      try {
        const docRef = doc(db, "wineries", slug);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setWinery({
            name: data.name || "Unnamed Winery",
            images: Array.isArray(data.images) ? data.images : [],
            description: Array.isArray(data.description)
              ? data.description
              : [String(data.description || "")],
            phone: (data.phone || "N/A").trim(),
            website: (data.website || "").trim(),
            hours: data.hours || "N/A",
          });
        } else {
          console.warn("No such winery found!");
        }
      } catch (error) {
        console.error("Error fetching winery:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchWinery();
  }, [slug]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a1a1a" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!winery) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFoundLabel}>WINERY NOT FOUND</Text>
        <Text style={styles.notFoundText}>
          This winery could not be loaded.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero Carousel */}
      <View style={styles.heroContainer}>
        {winery.images.length > 0 ? (
          <Carousel
            width={width}
            height={380}
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
              <ImageBackground
                source={{ uri: String(item) }}
                style={styles.heroImage}
              >
                <LinearGradient
                  colors={["transparent", "rgba(0,0,0,0.75)"]}
                  style={styles.heroGradient}
                />
                <View style={styles.heroContent}>
                  <Text style={styles.heroRegion}>MARGARET RIVER</Text>
                  <Text style={styles.heroTitle}>{winery.name}</Text>
                </View>
              </ImageBackground>
            )}
          />
        ) : (
          <View style={styles.heroPlaceholder}>
            <Text style={styles.heroPlaceholderText}>🍷</Text>
            <Text style={styles.heroPlaceholderName}>{winery.name}</Text>
          </View>
        )}

        {/* Pagination dashes */}
        {winery.images.length > 1 && (
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
        )}
      </View>

      {/* Info Grid */}
      <View style={styles.infoGrid}>
        <View style={styles.infoCell}>
          <Text style={styles.infoCellLabel}>HOURS</Text>
          <Text style={styles.infoCellValue}>{winery.hours}</Text>
        </View>

        <View style={[styles.infoCell, styles.infoCellBorderLeft]}>
          <Text style={styles.infoCellLabel}>LOCATION</Text>
          <Text style={styles.infoCellValue}>Margaret River</Text>
        </View>
      </View>

      {/* Contact Buttons */}
      <View style={styles.contactRow}>
        {winery.phone !== "N/A" && (
          <Pressable
            style={styles.contactButton}
            onPress={() => Linking.openURL(`tel:${winery.phone.replace(/\s/g, "")}`).catch(() => console.warn("Could not open phone link"))}
          >
            <Text style={styles.contactButtonText}>CALL</Text>
            <Text style={styles.contactButtonSub}>{winery.phone}</Text>
          </Pressable>
        )}

        {winery.website ? (
          <Pressable
            style={[
              styles.contactButton,
              winery.phone !== "N/A" && styles.contactButtonBorderLeft,
            ]}
            onPress={() => safeOpenURL(winery.website)}
          >
            <Text style={styles.contactButtonText}>WEBSITE</Text>
            <Text style={styles.contactButtonSub}>Visit Online</Text>
          </Pressable>
        ) : null}
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>ABOUT</Text>
          <View style={styles.dividerLine} />
        </View>

        {winery.description.map((para, idx) => (
          <Text key={idx} style={styles.paragraph}>
            {para}
          </Text>
        ))}
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
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    gap: 10,
  },
  loadingText: {
    fontSize: 11,
    letterSpacing: 2,
    color: "#999",
  },
  notFoundLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#ccc",
    marginBottom: 8,
  },
  notFoundText: {
    fontSize: 14,
    color: "#999",
  },

  // Hero
  heroContainer: {
    position: "relative",
  },
  heroImage: {
    width: width,
    height: 380,
    justifyContent: "flex-end",
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroContent: {
    padding: 24,
    paddingBottom: 32,
  },
  heroRegion: {
    fontSize: 9,
    letterSpacing: 3,
    color: "rgba(255,255,255,0.7)",
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: "700",
    fontFamily: "Georgia",
    color: "#fff",
    lineHeight: 38,
  },
  heroPlaceholder: {
    height: 380,
    backgroundColor: "#f5f5f0",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  heroPlaceholderText: {
    fontSize: 48,
  },
  heroPlaceholderName: {
    fontSize: 24,
    fontFamily: "Georgia",
    color: "#1a1a1a",
  },

  // Pagination
  dotsContainer: {
    position: "absolute",
    bottom: 16,
    right: 20,
    flexDirection: "row",
    gap: 4,
  },
  dot: {
    width: 16,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.4)",
    borderRadius: 1,
  },
  activeDot: {
    width: 24,
    backgroundColor: "#fff",
  },

  // Info Grid
  infoGrid: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderTopWidth: 1,
    borderColor: "#e0e0e0",
  },
  infoCell: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  infoCellBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: "#e0e0e0",
  },
  infoCellLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    marginBottom: 6,
  },
  infoCellValue: {
    fontSize: 13,
    color: "#1a1a1a",
    fontWeight: "500",
  },

  // Contact
  contactRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#e0e0e0",
  },
  contactButton: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  contactButtonBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: "#e0e0e0",
  },
  contactButtonText: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    marginBottom: 4,
  },
  contactButtonSub: {
    fontSize: 13,
    color: "#1a1a1a",
    fontWeight: "500",
  },

  // About
  section: {
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e0e0e0",
  },
  dividerLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    marginHorizontal: 12,
  },
  paragraph: {
    fontSize: 15,
    color: "#444",
    lineHeight: 26,
    marginBottom: 16,
    fontFamily: "Georgia",
  },
});