// components/EmptyState.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Inline "no data" UI for screens that loaded successfully but have nothing
// to show — empty wineries list, no premade trips for this region, no Pour
// issue, etc.
//
// Distinct from ErrorScreen: this is NOT a failure. The query succeeded and
// returned zero results. The visual register is lighter (smaller kicker,
// lower-intensity message) and there's no retry — retrying a successful
// query wouldn't produce a different answer. An optional CTA can point
// the user at a related action ("Build your own trip").
// ─────────────────────────────────────────────────────────────────────────────

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, spacing, type } from "../constants/theme";

export interface EmptyStateProps {
  /** Wide-tracked kicker. Defaults to "NOTHING HERE YET". */
  kicker?: string;
  /** Short headline — one sentence. */
  title: string;
  /** Optional supporting body copy. One short sentence. */
  message?: string;
  /** Optional ionicon name to anchor the visual. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Optional CTA. */
  action?: {
    label: string;
    onPress: () => void;
  };
}

export function EmptyState({
  kicker = "NOTHING HERE YET",
  title,
  message,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <View style={styles.root}>
      {icon && (
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={28} color={colors.accentSoft} />
        </View>
      )}
      <View style={styles.kickerRule} />
      <Text style={styles.kicker}>{kicker}</Text>
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}

      {action && (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.actionBtn,
            pressed && styles.actionBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={styles.actionBtnText}>{action.label.toUpperCase()}</Text>
          <Ionicons name="arrow-forward" size={13} color={colors.accent} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingVertical: spacing.hero,
    paddingHorizontal: spacing.xxl,
    alignItems: "flex-start",
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  kickerRule: {
    width: 24,
    height: 1,
    backgroundColor: colors.accent,
    marginBottom: spacing.sm,
  },
  kicker: {
    ...type.kicker,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 22,
    lineHeight: 28,
    color: colors.textPrimary,
    letterSpacing: -0.2,
    marginBottom: spacing.sm,
  },
  message: {
    ...type.body,
    color: colors.textSecondary,
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  actionBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  actionBtnPressed: {
    opacity: 0.7,
  },
  actionBtnText: {
    ...type.kicker,
    color: colors.accent,
    letterSpacing: 1.6,
  },
});
