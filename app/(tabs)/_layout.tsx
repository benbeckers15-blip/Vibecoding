import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

// Capitalizes the first letter of each word in the tab button string
function toTitleCase(str: string) {
  return str.replace(
    /\w\S*/g,
    (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => {
        let label = toTitleCase(route.name);

        let iconName = "home";
        if (route.name === "events") iconName = "calendar";
        else if (route.name === "specials") iconName = "star";
        else if (route.name === "wineries") iconName = "wine";

        return {
          tabBarLabel: label,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={iconName} size={size} color={color} />
          ),
          tabBarActiveTintColor: "#720969",
          tabBarInactiveTintColor: "#aaa",
          headerShown: true,
        };
      }}
    >
      {/* Hide [slug] from tab bar, but DON'T hide the tab bar itself */}
      <Tabs.Screen
        name="wineries/[slug]"
        options={{
          href: null, // prevents it from showing up as a tab
          headerShown: true, // you’ll still get a header with back button
        }}
      />
    </Tabs>
  );
}
