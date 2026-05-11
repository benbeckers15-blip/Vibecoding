// context/TripContext.tsx
// Persists user-created trips locally via AsyncStorage. Mirrors the pattern
// established by SavedContext — single source of truth, hooks, fire-and-
// forget persistence.
//
// Usage:
//   const { trips, activeTrip, createTrip, startTrip, … } = useTrips();
//
// State shape on disk: a JSON-serialised Trip[] under STORAGE_KEY.
// Only one trip can be `active` at a time — startTrip() enforces this by
// demoting any other active trip back to not_started.

import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Trip, TripStop } from "../types/trip";

const STORAGE_KEY = "user_trips_v1";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TripContextValue {
  /** All user-created trips (most recent first). */
  trips: Trip[];
  /** The single trip currently in `active` status, if any. */
  activeTrip: Trip | null;
  /** True until the initial AsyncStorage hydration completes. */
  loading: boolean;

  /** Create a new trip from a list of stops. Returns the new trip's id. */
  createTrip: (name: string, stops: TripStop[]) => string;
  /** Replace the stops on an existing trip (used after route optimisation). */
  setTripStops: (
    tripId: string,
    stops: TripStop[],
    routeOptimised: boolean
  ) => void;
  /** Move a trip into `active` status. Demotes any other active trip. */
  startTrip: (tripId: string) => void;
  /** Mark a single stop visited. Auto-completes the trip if it was the last. */
  markStopVisited: (tripId: string, wineryId: string) => void;
  /** Manually mark a trip completed. */
  completeTrip: (tripId: string) => void;
  /** Permanently delete a trip. */
  deleteTrip: (tripId: string) => void;
  /** Look up a trip by id. */
  getTrip: (tripId: string) => Trip | undefined;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const TripContext = createContext<TripContextValue>({
  trips: [],
  activeTrip: null,
  loading: true,
  createTrip: () => "",
  setTripStops: () => {},
  startTrip: () => {},
  markStopVisited: () => {},
  completeTrip: () => {},
  deleteTrip: () => {},
  getTrip: () => undefined,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

const generateId = () =>
  `trip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ─── Provider ─────────────────────────────────────────────────────────────────

export function TripProvider({ children }: { children: React.ReactNode }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  // Hydrate from disk on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed: Trip[] = JSON.parse(raw);
          if (!Array.isArray(parsed)) return;
          // Self-heal: strip any stops with non-finite coords. These can land
          // in storage from earlier app builds where create.tsx filtered with
          // a leaky `typeof === "number"` (which lets NaN through). Once a
          // NaN-coord stop reaches react-native-maps with PROVIDER_GOOGLE on
          // iOS, it crashes the screen — so cleaning here means existing bad
          // trips repair themselves on next launch instead of remaining
          // permanently wedged on disk.
          let mutated = false;
          const cleaned = parsed.map((t) => {
            if (!Array.isArray(t.stops)) return t;
            const cleanStops = t.stops.filter(
              (s) =>
                Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
            );
            if (cleanStops.length !== t.stops.length) {
              mutated = true;
              if (__DEV__) {
                console.warn(
                  `[TripContext] dropped ${
                    t.stops.length - cleanStops.length
                  } stop(s) with non-finite coords from trip ${t.id}`
                );
              }
              return { ...t, stops: cleanStops };
            }
            return t;
          });
          setTrips(cleaned);
          // Persist the cleaned list back so the next hydrate is a no-op.
          if (mutated) {
            AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned)).catch(
              () => {}
            );
          }
        } catch {
          // Corrupt data — start fresh
        }
      })
      .catch(() => {
        // Storage unavailable — degrade gracefully (in-memory only)
      })
      .finally(() => setLoading(false));
  }, []);

  // Fire-and-forget persistence on every mutation
  const persist = useCallback((next: Trip[]) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const updateTrips = useCallback(
    (updater: (prev: Trip[]) => Trip[]) => {
      setTrips((prev) => {
        const next = updater(prev);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const createTrip = useCallback(
    (name: string, stops: TripStop[]) => {
      const id = generateId();
      const trip: Trip = {
        id,
        name: name.trim() || "Untitled Trip",
        stops,
        status: "not_started",
        currentStopIndex: 0,
        visitedStopIds: [],
        routeOptimised: false,
        createdAt: nowIso(),
      };
      updateTrips((prev) => [trip, ...prev]);
      return id;
    },
    [updateTrips]
  );

  const setTripStops = useCallback(
    (tripId: string, stops: TripStop[], routeOptimised: boolean) => {
      updateTrips((prev) =>
        prev.map((t) =>
          t.id === tripId ? { ...t, stops, routeOptimised } : t
        )
      );
    },
    [updateTrips]
  );

  const startTrip = useCallback(
    (tripId: string) => {
      updateTrips((prev) =>
        prev.map((t) => {
          if (t.id === tripId) {
            return {
              ...t,
              status: "active" as const,
              startedAt: nowIso(),
              currentStopIndex: 0,
              visitedStopIds: [],
            };
          }
          // Demote any other active trip to not_started — only one trip
          // can be running at a time.
          if (t.status === "active") {
            return { ...t, status: "not_started" as const };
          }
          return t;
        })
      );
    },
    [updateTrips]
  );

  const markStopVisited = useCallback(
    (tripId: string, wineryId: string) => {
      updateTrips((prev) =>
        prev.map((t) => {
          if (t.id !== tripId) return t;
          if (t.visitedStopIds.includes(wineryId)) return t;
          const visited = [...t.visitedStopIds, wineryId];
          // Move the cursor to the first stop that isn't visited yet
          const nextIdx = t.stops.findIndex(
            (s) => !visited.includes(s.wineryId)
          );
          const allDone = nextIdx === -1;
          return {
            ...t,
            visitedStopIds: visited,
            currentStopIndex: allDone ? t.stops.length : nextIdx,
            status: allDone ? ("completed" as const) : t.status,
            completedAt: allDone ? nowIso() : t.completedAt,
          };
        })
      );
    },
    [updateTrips]
  );

  const completeTrip = useCallback(
    (tripId: string) => {
      updateTrips((prev) =>
        prev.map((t) =>
          t.id === tripId
            ? { ...t, status: "completed" as const, completedAt: nowIso() }
            : t
        )
      );
    },
    [updateTrips]
  );

  const deleteTrip = useCallback(
    (tripId: string) => {
      updateTrips((prev) => prev.filter((t) => t.id !== tripId));
    },
    [updateTrips]
  );

  const getTrip = useCallback(
    (tripId: string) => trips.find((t) => t.id === tripId),
    [trips]
  );

  // ─── Derived ────────────────────────────────────────────────────────────────

  const activeTrip = useMemo(
    () => trips.find((t) => t.status === "active") ?? null,
    [trips]
  );

  const value = useMemo<TripContextValue>(
    () => ({
      trips,
      activeTrip,
      loading,
      createTrip,
      setTripStops,
      startTrip,
      markStopVisited,
      completeTrip,
      deleteTrip,
      getTrip,
    }),
    [
      trips,
      activeTrip,
      loading,
      createTrip,
      setTripStops,
      startTrip,
      markStopVisited,
      completeTrip,
      deleteTrip,
      getTrip,
    ]
  );

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** Use in any screen: const { trips, activeTrip, createTrip } = useTrips() */
export function useTrips(): TripContextValue {
  return useContext(TripContext);
}
