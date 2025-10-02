// app/(tabs)/_layout.tsx
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import {
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const { width } = Dimensions.get("window");
// width of the floating oval
const BAR_WIDTH = Math.min(520, width * 0.92);

function CustomTabBar({ state, descriptors, navigation }: any) {
  return (
    <View style={styles.container}>
      <View style={styles.shadowWrapper}>
        <View style={[styles.floatingBar, { width: BAR_WIDTH }]}>
          {state.routes.map((route: any, index: number) => {
            const isFocused = state.index === index;

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            const iconName =
              route.name === "events"
                ? "calendar"
                : route.name === "specials"
                ? "star"
                : route.name === "wineries"
                ? "wine"
                : "home";

            return (
              <TouchableOpacity
                key={route.key}
                onPress={onPress}
                style={styles.tabButton}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
              >
                {/* purple circle behind active icon */}
                <View style={isFocused ? styles.activeCircle : undefined}>
                  <Ionicons
                    name={iconName as any}
                    size={20}
                    color={isFocused ? "#fff" : "#666"}
                  />
                </View>
                {/* label (optional) */}
                <Text style={[styles.label, isFocused && styles.labelActive]}>
                  {descriptors[route.key].options.tabBarLabel ??
                    descriptors[route.key].options.title ??
                    route.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      // use custom tab bar
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false, // nested stacks should show their headers
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Home", tabBarLabel: "Home" }} />
      <Tabs.Screen name="events" options={{ title: "Events", tabBarLabel: "Events" }} />
      <Tabs.Screen name="specials" options={{ title: "Specials", tabBarLabel: "Specials" }} />
      <Tabs.Screen name="wineries" options={{ title: "Wineries", tabBarLabel: "Wineries" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  container: {
    // keep space at bottom so bar sits above safe area on most phones
    position: "absolute",
    left: 0,
    right: 0,
    bottom: Platform.OS === "ios" ? 20 : 12,
    alignItems: "center",
    zIndex: 2000,
  },
  shadowWrapper: {
    // drop shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 12,
  },
  floatingBar: {
    flexDirection: "row",
    height: 64,
    backgroundColor: "#fff",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 12,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
  },
  activeCircle: {
    width: 44,
    height: 44,
    borderRadius: 44 / 2,
    backgroundColor: "#720969",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    color: "#666",
    marginTop: 2,
    textTransform: "none",
  },
  labelActive: {
    color: "#720969",
    fontWeight: "600",
  },
});