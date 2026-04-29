// context/AuthContext.tsx
// Wraps the whole app. Listens to Firebase auth state and:
//   • exposes user / loading / signOut to every screen via useAuth()
//   • auto-creates the users/{uid} Firestore document on first sign-in

import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
  User,
} from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { auth, db } from "../firebaseConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive two-letter initials from a display name or email prefix. */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * Creates the users/{uid} Firestore document if it doesn't exist yet.
 * Called once, right after a user's very first sign-in.
 * Subsequent sign-ins skip the write entirely.
 */
async function ensureUserProfile(user: User): Promise<void> {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) return; // already set up — nothing to do

  // Derive a sensible display name from whatever auth gave us
  const displayName =
    user.displayName ??
    user.email?.split("@")[0]?.replace(/[._-]/g, " ") ??
    "Wine Lover";

  await setDoc(userRef, {
    name: displayName,
    initials: getInitials(displayName),
    email: user.email ?? "",
    location: "",
    memberSince: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Ensure the Firestore profile exists before we surface the user
        await ensureUserProfile(firebaseUser);
        setUser(firebaseUser);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return unsubscribe; // cleans up the listener on unmount
  }, []);

  const signOut = async () => {
    await firebaseSignOut(auth);
    // onAuthStateChanged will fire automatically and set user → null
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** Use this in any screen: const { user, loading, signOut } = useAuth() */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
