import { Stack } from "expo-router";

// Every screen in the home stack ships its own custom header (the dark glass
// "Home" back button overlaid on the hero photo), so the default expo-router
// Stack header would render as a redundant grey bar above it. Disable it
// across the whole stack — individual screens that DO want the system header
// can opt back in with `headerShown: true`.
export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: "Home" }} />
      <Stack.Screen name="pour" options={{ title: "The Tassie Pour" }} />
    </Stack>
  );
}
