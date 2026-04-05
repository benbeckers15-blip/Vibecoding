// app/(tabs)/events/index.tsx
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { db } from "../../../firebaseConfig";

type Event = {
  id: string;
  title?: string;
  wineryName?: string;
  winerySlug?: string;
  date?: string;
  description?: string;
  image?: string;
};

export default function EventsScreen() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const snapshot = await getDocs(collection(db, "events"));
        const eventsList: Event[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setEvents(eventsList);
      } catch (error) {
        console.error("Error fetching events:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, []);

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#1a1a1a" />
        <Text style={styles.loadingText}>Loading events...</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={events}
      keyExtractor={(item) => item.id}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.list}
      ListHeaderComponent={() => (
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.headerLabel}>CALENDAR</Text>
          <Text style={styles.headerTitle}>Events</Text>
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>
              {events.length} {events.length === 1 ? "EVENT" : "EVENTS"}
            </Text>
            <View style={styles.dividerLine} />
          </View>
        </View>
      )}
      ListEmptyComponent={() => (
        <View style={styles.empty}>
          <Text style={styles.emptyLabel}>NO EVENTS</Text>
          <Text style={styles.emptyText}>Check back soon for upcoming events.</Text>
        </View>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => (
        <Pressable
          style={styles.card}
          onPress={() =>
            item.winerySlug
              ? router.push(`/wineries/${item.winerySlug}?from=events`)
              : null
          }
        >
          {item.image ? (
            <View style={styles.imageWrapper}>
              <Image source={{ uri: item.image }} style={styles.image} />
              <LinearGradient
                colors={["transparent", "rgba(0,0,0,0.65)"]}
                style={styles.gradient}
              />
              {item.date && (
                <Text style={styles.imageDate}>{item.date.toUpperCase()}</Text>
              )}
            </View>
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>🍷</Text>
            </View>
          )}

          <View style={styles.content}>
            {item.wineryName ? (
              <Text style={styles.wineryLabel}>
                {item.wineryName.toUpperCase()}
              </Text>
            ) : (
              <Text style={styles.wineryLabel}>GENERAL EVENT</Text>
            )}
            <Text style={styles.title}>{item.title}</Text>
            {item.description && (
              <Text style={styles.description} numberOfLines={2}>
                {item.description}
              </Text>
            )}
            {item.winerySlug && (
              <View style={styles.ctaRow}>
                <Text style={styles.ctaText}>LEARN MORE</Text>
                <Text style={styles.ctaArrow}>›</Text>
              </View>
            )}
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    gap: 12,
  },
  loadingText: {
    fontSize: 11,
    letterSpacing: 2,
    color: "#999",
  },
  list: {
    backgroundColor: "#fff",
    paddingBottom: 120,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  headerLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    marginBottom: 6,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: "700",
    fontFamily: "Georgia",
    color: "#1a1a1a",
    marginBottom: 20,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
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
  card: {
    backgroundColor: "#fff",
    marginHorizontal: 24,
  },
  imageWrapper: {
    position: "relative",
    height: 220,
  },
  image: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  gradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 80,
  },
  imageDate: {
    position: "absolute",
    bottom: 12,
    right: 14,
    fontSize: 9,
    letterSpacing: 2,
    color: "rgba(255,255,255,0.85)",
  },
  imagePlaceholder: {
    height: 120,
    backgroundColor: "#f5f5f0",
    justifyContent: "center",
    alignItems: "center",
  },
  imagePlaceholderText: {
    fontSize: 32,
  },
  content: {
    paddingVertical: 16,
  },
  wineryLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#999",
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Georgia",
    color: "#1a1a1a",
    marginBottom: 8,
    lineHeight: 28,
  },
  description: {
    fontSize: 13,
    color: "#666",
    lineHeight: 20,
    marginBottom: 12,
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ctaText: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#1a1a1a",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    paddingBottom: 1,
  },
  ctaArrow: {
    fontSize: 14,
    color: "#1a1a1a",
  },
  separator: {
    height: 1,
    backgroundColor: "#f0f0f0",
    marginHorizontal: 24,
    marginVertical: 8,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
  },
  emptyLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#ccc",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#999",
  },
});