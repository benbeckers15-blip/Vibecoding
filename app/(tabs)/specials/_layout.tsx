// app/(tabs)/specials/_layout.tsx
import { Stack } from "expo-router";

export default function SpecialsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}

