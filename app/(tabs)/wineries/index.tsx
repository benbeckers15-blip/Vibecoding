import { Link } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

// Dummy winery data (later you’ll fetch this from Firebase)
const WINERIES = [
  { id: "1", name: "Vasse Felix" },
  { id: "2", name: "Oak Valley Winery" },
  { id: "3", name: "Silver Creek Estates" },
  { id: "4", name: "Red Hill Cellars" },
];

export default function WineriesScreen() {
  const [search, setSearch] = useState("");

  const filtered = WINERIES.filter((winery) =>
    winery.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <TextInput
        style={styles.search}
        placeholder="Search wineries..."
        value={search}
        onChangeText={setSearch}
      />

      {/* Winery list */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Link href={`/wineries/${item.id}`} asChild>
            <Pressable style={styles.card}>
              <Text style={styles.cardText}>{item.name}</Text>
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },
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
