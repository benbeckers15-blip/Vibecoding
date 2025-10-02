import { Stack } from "expo-router";

export default function WineriesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#720969" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "bold" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Wineries" }} />
      <Stack.Screen
        name="[slug]"
        options={({ route }) => {
          const slug = (route.params as { slug?: string })?.slug;
          // For now: just transform slug → readable text
          return { title: slug ? slug.replace(/-/g, " ") : "Winery Details" };
        }}
      />
    </Stack>
  );
}




