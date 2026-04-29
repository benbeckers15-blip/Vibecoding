// constants/theme.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for app colors and typography.
//
// Two layers:
//   1. `palette` — the actual color values. To re-skin the app, edit ONLY this.
//   2. `colors`  — semantic tokens (background, textPrimary, accent, border…)
//                  that reference the palette. Screens import these.
//
// Why this matters:
//   • Every screen used to redefine a `C` object inline with subtly different
//     hex values. Now there's one place to change a shade.
//   • Semantic names mean a screen says "I want the primary text color",
//     not "I want #1F1218". Future re-skins (dark mode, seasonal palette,
//     A/B test) become a one-file edit.
//
// Usage:
//   import { colors, fonts } from "../../../constants/theme";
//   ...
//   <Text style={{ color: colors.textPrimary, fontFamily: fonts.serif }}/>
// ─────────────────────────────────────────────────────────────────────────────

import { Platform } from "react-native";

// ─── 1. Raw palette ──────────────────────────────────────────────────────────
// Edit these values to change the brand colors. Everything else is derived.
export const palette = {
  // Surfaces (light, "Warm Daylight")
  paper:        "#FAF7F2",   // primary background — warm off-white
  paperTint:    "#F0EBE3",   // surface / chrome — chips, search bars, cards
  paperDeep:    "#E8E0D5",   // heavier surface / divider tone

  // Ink (text)
  ink:          "#1F1218",   // deep aubergine-black — primary text
  inkInverse:   "#F5F0E6",   // ivory — text on photos / dark gradients

  // Accents
  gold:         "#385e45",   // primary gold — buttons, accent rules, active state
  goldLight:    "#C99A50",   // softer gold — meta text, secondary accents
  sage:         "#7A8B6F",   // eucalypt green — tertiary accent (currently unused
                             // but reserved if you want a 3rd color)

  // Photo chrome — semi-transparent neutrals that sit over imagery
  glassDark:    "rgba(20,15,10,0.50)",     // dark glass — icon buttons over photos
  glassDarkAlt: "rgba(0,0,0,0.45)",        // alt darker glass — for very busy images

  // Status / semantic
  error:        "#B43A3A",   // wine-red error tone — kept warm to fit palette
} as const;

// ─── Alpha helpers ────────────────────────────────────────────────────────────
// Return ink at a given alpha. Used by the semantic layer to derive secondary
// text, dividers, etc. — keeping every translucent gray in the same hue family.
const inkAlpha        = (a: number) => `rgba(31,18,24,${a})`;
const inkInverseAlpha = (a: number) => `rgba(245,240,230,${a})`;

// ─── 2. Semantic tokens ──────────────────────────────────────────────────────
// USE THESE IN SCREENS. The values point at `palette` above.
export const colors = {
  // ── Backgrounds / surfaces ──────────────────────────────────────────────
  background:         palette.paper,        // page background
  surface:            palette.paperTint,    // cards, chips, search bars
  surfaceDeep:        palette.paperDeep,    // heavier surfaces / inset rows

  // ── Text ────────────────────────────────────────────────────────────────
  textPrimary:        palette.ink,          // body, headlines on paper
  textSecondary:      inkAlpha(0.65),       // subdued body, captions
  textMuted:          inkAlpha(0.40),       // metadata, placeholders, labels
  textOnDark:         palette.inkInverse,   // text overlaid on photos/gradients
  textOnDarkMuted:    inkInverseAlpha(0.72),
  textOnDarkSubtle:   inkInverseAlpha(0.45),

  // ── Accents ─────────────────────────────────────────────────────────────
  accent:             palette.gold,         // primary CTA, gold rule, active chip
  accentSoft:         palette.goldLight,    // kicker text, hover/secondary accent
  accentTertiary:     palette.sage,

  // ── Borders / dividers ──────────────────────────────────────────────────
  border:             inkAlpha(0.10),       // hairlines on paper
  borderStrong:       inkAlpha(0.20),
  borderOnDark:       "rgba(255,255,255,0.20)", // borders for chrome over photos

  // ── Photo / hero chrome ────────────────────────────────────────────────
  // For elements that float over imagery (icon buttons on a hero, header pills
  // on a photo). Always dark-glass for legibility, regardless of page bg.
  photoChrome:        palette.glassDark,
  photoChromeAlt:     palette.glassDarkAlt,

  // ── Photo overlays (for expo-linear-gradient stops over imagery) ───────
  // Editorial photos use dark ink-toned vignettes so overlaid text reads
  // cleanly. All stops below derive from `palette.ink` so they stay in the
  // same hue family — no random "rgba(44,20,28,…)" drift.
  photoOverlayTop:        "rgba(0,0,0,0.30)",      // top status-bar scrim
  photoOverlaySoft:       inkAlpha(0.35),          // soft bottom vignette on hero photos
  photoOverlayMedium:     inkAlpha(0.42),          // medium bottom on featured cards
  photoOverlayStrong:     inkAlpha(0.78),          // strong bottom on small/dense cards
  photoOverlayDeep:       inkAlpha(0.92),          // deepest stop just before solid bg

  // Gradient stops that fade hero photos into the page background.
  // Use these as the *final* color in a vertical gradient so the photo
  // feels mounted on the page rather than abruptly cut off.
  fadeToBgSoft:           "rgba(250,247,242,0.92)",
  fadeToBg:               palette.paper,

  // ── Modal scrim ────────────────────────────────────────────────────────
  // Backdrop behind modals/bottom-sheets — always dark for legibility.
  scrim:              "rgba(0,0,0,0.65)",

  // ── Status ──────────────────────────────────────────────────────────────
  error:              palette.error,
} as const;

// ─── 3. Typography ───────────────────────────────────────────────────────────
// JetBrains Mono substitute — platform monospace.
export const fonts = {
  serif:  "Georgia",                                                          // headlines, body
  mono:   Platform.select({ ios: "Courier New", android: "monospace" }) ?? "monospace", // kickers, labels
} as const;

// ─── 4. Convenience exports ──────────────────────────────────────────────────
// Some files want all three at once.
export const theme = { colors, fonts, palette } as const;
export default theme;
