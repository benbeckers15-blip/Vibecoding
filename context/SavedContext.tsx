// context/SavedContext.tsx
// Persists the user's saved cellar doors locally via AsyncStorage.
// Any screen can call useSaved() to read or toggle saved state.
//
// Usage:
//   const { isSaved, toggle } = useSaved();
//   isSaved(winery.id)          → true / false
//   toggle(winery.id)           → flips saved state + writes to disk

import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

const STORAGE_KEY = "saved_cellar_doors";

// ─── Types ────────────────────────────────────────────────────────────────────

type SavedContextValue = {
  /** Set of saved winery document IDs. */
  savedIds: Set<string>;
  /** Toggle a winery saved/unsaved. Persists immediately. */
  toggle: (id: string) => void;
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
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // Hydrate from disk on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const arr: string[] = JSON.parse(raw);
          setSavedIds(new Set(arr));
        } catch {
          // Corrupt data — start fresh
        }
      })
      .catch(() => {
        // Storage unavailable — degrade gracefully (in-memory only)
      });
  }, []);

  const toggle = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      // Fire-and-forget persist — no await needed
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...next])).catch(
        () => {}
      );
      return next;
    });
  }, []);

  const isSaved = useCallback(
    (id: string) => savedIds.has(id),
    [savedIds]
  );

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
