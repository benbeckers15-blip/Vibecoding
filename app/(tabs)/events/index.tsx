// app/(tabs)/events/index.tsx
import { useRouter } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { db } from "../../../firebaseConfig"; // 👈 adjust path if needed

export default function EventsScreen() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const snapshot = await getDocs(collection(db, "events"));
        const eventsList = snapshot.docs.map((doc) => ({
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#723FEB" />
      </View>
    );
  }

  return (
    <FlatList
      data={events}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable
          style={styles.card}
          onPress={() =>
            item.winerySlug
              ? router.push(`/wineries/${item.winerySlug}?from=events`)
              : null
          }
        >
          {item.image && <Image source={{ uri: item.image }} style={styles.image} />}
          <View style={styles.content}>
            <Text style={styles.title}>{item.title}</Text>
            {item.wineryName ? (
              <Text style={styles.subtitle}>{item.wineryName}</Text>
            ) : (
              <Text style={styles.subtitle}>General Event</Text>
            )}
            <Text style={styles.date}>{item.date}</Text>
            <Text style={styles.description}>{item.description}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  list: {
    padding: 16,
    backgroundColor: "#fff",
  },
  card: {
    marginBottom: 16,
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
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
    color: "#723FEB",
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
