// components/RegionGate.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Blocks the rest of the app from rendering until RegionContext has settled.
//
// Three branches:
//   • loading       → render a minimal splash screen (matches the boot splash
//                     so there's no visual jump).
//   • needs_picker  → render the picker DIRECTLY (not via a Redirect — the
//                     Stack hasn't mounted yet, so navigating to a route
//                     inside it would loop). Once the user picks, the
//                     context flips to "ready" and the Stack mounts.
//   • ready         → render children (the rest of the app tree).
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import RegionPickerScreen from "../app/region-picker";
import { colors } from "../constants/theme";
import { useRegion } from "../context/RegionContext";

export function RegionGate({ children }: { children: React.ReactNode }) {
  const { status } = useRegion();

  if (status === "loading") {
    // Match the dark splash background so there's no flash between the
    // boot splash and the first real render.
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="small" color={colors.accentSoft} />
      </View>
    );
  }

  if (status === "needs_picker") {
    // Render the picker inline — the Stack hasn't been mounted yet, so
    // we can't navigate to /region-picker. The picker calls setRegion()
    // which flips status to "ready", at which point this branch falls
    // through to the children render below.
    return <RegionPickerScreen />;
  }

  // status === "ready"
  return <>{children}</>;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});
