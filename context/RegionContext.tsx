// context/RegionContext.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Owns the active wine region for the running app session.
//
// First-launch flow:
//   1. Mount: read persisted regionId from AsyncStorage.
//   2. Fetch the list of available regions from Firestore (`regions/`).
//   3. If a persisted choice exists AND it's still in the available list →
//      load that region's full config and we're ready.
//   4. If no persisted choice but EXACTLY ONE region is available →
//      auto-select it. Tasmania-only users never see the picker.
//   5. If no persisted choice AND multiple regions are available →
//      flip to `needs_picker`; the RegionGate shows the picker screen.
//
// Subsequent launches: as long as AsyncStorage has a regionId that's still
// in the available list, no Firestore read for the region list is strictly
// required to render the home screen — we read the region's *config* doc
// in parallel with everything else.
//
// Switching region via `setRegion()`:
//   • Writes the new id to AsyncStorage.
//   • Loads the new region's config (cached on the document via Firestore's
//     persistent client cache, so subsequent switches are fast).
//   • Caller is responsible for clearing any cached per-region state
//     (saved wineries, concierge corpus, etc.) — the context just exposes
//     the new region; the side-effects are wired up in Phase 3b.
//
// Why RegionProvider is OUTERMOST in app/_layout.tsx (above Auth/Saved/Trip):
//   • The region must be settled before anything that wants to query
//     region-filtered Firestore data (which is most things).
//   • If we ever sync the active region to users/{uid}.activeRegionId
//     (deferred — see plan §3d), AuthProvider needs to be able to read
//     the active region at sign-in time.
// ─────────────────────────────────────────────────────────────────────────────

import AsyncStorage from "@react-native-async-storage/async-storage";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { db } from "../firebaseConfig";
import { getConcierge } from "../services/concierge/concierge";
import type { RegionConfig, RegionSummary } from "../types/region";

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "active_region_id_v1";

// ─── State ────────────────────────────────────────────────────────────────────
// Three distinct states the rest of the app needs to be able to switch on.

type RegionState =
  | { status: "loading" }
  | {
      status: "needs_picker";
      available: RegionSummary[];
    }
  | {
      status: "ready";
      regionId: string;
      config: RegionConfig;
      available: RegionSummary[];
    };

// ─── Context value ────────────────────────────────────────────────────────────

interface RegionContextValue {
  status: RegionState["status"];

  /** Active region id, or null while loading / awaiting picker. */
  regionId: string | null;
  /** Full config doc for the active region, or null while loading. */
  config: RegionConfig | null;
  /** All regions known to Firestore. Empty while loading. */
  available: RegionSummary[];

  /**
   * Switch to a different region. Persists to AsyncStorage and loads the
   * new region's config. Throws if the regionId isn't in `available`.
   *
   * Callers should clear any region-scoped local caches (concierge
   * corpus, saved wineries that depend on the old region, etc.) after
   * this resolves. Phase 3b wires the concierge reset in.
   */
  setRegion: (regionId: string) => Promise<void>;
}

const RegionContext = createContext<RegionContextValue>({
  status: "loading",
  regionId: null,
  config: null,
  available: [],
  setRegion: async () => {
    throw new Error("RegionContext.setRegion called before provider mounted");
  },
});

// ─── Firestore helpers ────────────────────────────────────────────────────────

async function fetchRegionSummaries(): Promise<RegionSummary[]> {
  // The `regions` collection is small (one doc per supported region) so a
  // plain getDocs is fine — no need to denormalise into a summary doc.
  const snap = await getDocs(collection(db, "regions"));
  return snap.docs.map((d) => {
    const data = d.data() as { displayName?: string };
    return {
      regionId: d.id,
      displayName: data.displayName || d.id,
    };
  });
}

async function fetchRegionConfig(regionId: string): Promise<RegionConfig> {
  const snap = await getDoc(doc(db, "regions", regionId));
  if (!snap.exists()) {
    throw new Error(
      `Region "${regionId}" is missing from Firestore. Run scripts/seed-region-${regionId}.js`
    );
  }
  const data = snap.data() as Omit<RegionConfig, "regionId">;
  return { regionId, ...data };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RegionState>({ status: "loading" });

  // Initial load: persisted choice + available regions in parallel.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storedId, available] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          fetchRegionSummaries(),
        ]);
        if (cancelled) return;

        // Defensive: if Firestore returned no regions at all, fall back to
        // the loading state with empty available list. The app will hang
        // here visibly, which is the right signal — a region MUST exist
        // for the app to function. (Realistically this only happens if
        // someone forgot to run the seed script.)
        if (available.length === 0) {
          console.error(
            "[RegionContext] No regions found in Firestore. Run scripts/seed-region-tasmania.js."
          );
          return;
        }

        // Prefer the persisted choice if it's still valid.
        const valid = storedId && available.some((r) => r.regionId === storedId);
        if (valid && storedId) {
          const config = await fetchRegionConfig(storedId);
          if (cancelled) return;
          setState({
            status: "ready",
            regionId: storedId,
            config,
            available,
          });
          return;
        }

        // Auto-select when only one region exists — keeps the Tasmania-
        // only UX identical to before the refactor. The user never sees
        // a one-option "picker".
        if (available.length === 1) {
          const only = available[0];
          await AsyncStorage.setItem(STORAGE_KEY, only.regionId);
          const config = await fetchRegionConfig(only.regionId);
          if (cancelled) return;
          setState({
            status: "ready",
            regionId: only.regionId,
            config,
            available,
          });
          return;
        }

        // Multiple regions, no persisted choice → show the picker.
        setState({ status: "needs_picker", available });
      } catch (err) {
        console.error("[RegionContext] failed to initialise:", err);
        // Stay in loading state — better than crashing the whole app.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setRegion = useCallback(async (nextId: string) => {
    // Snapshot the current available list so we can validate without a
    // round-trip. If the state hasn't fetched regions yet, allow the call
    // through and let fetchRegionConfig surface the error.
    const available =
      state.status === "needs_picker" || state.status === "ready"
        ? state.available
        : [];
    if (
      available.length > 0 &&
      !available.some((r) => r.regionId === nextId)
    ) {
      throw new Error(`Unknown regionId "${nextId}"`);
    }

    // If we're actually switching regions (not initial selection or a
    // no-op re-select), tear down the concierge's cached corpus AND
    // chat history. Without this, getWinery(slug) on the next chat
    // would return wineries from the old region until the modal was
    // closed and reopened.
    const currentId = state.status === "ready" ? state.regionId : null;
    if (currentId && currentId !== nextId) {
      getConcierge().resetForRegionChange();
    }

    await AsyncStorage.setItem(STORAGE_KEY, nextId);
    const config = await fetchRegionConfig(nextId);
    setState({
      status: "ready",
      regionId: nextId,
      config,
      available: available.length > 0 ? available : [{ regionId: nextId, displayName: config.displayName }],
    });
  }, [state]);

  const value = useMemo<RegionContextValue>(() => {
    if (state.status === "ready") {
      return {
        status: "ready",
        regionId: state.regionId,
        config: state.config,
        available: state.available,
        setRegion,
      };
    }
    if (state.status === "needs_picker") {
      return {
        status: "needs_picker",
        regionId: null,
        config: null,
        available: state.available,
        setRegion,
      };
    }
    return {
      status: "loading",
      regionId: null,
      config: null,
      available: [],
      setRegion,
    };
  }, [state, setRegion]);

  return (
    <RegionContext.Provider value={value}>{children}</RegionContext.Provider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Read the active region. Returns the full context value, including
 * status and the setRegion callback. Most screens want one of the
 * narrower hooks below instead.
 */
export function useRegion(): RegionContextValue {
  return useContext(RegionContext);
}

/**
 * The active region id. Throws if called before the region is ready —
 * use this from screens that are rendered AFTER `RegionGate` has settled,
 * which is every screen under the (tabs) layout.
 */
export function useActiveRegionId(): string {
  const { regionId } = useRegion();
  if (!regionId) {
    throw new Error(
      "useActiveRegionId called before region is ready. " +
        "Render the screen below RegionGate."
    );
  }
  return regionId;
}

/**
 * Full config doc for the active region. Same guarantee as
 * useActiveRegionId — only safe below RegionGate.
 */
export function useRegionConfig(): RegionConfig {
  const { config } = useRegion();
  if (!config) {
    throw new Error(
      "useRegionConfig called before region is ready. " +
        "Render the screen below RegionGate."
    );
  }
  return config;
}
