// app/(tabs)/profile/delete-account.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Account Deletion screen.
//
// Compliance: Apple App Review guideline 5.1.1(v).
//   Apps that support account creation must let the user delete their
//   account from within the app. The deletion must remove the account AND
//   all associated personal data — not just deactivate / hide.
//
// UX is deliberately a separate screen (not just a confirm modal) because:
//   • App Review wants a clear, dedicated affordance with an explanation
//     of what's being deleted. A single Alert.alert() has been rejected
//     in past reviews.
//   • Users get a "back" exit and can read what's about to happen.
//   • The password field needs proper keyboard handling that's hard inside
//     a stacked Alert.
//
// Flow:
//   Profile → "Delete account" row → /delete-account
//   → user reads bullet list of what will be deleted
//   → enters password
//   → taps "Delete my account"
//   → re-auth + Cloud Function call (see lib/deleteAccount.ts)
//   → on success, AuthContext flips user → null and we router.replace("/auth")
// ─────────────────────────────────────────────────────────────────────────────

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { deleteAccountWithPassword, DeleteAccountError } from "../../../lib/deleteAccount";
import {
  colors,
  fonts,
  radius,
  spacing,
  type,
  weights,
} from "../../../constants/theme";

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Final confirmation Alert — last chance to back out before the
  // irreversible network call.
  function confirmAndDelete() {
    setError(null);
    if (!password) {
      setError("Please enter your password to confirm.");
      return;
    }

    Alert.alert(
      "Delete your account?",
      "This permanently removes your profile, saved cellar doors, trips, tasting notes, and palate data. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: runDeletion,
        },
      ]
    );
  }

  async function runDeletion() {
    setSubmitting(true);
    setError(null);
    try {
      await deleteAccountWithPassword(password);
      // On success the auth user is gone; onAuthStateChanged will flip
      // user → null. Route to the auth screen so the (tabs) layout
      // doesn't briefly render with stale data.
      router.replace("/auth");
    } catch (err) {
      if (err instanceof DeleteAccountError) {
        setError(err.friendly);
      } else {
        setError("Something went wrong. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { paddingTop: insets.top + 14 }]}>
        {/* ── Top bar ─────────────────────────────────────────────────── */}
        <View style={styles.topBar}>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={colors.textPrimary}
            />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + spacing.hero },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header ─────────────────────────────────────────────────── */}
          <Text style={styles.kicker}>ACCOUNT</Text>
          <Text style={styles.heading}>Delete your account.</Text>
          <Text style={styles.lede}>
            We're sorry to see you go. Deleting your account is permanent
            and removes everything tied to it.
          </Text>

          {/* ── What gets deleted ──────────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardKicker}>WHAT WILL BE DELETED</Text>
            {[
              "Your profile name, display initials, and member-since date",
              "Every saved cellar door and saved article",
              "All trips and lists you've created",
              "All tasting notes and the palate breakdown they power",
              "Your sign-in account — you won't be able to log back in",
            ].map((line) => (
              <View key={line} style={styles.bulletRow}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletText}>{line}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.warning}>
            This action cannot be undone. Once your account is deleted we
            cannot recover any of the data above.
          </Text>

          {/* ── Re-auth ────────────────────────────────────────────────── */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>CONFIRM YOUR PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(p) => {
                setPassword(p);
                setError(null);
              }}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoComplete="current-password"
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={confirmAndDelete}
              selectionColor={colors.accent}
              editable={!submitting}
            />
            <Text style={styles.fieldHint}>
              Re-entering your password proves it's really you before we
              delete anything.
            </Text>
          </View>

          {/* ── Error ──────────────────────────────────────────────────── */}
          {error !== null && <Text style={styles.errorText}>{error}</Text>}

          {/* ── Buttons ────────────────────────────────────────────────── */}
          <Pressable
            style={({ pressed }) => [
              styles.deleteBtn,
              pressed && styles.deleteBtnPressed,
              (submitting || !password) && styles.deleteBtnDisabled,
            ]}
            onPress={confirmAndDelete}
            disabled={submitting || !password}
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
          >
            {submitting ? (
              <ActivityIndicator color={colors.textOnDark} size="small" />
            ) : (
              <Text style={styles.deleteBtnLabel}>Delete my account</Text>
            )}
          </Pressable>

          <Pressable
            style={styles.cancelBtn}
            onPress={() => router.back()}
            disabled={submitting}
            accessibilityRole="button"
          >
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>

          {/* ── Footer note ────────────────────────────────────────────── */}
          <Text style={styles.footnote}>
            Need help instead? Email support@siplocal.app and we can answer
            questions before you delete your account.
          </Text>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1 },

  // ── Top bar ────────────────────────────────────────────────────────────
  topBar: {
    paddingHorizontal: spacing.xxl,
    flexDirection: "row",
    alignItems: "center",
  },
  iconBtn: {
    width: spacing.hitTarget,
    height: spacing.hitTarget,
    borderRadius: spacing.hitTarget / 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Scroll ─────────────────────────────────────────────────────────────
  scrollContent: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
  },

  // ── Header ─────────────────────────────────────────────────────────────
  kicker: {
    ...type.kicker,
    letterSpacing: 3,
    color: colors.accentSoft,
  },
  heading: {
    ...type.h1,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  lede: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
    lineHeight: 22,
  },

  // ── Card ───────────────────────────────────────────────────────────────
  card: {
    marginTop: spacing.xxxl,
    backgroundColor: colors.surfaceDeep,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing.xl,
  },
  cardKicker: {
    ...type.kicker,
    letterSpacing: 2,
    color: colors.accentSoft,
    marginBottom: spacing.md,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.accent,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 21,
  },

  // ── Warning ────────────────────────────────────────────────────────────
  warning: {
    marginTop: spacing.lg,
    fontSize: 13,
    color: colors.error,
    lineHeight: 19,
    fontFamily: fonts.sansMedium,
  },

  // ── Field ──────────────────────────────────────────────────────────────
  fieldGroup: {
    marginTop: spacing.xxxl,
    gap: spacing.sm,
  },
  fieldLabel: {
    ...type.kicker,
    letterSpacing: 2,
    color: colors.textMuted,
  },
  input: {
    backgroundColor: colors.inputSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: spacing.hitTarget,
  },
  fieldHint: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    lineHeight: 18,
    marginTop: spacing.md,
  },

  // ── Buttons ────────────────────────────────────────────────────────────
  deleteBtn: {
    marginTop: spacing.xxl,
    backgroundColor: colors.error,
    borderRadius: radius.card,
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: spacing.hitTarget,
  },
  deleteBtnPressed: { opacity: 0.85 },
  deleteBtnDisabled: { opacity: 0.45 },
  deleteBtnLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 14,
    letterSpacing: 1.5,
    color: colors.textOnDark,
    fontWeight: weights.emphasis,
  },
  cancelBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: spacing.hitTarget,
  },
  cancelLabel: {
    ...type.body,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },

  // ── Footnote ───────────────────────────────────────────────────────────
  footnote: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.xxxl,
    textAlign: "center",
    lineHeight: 18,
  },
});
