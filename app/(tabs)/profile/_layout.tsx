// app/(tabs)/profile/_layout.tsx
import { Stack } from "expo-router";

export default function ProfileLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      {/* Apple guideline 5.1.1(v): in-app account deletion. */}
      <Stack.Screen name="delete-account" />
    </Stack>
  );
}
