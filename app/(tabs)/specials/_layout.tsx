import { Stack } from "expo-router";

export default function SpecialsLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{ title: "Specials", headerShown: false }}
      />
    </Stack>
  );
}
