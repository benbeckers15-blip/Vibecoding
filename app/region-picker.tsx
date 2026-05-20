// app/region-picker.tsx
// ─────────────────────────────────────────────────────────────────────────────
// First-launch region picker. Only shown when:
//   • there are 2+ regions in Firestore, AND
//   • the user has no persisted region choice in AsyncStorage.
//
// In the Tasmania-only state we ship today, the user will never see this
// screen — RegionContext auto-selects the single available region. Adding
// a second region to Firestore is all it takes to make this surface
// active for first-time users (existing users keep their stored choice).
//
// Visual register matches the rest of the app: dark Forest Slate, Playfair
// serif headlines, accent kicker labels, sharp-cornered surfaces.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRegion } from "../context/RegionContext";
import { colors, fonts, radius, spacing, type } from "../constants/theme";

export default function RegionPickerScreen() {
  const { available, setRegion } = useRegion();
  const insets = useSafeAreaInsets();
  const [pickingId, setPickingId] = useState<string | null>(null);

  const handlePick = async (regionId: string) => {
    if (pickingId) return;
    setPickingId(regionId);
    try {
      await setRegion(regionId);
      // No navigation needed. RegionContext flips to "ready" and the
      // RegionGate above us swaps from rendering this picker inline to
      // rendering the rest of the app tree (Stack → index → home).
      // If the user reached this screen via /region-picker navigation
      // (e.g. a future "Change region" link from the profile), the
      // Stack is already mounted and the navigation pop happens
      // naturally when status flips back to ready.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert("Couldn't load that region", msg);
      setPickingId(null);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.hero }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.hero },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.kickerLine} />
          <Text style={styles.kicker}>SIPLOCAL</Text>
          <Text style={styles.headline}>
            Pick the wine region you'd like to explore.
          </Text>
          <Text style={styles.subhead}>
            You can switch later from your profile.
          </Text>
        </View>

        <View style={styles.list}>
          {available.map((r) => {
            const isPicking = pickingId === r.regionId;
            const isDisabled = pickingId !== null && pickingId !== r.regionId;
            return (
              <Pressable
                key={r.regionId}
                onPress={() => void handlePick(r.regionId)}
                disabled={pickingId !== null}
                style={({ pressed }) => [
                  styles.card,
                  pressed && !isDisabled && styles.cardPressed,
                  isDisabled && styles.cardDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  isPicking
                    ? `Loading ${r.displayName}`
                    : `Explore ${r.displayName}`
                }
                accessibilityState={{
                  disabled: pickingId !== null,
                  busy: isPicking,
                }}
              >
                <View style={styles.cardBody}>
                  <Text style={styles.cardKicker}>EXPLORE</Text>
                  <Text style={styles.cardName}>{r.displayName}</Text>
                </View>
                {isPicking ? (
                  <ActivityIndicator size="small" color={colors.accentSoft} />
                ) : (
                  <Text style={styles.cardCta}>→</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.xxl,
  },
  header: {
    marginBottom: spacing.hero,
  },
  kickerLine: {
    width: 32,
    height: 1,
    backgroundColor: colors.accent,
    marginBottom: spacing.md,
  },
  kicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: spacing.lg,
  },
  headline: {
    fontFamily: fonts.serif,
    fontSize: 30,
    lineHeight: 36,
    color: colors.textPrimary,
    letterSpacing: -0.4,
    marginBottom: spacing.md,
  },
  subhead: {
    ...type.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  list: {
    gap: spacing.md,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    borderRadius: radius.card,
    minHeight: spacing.hitTarget,
  },
  cardPressed: {
    opacity: 0.85,
    borderColor: colors.accentSoft,
  },
  cardDisabled: {
    opacity: 0.4,
  },
  cardBody: {
    flex: 1,
  },
  cardKicker: {
    ...type.kicker,
    color: colors.accentSoft,
    marginBottom: 4,
  },
  cardName: {
    fontFamily: fonts.serif,
    fontSize: 22,
    lineHeight: 26,
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  cardCta: {
    fontSize: 20,
    color: colors.accent,
    marginLeft: spacing.md,
  },
});
