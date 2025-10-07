import { collection, getDocs } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { db } from "../../../firebaseConfig";



export default function SpecialsScreen() {
  const [loading, setLoading] = useState(true);
  const [specials, setSpecials] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSpecials = async () => {
      try {
        console.log("🔄 Connecting to Firestore...");
        const querySnapshot = await getDocs(collection(db, "specials")); // 👈 your collection name
        const data = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        console.log("✅ Connected to Firestore, fetched:", data.length, "documents");
        setSpecials(data);
      } catch (err: any) {
        console.error("❌ Firestore failed:", err.message);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSpecials();
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#800020" />
        <Text style={styles.text}>Loading Firestore...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={[styles.text, { color: "red" }]}>
          Firestore connection failed: {error}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>🍷 Firestore Specials Test</Text>
      {specials.length > 0 ? (
        specials.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.title}>{item.name || "Unnamed Special"}</Text>
            <Text style={styles.desc}>{item.description || "No description"}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.text}>No specials found in Firestore.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 20,
    color: "#800020",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  desc: {
    marginTop: 4,
    color: "#666",
  },
  text: {
    fontSize: 16,
    color: "#555",
  },
});
