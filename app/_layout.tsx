// app/_layout.tsx
import { Stack } from "expo-router";
import { addDoc, collection, getDocs } from "firebase/firestore";
import { useEffect } from "react";
import { db } from "../firebaseConfig"; // make sure you created firebaseConfig.ts in your root

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

export default function RootLayout() {
  useEffect(() => {
    async function testFirestore() {
      try {
        // Write a test doc
        const docRef = await addDoc(collection(db, "testCollection"), {
          text: "Hello from Expo Router + Firestore!",
          createdAt: new Date(),
        });
        console.log("✅ Firestore document written with ID:", docRef.id);

        // Read docs back
        const querySnapshot = await getDocs(collection(db, "testCollection"));
        querySnapshot.forEach((doc) => {
          console.log("📄", doc.id, " => ", doc.data());
        });
      } catch (error) {
        console.error("❌ Firestore error:", error);
      }
    }

    testFirestore();
  }, []);

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
