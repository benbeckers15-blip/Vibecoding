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
      {/* Article screens — relocated from the former `articles` tab so that
          the back button from any article returns directly to the home
          screen instead of routing through a sibling tab's stack. */}
      <Stack.Screen
        name="articles/hidden-gems"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="articles/vintage-reports"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="articles/sommelier-recommendations"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="articles/behind-the-cellar-door"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="articles/pairings"
        options={{ headerShown: false }}
      />
      {/* Dynamic "filter collection" article — driven by the home screen's
          EXPLORE BY tiles. Route key matches a Firestore boolean field
          (e.g. dogFriendly, hasRestaurant). */}
      <Stack.Screen
        name="articles/collections/[key]"
        options={{ headerShown: false }}
      />
    </Stack>
  );
}
