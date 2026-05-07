// app/index.tsx
// Splash screen — shown while Firebase resolves auth state.
// Once both the 2-second timer AND the auth check have settled,
// we redirect: logged-in users go to /home, everyone else to /auth.

import { Redirect } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { REGION_NAME_UPPER } from "../constants/region";
import { useAuth } from "../context/AuthContext";
import { colors, fonts } from "../constants/theme";

function FadingDots() {
  const dot1 = useRef(new Animated.Value(0.2)).current;
  const dot2 = useRef(new Animated.Value(0.2)).current;
  const dot3 = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.2, duration: 400, useNativeDriver: true }),
          Animated.delay(800),
        ])
      );

    const a1 = animate(dot1, 0);
    const a2 = animate(dot2, 200);
    const a3 = animate(dot3, 400);
    a1.start(); a2.start(); a3.start();

    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  return (
    <View style={styles.dotsRow}>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: dot }]} />
      ))}
    </View>
  );
}

export default function Index() {
  const [timerDone, setTimerDone] = useState(false);
  const { user, loading } = useAuth();

  // 2-second minimum splash display
  useEffect(() => {
    const timer = setTimeout(() => setTimerDone(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Show splash until BOTH the timer has elapsed AND auth is resolved
  if (!timerDone || loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.region}>{REGION_NAME_UPPER}</Text>
        <Text style={styles.title}>Winery Guide</Text>
        <FadingDots />
      </View>
    );
  }

  // Auth resolved — route accordingly
  return <Redirect href={user ? "/home" : "/auth"} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
  },
  region: {
    fontSize: 9,
    letterSpacing: 4,
    color: colors.textMuted,
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontFamily: fonts.serif,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 24,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
});
