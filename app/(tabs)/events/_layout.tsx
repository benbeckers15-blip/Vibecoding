// app/(tabs)/events/_layout.tsx
import { Stack } from "expo-router";

export default function EventsLayout() {
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
        options={{
          title: "Events",
        }}
      />
    </Stack>
  );
}

