// app/_layout.tsx
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Text, TextInput } from "react-native";

import { BebasNeue_400Regular } from "@expo-google-fonts/bebas-neue";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_400Regular_Italic,
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_600SemiBold_Italic,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_700Bold_Italic,
} from "@expo-google-fonts/playfair-display";

import { fonts } from "../constants/theme";
import { AuthProvider } from "../context/AuthContext";
import { SavedProvider } from "../context/SavedContext";
import { TripProvider } from "../context/TripContext";

// Keep the splash screen visible until fonts are loaded so we never flash
// the system font. Errors here are non-fatal (e.g. already prevented).
SplashScreen.preventAutoHideAsync().catch(() => {});

// Set DM Sans as the default font for every <Text> / <TextInput> in the app.
// Anything that explicitly sets `fontFamily` (e.g. headlines using Playfair
// Display) overrides this default — so titles stay serif, body stays sans.
function applyDefaultFontFamily() {
  // Cast to any: defaultProps still works on RN's Text/TextInput components
  // even though it's deprecated for function components.
  const T = Text as unknown as { defaultProps?: { style?: object } };
  T.defaultProps = T.defaultProps || {};
  T.defaultProps.style = [{ fontFamily: fonts.sans }, T.defaultProps.style];

  const TI = TextInput as unknown as { defaultProps?: { style?: object } };
  TI.defaultProps = TI.defaultProps || {};
  TI.defaultProps.style = [{ fontFamily: fonts.sans }, TI.defaultProps.style];
}

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_400Regular_Italic,
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_600SemiBold_Italic,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_700Bold_Italic,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    BebasNeue_400Regular,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      applyDefaultFontFamily();
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <AuthProvider>
      <SavedProvider>
        <TripProvider>
          {/* Light status-bar text — the dark theme uses near-black surfaces
              throughout, so the OS status bar (clock, signal, battery) needs
              to render in light glyphs to remain legible. */}
          <StatusBar style="light" />
          <Stack>
            {/* Main tab navigator */}
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            {/* Auth screen — presented full-screen, no header */}
            <Stack.Screen name="auth" options={{ headerShown: false }} />
            {/* Active-trip experience — full-screen modal route */}
            <Stack.Screen
              name="trip-active"
              options={{ headerShown: false, presentation: "modal" }}
            />
          </Stack>
        </TripProvider>
      </SavedProvider>
    </AuthProvider>
  );
}
