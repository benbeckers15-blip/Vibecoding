// app/(tabs)/articles/_layout.tsx
// Stack for the editorial article screens. Each section (hidden gems,
// vintage reports, sommelier picks, behind the cellar door, pairings) is
// its own screen but shares the same renderer pipeline under the hood.
import { Stack } from "expo-router";

export default function ArticlesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="hidden-gems" />
      <Stack.Screen name="vintage-reports" />
      <Stack.Screen name="sommelier-recommendations" />
      <Stack.Screen name="behind-the-cellar-door" />
      <Stack.Screen name="pairings" />
    </Stack>
  );
}
