// constants/theme.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for app colors, typography, spacing, and radii.
//
// Layers:
//   1. `palette` — raw color values. To re-skin, edit ONLY this.
//   2. `colors`  — semantic color tokens (background, textPrimary, accent…)
//                  that reference the palette. Screens import these.
//   3. `spacing` / `radius` / `type` / `weights` — design tokens for layout
//                  and typography. Screens import these so jitter (20 vs 24,
//                  9pt vs 10pt) becomes a one-file change.
//
// Why this matters:
//   • Every screen used to redefine a `C` object inline with subtly different
//     hex values. Now there's one place to change a shade.
//   • Semantic names mean a screen says "I want the primary text color",
//     not "I want #1F1218". Future re-skins (dark mode, seasonal palette,
//     A/B test) become a one-file edit.
//
// Usage:
//   import { colors, fonts, spacing, radius, type, weights } from "../../../constants/theme";
//   ...
//   <Text style={{ color: colors.textPrimary, ...type.lede }}/>
// ─────────────────────────────────────────────────────────────────────────────

import { Platform } from "react-native";

// ─── 1. Raw palette ──────────────────────────────────────────────────────────
// Edit these values to change the brand colors. Everything else is derived.
export const palette = {
  // Surfaces (light, "Warm Daylight")
  paper:        "#efeae0",   // primary background — paper
  paperTint:    "#F0EBE3",   // surface / chrome — chips, search bars, cards
  paperDeep:    "#E8E0D5",   // heavier surface / divider tone

  // Ink (text)
  ink:          "#1F1218",   // deep aubergine-black — primary text
  inkInverse:   "#F5F0E6",   // ivory — text on photos / dark gradients

  // Accents — Path A: deep eucalypt forest + dark caramel
  // (Both pass WCAG AA against `paper`. See README in /constants for
  //  contrast ratios.)
  forest:       "#7e1f49",   // primary accent — eucalypt green
                             //   active tab pill, hairlines, CTAs.
                             //   6.88:1 on paper — passes AA Normal + AAA Large.
  caramel:      "#c75b7b",   // secondary accent — plush
                             //   kickers, ratings, "Visit cellar door →" CTAs,
                             //   meta links. ~4.94:1 on paper — passes AA Normal.
                             //   (Replaced the prior #C99A50 which failed at 2.39:1.)
  sage:         "#7A8B6F",   // tertiary — currently unused, reserved.

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

// ─── 2. Semantic color tokens ────────────────────────────────────────────────
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
  accent:             palette.forest,       // primary CTA, hairline rule, active chip
  accentSoft:         palette.caramel,      // kicker text, rating numbers, meta links
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
  photoOverlayTop:        "rgba(0,0,0,0.35)",      // top status-bar scrim — bumped to 0.35 for legibility
  photoOverlaySoft:       inkAlpha(0.35),          // soft bottom vignette on hero photos
  photoOverlayMedium:     inkAlpha(0.42),          // medium bottom on featured cards
  photoOverlayStrong:     inkAlpha(0.78),          // strong bottom on small/dense cards
  photoOverlayDeep:       inkAlpha(0.92),          // deepest stop just before solid bg
  photoOverlayBottom:     inkAlpha(0.85),          // double-gradient companion to photoOverlayTop

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
// Family tokens.
export const fonts = {
  serif:  "Georgia",                                                          // headlines, body
  mono:   Platform.select({ ios: "Courier New", android: "monospace" }) ?? "monospace", // kickers, labels
} as const;

// Font-weight tokens — keep to two roles to avoid the 400/500/700 drift.
//   body     — default Georgia weight; pairs with italic for editorial copy.
//   emphasis — solid bold; for card titles, modal titles, partner badges.
export const weights = {
  body:     "400" as const,
  emphasis: "700" as const,
} as const;

// Type scale — multiples-of-something modular ladder.
//   10 / 12 / 14 / 17 / 22 / 28 / 36 / 44
// Roles:
//   kicker   10  — uppercase mono, wide-tracked labels
//   caption  12  — small meta text, ratings, pill labels
//   body     14  — default reading size
//   lede     17  — italic Georgia editorial first paragraph
//   h3       22  — card titles (was 20/21/24 — normalised up to 22)
//   h2       28  — sub-section titles, modal headlines
//   h1       36  — major screen headlines (was 32/34/38)
//   display  44  — hero display headline (was 42)
//
// Each role bundles family / size / line-height / tracking so screens can
// apply `...type.lede` and get the editorial pairing in one go.
export const type = {
  kicker: {
    fontFamily:    fonts.mono,
    fontSize:      10,
    letterSpacing: 2.5,
  },
  caption: {
    fontSize:      12,
    lineHeight:    16,
  },
  body: {
    fontSize:      14,
    lineHeight:    20,
  },
  lede: {
    fontFamily:    fonts.serif,
    fontSize:      17,
    fontStyle:     "italic" as const,
    fontWeight:    weights.body,
    lineHeight:    27,
  },
  h3: {
    fontFamily:    fonts.serif,
    fontSize:      22,
    fontWeight:    weights.emphasis,
    lineHeight:    27,
    letterSpacing: -0.2,
  },
  h2: {
    fontFamily:    fonts.serif,
    fontSize:      28,
    fontWeight:    weights.emphasis,
    lineHeight:    34,
    letterSpacing: -0.4,
  },
  h1: {
    fontFamily:    fonts.serif,
    fontSize:      36,
    fontStyle:     "italic" as const,
    fontWeight:    weights.body,
    lineHeight:    42,
    letterSpacing: -0.5,
  },
  display: {
    fontFamily:    fonts.serif,
    fontSize:      44,
    fontStyle:     "italic" as const,
    fontWeight:    weights.body,
    lineHeight:    50,
    letterSpacing: -0.3,
  },
} as const;

// ─── 4. Spacing ──────────────────────────────────────────────────────────────
// Multiples-of-4 ladder. Use these for padding, margin, gap.
//   xs   4   — tightest gaps (icon ↔ adjacent text)
//   sm   8   — chip gaps, inline meta gaps
//   md  12   — internal grid gutters, inset padding
//   lg  16   — card row gutters
//   xl  20   — secondary horizontal padding (rare)
//   xxl 24   — primary screen horizontal padding
//   xxxl 32  — large vertical breathing room
//   hero 40  — top-of-section margin (new section)
//   subSection 24 — between related sub-sections (alias of xxl for semantic clarity)
export const spacing = {
  xs:          4,
  sm:          8,
  md:          12,
  lg:          16,
  xl:          20,
  xxl:         24,
  xxxl:        32,
  hero:        40,
  subSection:  24,
  // Hit-target floor (Apple HIG): never let an interactive element fall below this.
  hitTarget:   44,
} as const;

// ─── 5. Radii ────────────────────────────────────────────────────────────────
// Card radius is intentionally tight (4) to keep the editorial aesthetic.
// Pill is for chips, badges, and the floating tab bar.
export const radius = {
  sharp: 0,
  card:  4,
  pill:  999,
} as const;

// ─── 6. Convenience exports ──────────────────────────────────────────────────
// Some files want all of them at once.
export const theme = { colors, fonts, palette, type, weights, spacing, radius } as const;
export default theme;
