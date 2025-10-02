// app/(tabs)/specials/_layout.tsx
import { Stack } from "expo-router";

export default function SpecialsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#720969" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "bold" },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Specials" }}
      />
    </Stack>
  );
}

