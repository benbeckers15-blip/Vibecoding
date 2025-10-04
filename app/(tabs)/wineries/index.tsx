import { Link } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { db } from "../../../firebaseConfig"; // adjust if needed

type Winery = {
  id: string;
  name: string;
  slug: string;
};

export default function WineriesScreen() {
  const [wineries, setWineries] = useState<Winery[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWineries = async () => {
      try {
        const snapshot = await getDocs(collection(db, "wineries"));
        const data: Winery[] = snapshot.docs.map((doc) => {
          const docData = doc.data();
          return {
            id: doc.id,
            name: docData.name || "",
            slug: docData.slug || doc.id, // fallback to doc ID just in case
          };
        });
        setWineries(data);
      } catch (err) {
        console.error("Error fetching wineries:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchWineries();
  }, []);

  const filtered =
    wineries.length > 0
      ? wineries.filter((winery) =>
          winery.name
            ?.toLowerCase()
            .includes(search.trim().toLowerCase())
        )
      : [];

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

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Link href={`/wineries/${item.slug}?from=wineries`} asChild>
            <Pressable style={styles.card}>
              <Text style={styles.cardText}>{item.name}</Text>
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
  card: {
    padding: 16,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    marginBottom: 10,
  },
  cardText: { fontSize: 16, fontWeight: "500" },
});
