// app/_layout.tsx
import {
  NunitoSans_400Regular,
  NunitoSans_600SemiBold,
} from "@expo-google-fonts/nunito-sans";
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_700Bold,
  useFonts,
} from "@expo-google-fonts/playfair-display";
import { Stack } from "expo-router";
import { useEffect } from "react";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    heading: PlayfairDisplay_700Bold,
    subHeading: PlayfairDisplay_400Regular,
    body: NunitoSans_400Regular,
    bodyBold: NunitoSans_600SemiBold,
  });

  useEffect(() => {
    async function testFirestore() {
      try {
        // Firestore test code
      } catch (error) {
        console.error("❌ Firestore error:", error);
      }
    }
    testFirestore();
  }, []);

  if (!fontsLoaded) {
    // Show nothing while fonts are loading
    return null;
  }

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

