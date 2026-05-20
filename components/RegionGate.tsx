// components/RegionGate.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Blocks the rest of the app from rendering until RegionContext has settled.
//
// Four branches:
//   • loading       → render a minimal splash screen (matches the boot splash
//                     so there's no visual jump).
//   • needs_picker  → render the picker DIRECTLY (not via a Redirect — the
//                     Stack hasn't mounted yet, so navigating to a route
//                     inside it would loop). Once the user picks, the
//                     context flips to "ready" and the Stack mounts.
//   • error         → render ErrorScreen with retry. Two flavours:
//                     - no_regions    (data problem; user can't recover)
//                     - fetch_failed  (network problem; retry is meaningful)
//   • ready         → render children (the rest of the app tree).
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import RegionPickerScreen from "../app/region-picker";
import { colors } from "../constants/theme";
import { useNetwork } from "../context/NetworkContext";
import { useRegion } from "../context/RegionContext";
import { ErrorScreen } from "./ErrorScreen";

export function RegionGate({ children }: { children: React.ReactNode }) {
  const { status, errorKind, retry } = useRegion();
  const { isConnected } = useNetwork();

  if (status === "loading") {
    // Match the dark splash background so there's no flash between the
    // boot splash and the first real render.
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="small" color={colors.accentSoft} />
      </View>
    );
  }

  if (status === "error") {
    // Two flavours: no-regions in Firestore (data problem, retry won't
    // help) and fetch failed (network problem, retry is meaningful).
    // Tailor the copy to the user's actual situation — telling someone
    // with no internet to "run a seed script" is gibberish.
    const offline = !isConnected;
    if (errorKind === "no_regions") {
      return (
        <ErrorScreen
          kicker="SETUP NEEDED"
          title="No regions are available."
          message="The app's region catalogue hasn't been set up yet. If you're the developer, run the region seed script. If you're a user, please reach out to support."
          onRetry={retry}
        />
      );
    }
    // fetch_failed — most commonly a network blip.
    return (
      <ErrorScreen
        kicker={offline ? "YOU'RE OFFLINE" : "COULDN'T REACH SIPLOCAL"}
        title={
          offline
            ? "We can't load the app without an internet connection."
            : "We couldn't load the app."
        }
        message={
          offline
            ? "Check your wifi or cellular connection, then tap below to try again."
            : "We tried to fetch the region catalogue but couldn't reach our servers. Check your connection, then tap below to try again."
        }
        onRetry={retry}
      />
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
