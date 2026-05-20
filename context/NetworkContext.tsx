// context/NetworkContext.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Tracks network connectivity and surfaces it to the rest of the app via
// useNetwork(). Used by:
//   • Boot path — if there's no connection on first launch, show an
//     ErrorScreen with retry instead of an infinite Firestore spinner.
//   • Concierge — chat surfaces a banner / clear error when offline.
//   • Per-screen retry handlers — they can check isConnected before
//     retrying to give the user a clearer "no internet" message.
//
// Implementation: thin wrapper over @react-native-community/netinfo with
// a small state machine. We treat `unknown` (NetInfo's initial value)
// as "online" optimistically — better to show content briefly than to
// show an offline error every cold start while NetInfo bootstraps.
// ─────────────────────────────────────────────────────────────────────────────

import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface NetworkContextValue {
  /** True when the device has internet connectivity (per the OS). */
  isConnected: boolean;
  /** True only when NetInfo has actually fired at least once. While false,
   *  the value of isConnected is the initial optimistic guess. Use this
   *  if you need to distinguish "not yet known" from "definitely online". */
  isSettled: boolean;
  /** Raw NetInfo state for advanced callers. */
  raw: NetInfoState | null;
}

const DEFAULT: NetworkContextValue = {
  isConnected: true, // optimistic before NetInfo fires
  isSettled: false,
  raw: null,
};

const NetworkContext = createContext<NetworkContextValue>(DEFAULT);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<NetworkContextValue>(DEFAULT);

  useEffect(() => {
    // NetInfo fires once on subscribe with the current state, then again
    // on every change. We subscribe and let the first event flip
    // isSettled to true.
    const unsubscribe = NetInfo.addEventListener((raw) => {
      // NetInfo reports `isConnected` as boolean | null. Treat null as
      // optimistic (true) — matches our initial default.
      const isConnected = raw.isConnected !== false;
      setState({ isConnected, isSettled: true, raw });
    });
    return unsubscribe;
  }, []);

  const value = useMemo(() => state, [state]);

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}

/** Hook for the rest of the app. */
export function useNetwork(): NetworkContextValue {
  return useContext(NetworkContext);
}
