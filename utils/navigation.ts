// utils/navigation.ts
//
// Safe "back" for header back buttons. `router.back()` on a screen with
// nothing beneath it in the stack (e.g. the first screen of a tab, or a screen
// opened from a deep link / tab-bar reset) is a no-op that logs
// "The action 'GO_BACK' was not handled by any navigator". Instead, fall back
// to a sensible parent route so the button always does something.

import { router, type Href } from "expo-router";

export function goBackOr(fallback: Href): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}
