// constants/region.ts
//
// Single source of truth for the region name displayed throughout the app.
// The value is read from EXPO_PUBLIC_REGION_NAME in .env so that any future
// re-skinning to a different wine region flips every "TASMANIA" / "Tasmania"
// label in the UI automatically.
//
// Convention used across screens:
//   • REGION_NAME        — mixed-case display name, e.g. "Tasmania"
//   • REGION_NAME_UPPER  — all-caps variant for the editorial label style
//
// If EXPO_PUBLIC_REGION_NAME is missing we default to "Tasmania" so the
// app never renders "undefined" and never falls back to a stale region.

export const REGION_NAME: string =
  process.env.EXPO_PUBLIC_REGION_NAME || "Tasmania";

export const REGION_NAME_UPPER: string = REGION_NAME.toUpperCase();
