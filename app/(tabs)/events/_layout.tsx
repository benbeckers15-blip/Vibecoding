// app/(tabs)/events/_layout.tsx
import { Stack } from "expo-router";

export default function EventsLayout() {
  return (
    <Stack>
      {/* Events list */}
      <Stack.Screen
        name="index"
        options={{
          title: "Events",
          headerShown: false,
        }}
      />

      {/* Optional: if you later want event details */}
      {/* <Stack.Screen
        name="[id]"
        options={{
          title: "Event Details",
          gestureEnabled: true,
        }}
      /> */}
    </Stack>
  );
}
