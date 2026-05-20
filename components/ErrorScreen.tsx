// components/ErrorScreen.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Full-screen failure UI in the Forest Slate editorial register.
//
// Used by:
//   • RootErrorBoundary — uncaught JS errors anywhere in the tree
//   • RegionGate         — region config failed to load / no regions exist
//   • Boot offline path  — no network at first launch
//
// Visual register matches the rest of the app: dark background, a small
// accent rule, Playfair serif headline, body in DM Sans, optional retry
// button styled like the primary CTAs across the app.
//
// API is deliberately minimal — title + message + optional retry handler.
// Callers compose specific copy ("Couldn't reach SipLocal", "Region not
// found", "We hit a snag"); this component just renders.
// ─────────────────────────────────────────────────────────────────────────────

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius, spacing, type } from "../constants/theme";

export interface ErrorScreenProps {
  /** Wide-tracked kicker label above the headline. Defaults to "SOMETHING WENT WRONG". */
  kicker?: string;
  /** Editorial headline — the main message. One short sentence. */
  title: string;
  /** Supporting body copy — what happened, what to try. 1-3 short sentences. */
  message: string;
  /** Optional retry handler. If omitted, the button is hidden. */
  onRetry?: () => void;
  /** Label for the retry button. Defaults to "Try Again". */
  retryLabel?: string;
  /** True while a retry is in flight — shows a spinner on the button. */
  retrying?: boolean;
  /** Optional secondary action below the retry button (e.g. "Go to home"). */
  secondaryAction?: {
    label: string;
    onPress: () => void;
  };
}

export function ErrorScreen({
  kicker = "SOMETHING WENT WRONG",
  title,
  message,
  onRetry,
  retryLabel = "Try Again",
  retrying = false,
  secondaryAction,
}: ErrorScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.kickerRule} />
        <Text style={styles.kicker}>{kicker}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>

        {onRetry && (
          <Pressable
            onPress={onRetry}
            disabled={retrying}
            style={({ pressed }) => [
              styles.retryBtn,
              retrying && styles.retryBtnDisabled,
              pressed && !retrying && styles.retryBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={retrying ? `${retryLabel}, in progress` : retryLabel}
            accessibilityState={{ disabled: retrying, busy: retrying }}
          >
            {retrying ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <>
                <Ionicons name="refresh" size={16} color={colors.onAccent} />
                <Text style={styles.retryBtnText}>{retryLabel.toUpperCase()}</Text>
              </>
            )}
          </Pressable>
        )}

        {secondaryAction && (
          <Pressable
            onPress={secondaryAction.onPress}
            style={({ pressed }) => [
              styles.secondaryBtn,
              pressed && styles.secondaryBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={secondaryAction.label}
          >
            <Text style={styles.secondaryBtnText}>
              {secondaryAction.label.toUpperCase()}
            </Text>
          </Pressable>
        )}
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
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.hero,
  },
  kickerRule: {
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
  title: {
    fontFamily: fonts.serif,
    fontSize: 30,
    lineHeight: 36,
    color: colors.textPrimary,
    letterSpacing: -0.4,
    marginBottom: spacing.lg,
  },
  message: {
    ...type.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.hero,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.accent,
    borderRadius: radius.card,
    minHeight: spacing.hitTarget,
    alignSelf: "flex-start",
  },
  retryBtnDisabled: {
    opacity: 0.5,
  },
  retryBtnPressed: {
    opacity: 0.85,
  },
  retryBtnText: {
    ...type.kicker,
    color: colors.onAccent,
    fontSize: 12,
    letterSpacing: 2,
  },
  secondaryBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    alignSelf: "flex-start",
  },
  secondaryBtnPressed: {
    opacity: 0.7,
  },
  secondaryBtnText: {
    ...type.kicker,
    color: colors.accentSoft,
    fontSize: 11,
    letterSpacing: 2,
  },
});
