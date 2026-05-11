// app/(tabs)/_layout.tsx
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { colors, radius, spacing } from "../../constants/theme";

const { width } = Dimensions.get("window");
const BAR_WIDTH_FALLBACK = Math.min(520, width * 0.92);
const H_PADDING = 12;
const CIRCLE_MARGIN = 8;

type TabButtonProps = {
  route: any;
  index: number;
  isFocused: boolean;
  slotWidth: number;
  descriptor: any;
  onPress: () => void;
};

const TabButton = React.memo(function TabButton({
  route,
  isFocused,
  slotWidth,
  descriptor,
  onPress,
}: TabButtonProps) {
  const scale = useSharedValue(isFocused ? 1.2 : 1);
  const translateY = useSharedValue(isFocused ? -6 : 0);

  useEffect(() => {
    if (isFocused) {
      scale.value = withSpring(1.2, { damping: 18, stiffness: 300, mass: 1 });
      translateY.value = withSpring(-6, { damping: 18, stiffness: 300, mass: 1 });
    } else {
      scale.value = withSpring(1, { damping: 18, stiffness: 300, mass: 1 });
      translateY.value = withSpring(0, { damping: 18, stiffness: 300, mass: 1 });
    }
  }, [isFocused]);

  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateY: translateY.value },
    ],
  }));

  const iconName =
    route.name === "explore"
      ? "compass"
      : route.name === "profile"
      ? "person"
      : route.name === "wineries"
      ? "wine"
      : route.name === "trips"
      ? "map"
      : "home";

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tabButton, { width: slotWidth }]}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
    >
      <Animated.View style={animatedIconStyle}>
        <Ionicons
          name={iconName as any}
          size={20}
          color={isFocused ? colors.onAccent : colors.textMuted}
        />
      </Animated.View>
      {!isFocused && (
        <Text style={styles.label}>
          {descriptor.options.tabBarLabel ??
            descriptor.options.title ??
            route.name}
        </Text>
      )}
    </TouchableOpacity>
  );
});

function CustomTabBar({ state, descriptors, navigation }: any) {
  // Routes declared with `href: null` should not appear in the bar. Expo
  // Router strips `href` from the descriptor and instead sets
  // `tabBarItemStyle: { display: 'none' }`, so we filter on that. Also remap
  // the focused index into the visible-routes space so the sliding indicator
  // lands on the correct slot.
  const visibleRoutes = state.routes.filter((route: any) => {
    const itemStyle = descriptors[route.key].options.tabBarItemStyle as
      | { display?: string }
      | undefined;
    return itemStyle?.display !== "none";
  });
  const focusedRouteKey = state.routes[state.index]?.key;
  const focusedVisibleIndex = Math.max(
    0,
    visibleRoutes.findIndex((r: any) => r.key === focusedRouteKey)
  );

  const routesCount = visibleRoutes.length;
  const [measuredBarWidth, setMeasuredBarWidth] = useState<number | null>(null);
  const effectiveBarWidth = measuredBarWidth ?? BAR_WIDTH_FALLBACK;
  const contentWidth = Math.max(0, effectiveBarWidth - H_PADDING * 2);
  const slotWidth = contentWidth / routesCount;
  const circleWidth = Math.max(20, slotWidth - CIRCLE_MARGIN * 2);

  const circleLeft = useSharedValue(0);
  const initialPositioned = useRef(false);

  const targetLeftForIndex = (index: number) =>
    H_PADDING + index * slotWidth + (slotWidth - circleWidth) / 2;

  useEffect(() => {
    if (measuredBarWidth == null) return;
    if (!initialPositioned.current) {
      circleLeft.value = targetLeftForIndex(focusedVisibleIndex);
      initialPositioned.current = true;
    }
  }, [measuredBarWidth]);

  useEffect(() => {
    if (!initialPositioned.current) return;
    circleLeft.value = withSpring(targetLeftForIndex(focusedVisibleIndex), {
      damping: 18,
      stiffness: 250,
      mass: 1,
    });
  }, [focusedVisibleIndex, slotWidth, circleLeft]);

  const animatedCircleStyle = useAnimatedStyle(() => ({
    left: circleLeft.value,
  }));

  return (
    <View style={styles.container}>
      <View style={styles.shadowWrapper}>
        <View
          style={[styles.floatingBar, { width: effectiveBarWidth }]}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w && w !== measuredBarWidth) setMeasuredBarWidth(w);
          }}
        >
          {/* sliding cream indicator */}
          <Animated.View
            style={[
              styles.activeCircle,
              animatedCircleStyle,
              { width: circleWidth },
            ]}
          />

          {visibleRoutes.map((route: any, index: number) => {
            const isFocused = focusedVisibleIndex === index;

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!event.defaultPrevented) {
                // Always navigate to the root list screen of the tab,
                // whether coming from another tab or already deep in this tab's stack
                navigation.navigate(route.name, { screen: "index" });
              }
            };

            return (
              <TabButton
                key={route.key}
                route={route}
                index={index}
                isFocused={isFocused}
                slotWidth={slotWidth}
                descriptor={descriptors[route.key]}
                onPress={onPress}
              />
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
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="home" options={{ title: "Home", tabBarLabel: "Home" }} />
      <Tabs.Screen name="trips" options={{ title: "Trips", tabBarLabel: "Trips" }} />
      <Tabs.Screen name="wineries" options={{ title: "Wineries", tabBarLabel: "Wineries" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarLabel: "Profile" }} />
      {/* `explore` is preserved as a route for any existing inbound links,
          but its article content now lives on the home tab — so it is
          hidden from the floating nav. */}
      <Tabs.Screen name="explore" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: Platform.OS === "ios" ? 20 : 12,
    alignItems: "center",
    zIndex: 2000,
  },
  shadowWrapper: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 10,
  },
  floatingBar: {
    flexDirection: "row",
    height: 64,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: H_PADDING,
    overflow: "hidden",
  },
  tabButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: spacing.hitTarget, // Apple HIG: 44pt minimum touch target
  },
  activeCircle: {
    position: "absolute",
    top: 8,
    bottom: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,   // forest pill for active tab
  },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
});
