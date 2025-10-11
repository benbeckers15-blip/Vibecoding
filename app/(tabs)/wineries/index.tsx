import { Link } from "expo-router";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";
import { db } from "../../../firebaseConfig";

type Winery = {
  id: string;
  name: string;
  slug: string;
  rating?: number;
  userRatingsTotal?: number;
};

export default function WineriesScreen() {
  const [wineries, setWineries] = useState<Winery[]>([]);
  const [ratings, setRatings] = useState<{ [key: string]: { rating: number; userRatingsTotal: number } }>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortByRating, setSortByRating] = useState(false);

  useEffect(() => {
    const fetchWineriesAndRatings = async () => {
      try {
        // 🔹 Fetch wineries
        const snapshot = await getDocs(collection(db, "wineries"));
        const wineryData: Winery[] = snapshot.docs.map((doc) => {
          const docData = doc.data();
          return {
            id: doc.id,
            name: docData.name || "",
            slug: docData.slug || doc.id,
          };
        });

        // 🔹 Fetch ratings from googleRatings/latest
        const ratingsDoc = await getDoc(doc(db, "googleRatings", "latest"));
        const ratingsData = ratingsDoc.exists() ? ratingsDoc.data() : {};
        setRatings(ratingsData);

        // 🔹 Merge ratings into wineries
        const merged = wineryData.map((w) => ({
          ...w,
          rating: ratingsData[w.id]?.rating || null,
          userRatingsTotal: ratingsData[w.id]?.userRatingsTotal || 0,
        }));

        setWineries(merged);
      } catch (err) {
        console.error("Error fetching wineries or ratings:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchWineriesAndRatings();
  }, []);

  // 🧠 Filter matches starting with search input
  const filtered = wineries
    .filter((w) =>
      w.name.toLowerCase().startsWith(search.trim().toLowerCase())
    )
    .sort((a, b) => {
      if (sortByRating) {
        const aRating = a.rating || 0;
        const bRating = b.rating || 0;
        return bRating - aRating;
      } else {
        return a.name.localeCompare(b.name);
      }
    });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#723FEB" />
        <Text>Loading wineries...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search wineries..."
        value={search}
        onChangeText={setSearch}
      />

      {/* 🧭 Toggle between alphabetical / rating */}
      <View style={styles.toggleContainer}>
        <Text style={styles.toggleLabel}>
          Sort by: {sortByRating ? "⭐ Rating" : "🔤 Name"}
        </Text>
        <Switch
          value={sortByRating}
          onValueChange={setSortByRating}
          thumbColor={sortByRating ? "#FFD700" : "#ccc"}
          trackColor={{ false: "#ddd", true: "#723FEB" }}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Link href={`/wineries/${item.slug}?from=wineries`} asChild>
            <Pressable style={styles.card}>
              <Text style={styles.cardText}>{item.name}</Text>
              {item.rating && (
                <Text style={styles.rating}>⭐ {item.rating.toFixed(1)}</Text>
              )}
            </Pressable>
          </Link>
        )}
      />

      {filtered.length === 0 && !loading && (
        <View style={styles.center}>
          <Text>No wineries found</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  search: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  toggleContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    backgroundColor: "#f8f8f8",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  toggleLabel: { fontSize: 16, color: "#333", fontWeight: "500" },
  card: {
    padding: 16,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardText: { fontSize: 16, fontWeight: "500" },
  rating: { fontSize: 14, color: "#555" },
});
