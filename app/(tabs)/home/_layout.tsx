import { Stack } from "expo-router";

export default function HomeLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{ title: "Home", headerShown: false }}
      />
      <Stack.Screen
        name="pour"
        options={{ title: "The Tassie Pour", headerShown: false }}
      />
    </Stack>
  );
}
