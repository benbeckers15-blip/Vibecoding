// app/auth.tsx
// Login / Sign-up screen.
// Cinematic Dusk aesthetic — dark background, gold accents — matching the
// profile tab so the personal section of the app feels cohesive.
//
// Two modes toggled by a link at the bottom:
//   • "Sign in"  — signInWithEmailAndPassword
//   • "Create account" — createUserWithEmailAndPassword
//
// On success, onAuthStateChanged in AuthContext fires, auto-creates the
// Firestore profile (if new user), then router.replace("/home") navigates
// into the app.

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { auth } from "../firebaseConfig";
import { REGION_NAME_UPPER } from "../constants/region";
import { colors, fonts } from "../constants/theme";

// ─── Friendly error messages ──────────────────────────────────────────────────
function friendlyError(code: string): string {
  switch (code) {
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "An account with that email already exists. Try signing in instead.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "No connection. Check your internet and try again.";
    case "auth/operation-not-allowed":
      return "Email/password sign-in is not enabled. Enable it in the Firebase Console under Authentication → Sign-in method.";
    case "auth/configuration-not-found":
    case "auth/project-not-found":
      return "Firebase project not found. Check your .env credentials.";
    default:
      return "Something went wrong. Please try again.";
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === "signup";

  async function handleSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setSubmitting(true);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      // onAuthStateChanged fires → AuthContext creates profile if needed.
      // Replace so the user can't swipe back to this screen.
      router.replace("/home");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      console.log("[Auth error]", code, err); // remove once diagnosed
      setError(friendlyError(code));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 32 }]}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.region}>{REGION_NAME_UPPER}</Text>
          <Text style={styles.title}>Winery Guide</Text>
          <Text style={styles.subtitle}>
            {isSignUp ? "Create your account" : "Sign in to your account"}
          </Text>
        </View>

        {/* ── Form ────────────────────────────────────────────────────── */}
        <View style={styles.form}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>EMAIL</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(t) => { setEmail(t); setError(null); }}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
              selectionColor={colors.accent}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(p) => { setPassword(p); setError(null); }}
              placeholder={isSignUp ? "At least 6 characters" : "••••••••"}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoComplete={isSignUp ? "new-password" : "current-password"}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              selectionColor={colors.accent}
            />
          </View>

          {/* ── Error message ──────────────────────────────────────────── */}
          {error !== null && (
            <Text style={styles.errorText}>{error}</Text>
          )}

          {/* ── Submit button ──────────────────────────────────────────── */}
          <Pressable
            style={({ pressed }) => [
              styles.submitBtn,
              pressed && styles.submitBtnPressed,
              submitting && styles.submitBtnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color={colors.onAccent} size="small" />
            ) : (
              <Text style={styles.submitLabel}>
                {isSignUp ? "Create account" : "Sign in"}
              </Text>
            )}
          </Pressable>
        </View>

        {/* ── Mode toggle ─────────────────────────────────────────────── */}
        <Pressable
          style={styles.toggleRow}
          onPress={() => { setMode(isSignUp ? "signin" : "signup"); setError(null); }}
          accessibilityRole="button"
        >
          <Text style={styles.toggleText}>
            {isSignUp
              ? "Already have an account?  "
              : "New here?  "}
            <Text style={styles.toggleLink}>
              {isSignUp ? "Sign in" : "Create an account"}
            </Text>
          </Text>
        </Pressable>

      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "center",
    gap: 40,
  },

  // ── Header ───────────────────────────────────────────────────────────────
  header: {
    alignItems: "center",
    gap: 6,
  },
  region: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 3.5,
    color: colors.textMuted,
  },
  title: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontSize: 34,
    fontWeight: "500",
    color: colors.textPrimary,
    letterSpacing: -0.5,
    marginTop: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 6,
  },

  // ── Form ─────────────────────────────────────────────────────────────────
  form: {
    gap: 20,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    fontFamily: fonts.mono,
    fontSize: 9.5,
    letterSpacing: 2,
    color: colors.textMuted,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.textPrimary,
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    lineHeight: 18,
  },
  submitBtn: {
    backgroundColor: colors.accent,
    borderRadius: 4,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  submitBtnPressed: {
    backgroundColor: colors.accentSoft,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitLabel: {
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.onAccent,
    fontWeight: "700",
  },

  // ── Toggle ───────────────────────────────────────────────────────────────
  toggleRow: {
    alignItems: "center",
  },
  toggleText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  toggleLink: {
    color: colors.accentSoft,
    fontWeight: "600",
  },
});
