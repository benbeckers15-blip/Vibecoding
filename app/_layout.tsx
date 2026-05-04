// app/_layout.tsx
import { Stack } from "expo-router";
import { AuthProvider } from "../context/AuthContext";
import { SavedProvider } from "../context/SavedContext";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

export default function RootLayout() {
  return (
    <AuthProvider>
      <SavedProvider>
        <Stack>
          {/* Main tab navigator */}
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* Auth screen — presented full-screen, no header */}
          <Stack.Screen name="auth" options={{ headerShown: false }} />
        </Stack>
      </SavedProvider>
    </AuthProvider>
  );
}
