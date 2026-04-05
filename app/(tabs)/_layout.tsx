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
    route.name === "events"
      ? "calendar"
      : route.name === "specials"
      ? "star"
      : route.name === "wineries"
      ? "wine"
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
          color={isFocused ? "#1a1a1a" : "rgba(255,255,255,0.45)"}
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
  const routesCount = state.routes.length;
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
      circleLeft.value = targetLeftForIndex(state.index);
      initialPositioned.current = true;
    }
  }, [measuredBarWidth]);

  useEffect(() => {
    if (!initialPositioned.current) return;
    circleLeft.value = withSpring(targetLeftForIndex(state.index), {
      damping: 18,
      stiffness: 250,
      mass: 1,
    });
  }, [state.index, slotWidth, circleLeft]);

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
      <Tabs.Screen name="events" options={{ title: "Events", tabBarLabel: "Events" }} />
      <Tabs.Screen name="specials" options={{ title: "Specials", tabBarLabel: "Specials" }} />
      <Tabs.Screen name="wineries" options={{ title: "Wineries", tabBarLabel: "Wineries" }} />
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 12,
  },
  floatingBar: {
    flexDirection: "row",
    height: 64,
    backgroundColor: "#1a1a1a",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: H_PADDING,
    overflow: "hidden",
  },
  tabButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  activeCircle: {
    position: "absolute",
    top: 8,
    bottom: 8,
    borderRadius: 999,
    backgroundColor: "#faf9f6",
  },
  label: {
    fontSize: 11,
    color: "rgba(255,255,255,0.45)",
    marginTop: 2,
  },
});
