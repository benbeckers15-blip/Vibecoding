// context/SavedContext.tsx
// Persists the user's saved cellar doors in Firestore under
// users/{uid}/savedWineries — the same subcollection the Profile screen
// subscribes to — so hearting a winery anywhere in the app immediately
// shows up in "Saved Cellar Doors" on the profile.
//
// Previously this context wrote IDs to AsyncStorage only, which meant the
// wineries-list heart never reached the profile. Saved state is now
// optimistic: we flip the local set instantly, fire the Firestore write,
// and roll back if it fails. The onSnapshot listener keeps every screen
// reconciled (including saves made on the winery detail page).
//
// Usage:
//   const { isSaved, toggle } = useSaved();
//   isSaved(winery.id)              → true / false
//   toggle(winery.id, meta)         → flips saved state; `meta` (name,
//                                     image, rating, region) is required
//                                     for the profile row when saving.

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { db } from "../firebaseConfig";
import { useAuth } from "./AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Display fields written to users/{uid}/savedWineries/{id} on save. */
export type SavedWineryMeta = {
  name: string;
  image?: string;
  rating?: number;
  region?: string;
};

type SavedContextValue = {
  /** Set of saved winery document IDs. */
  savedIds: Set<string>;
  /** Toggle a winery saved/unsaved. Pass `meta` when saving so the
   *  profile row has a name/image to render. Persists to Firestore. */
  toggle: (id: string, meta?: SavedWineryMeta) => void;
  /** Returns true if the given winery ID is saved. */
  isSaved: (id: string) => boolean;
};

// ─── Context ──────────────────────────────────────────────────────────────────

const SavedContext = createContext<SavedContextValue>({
  savedIds: new Set(),
  toggle: () => {},
  isSaved: () => false,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SavedProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // Live-sync from Firestore whenever the signed-in user changes.
  useEffect(() => {
    if (!user) {
      setSavedIds(new Set());
      return;
    }
    const unsub = onSnapshot(
      collection(db, "users", user.uid, "savedWineries"),
      (snap) => setSavedIds(new Set(snap.docs.map((d) => d.id))),
      (err) => console.warn("savedWineries listener error:", err)
    );
    return unsub;
  }, [user]);

  const toggle = useCallback(
    (id: string, meta?: SavedWineryMeta) => {
      if (!user) return;

      const ref = doc(db, "users", user.uid, "savedWineries", id);
      const wasSaved = savedIds.has(id);

      // Optimistic flip — the snapshot listener reconciles afterwards.
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.delete(id);
        else next.add(id);
        return next;
      });

      const op = wasSaved
        ? deleteDoc(ref)
        : setDoc(ref, {
            name: meta?.name ?? "",
            image: meta?.image ?? "",
            rating: meta?.rating ?? 0,
            region: meta?.region ?? "",
            distance: "",
            savedAt: serverTimestamp(),
          });

      op.catch((err) => {
        console.warn("toggle saved winery failed:", err);
        // Roll back the optimistic flip.
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (wasSaved) next.add(id);
          else next.delete(id);
          return next;
        });
      });
    },
    [user, savedIds]
  );

  const isSaved = useCallback((id: string) => savedIds.has(id), [savedIds]);

  return (
    <SavedContext.Provider value={{ savedIds, toggle, isSaved }}>
      {children}
    </SavedContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** Use in any screen: const { isSaved, toggle } = useSaved() */
export function useSaved(): SavedContextValue {
  return useContext(SavedContext);
}
