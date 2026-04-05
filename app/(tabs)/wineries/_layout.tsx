import { Stack } from "expo-router";

export default function WineriesLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="[slug]"
        options={{
          headerTransparent: true,
          headerTitle: "",
          headerTintColor: "#fff",
        }}
      />
    </Stack>
  );
}




