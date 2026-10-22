// context/CoverContext.tsx
//
// Tracks whether the full-screen "cover" (the opening primer screen on the
// home tab) is still showing. The cover sits on top of the home content and
// flips away like a magazine cover when the user slides it open.
//
// While the cover is up we hide the floating tab bar so the opening screen
// reads as a separate, immersive primer — "the first thing that loads" —
// rather than a tab inside the app.
//
// Lifecycle: `coverVisible` defaults to true, so every cold start into the
// tab navigator shows the cover once. Switching tabs keeps the provider
// mounted, so once dismissed it stays dismissed for the session. A full app
// restart re-mounts the provider and the cover returns.

import React, { createContext, useCallback, useContext, useState } from "react";

type CoverContextValue = {
  coverVisible: boolean;
  dismissCover: () => void;
};

const CoverContext = createContext<CoverContextValue | undefined>(undefined);

export function CoverProvider({ children }: { children: React.ReactNode }) {
  const [coverVisible, setCoverVisible] = useState(true);
  const dismissCover = useCallback(() => setCoverVisible(false), []);

  return (
    <CoverContext.Provider value={{ coverVisible, dismissCover }}>
      {children}
    </CoverContext.Provider>
  );
}

export function useCover(): CoverContextValue {
  const ctx = useContext(CoverContext);
  if (!ctx) {
    // Safe fallback if ever used outside the provider: behave as though the
    // cover has already been dismissed so nothing gates rendering.
    return { coverVisible: false, dismissCover: () => {} };
  }
  return ctx;
}
