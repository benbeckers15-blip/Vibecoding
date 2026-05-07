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

// ─── 1. Raw palette ──────────────────────────────────────────────────────────
// Edit these values to change the brand colors. Everything else is derived.
//
// THEME: "Forest Slate" — modern dark UI, tuned for long-form reading.
// Surfaces are not pure black: a near-black warm slate with a subtle green
// undertone harmonises with the forest/lime accents and reduces eye strain
// on text-heavy screens (article reading, winery editorial copy).
export const palette = {
  // Surfaces (dark, layered for hierarchy — each tier ~6% lighter than the last)
  paper:        "#0F1411",   // primary background — deep slate w/ green undertone
                             //   ~6% luminance — anchors the page without crushing to black.
  paperTint:    "#1A201B",   // surface / chrome — chips, search bars, cards
                             //   ~10% lift over paper so cards read as raised.
  paperDeep:    "#070A08",   // heaviest surface / divider tone — footers, inset rows
                             //   ~3% luminance — used sparingly for depth contrast.
  paperLight:   "#222823",   // elevated surface — lifted cards w/ shadow, modal panels.
                             //   ~14% — clearly "floats" off the page.

  // Ink (text)
  ink:          "#E8EAE6",   // soft off-white — primary text. Not pure white:
                             //   reduces glare on dark surfaces during sustained reading.
                             //   ~14:1 on paper — well past AAA.
  inkInverse:   "#F5F0E6",   // warm ivory — text on photos / dark gradients
                             //   (kept identical to light theme for consistent hero copy).

  // Accents — preserved per brand. These pop especially well on dark surfaces.
  forest:       "#548323",   // primary accent — eucalypt green
                             //   active tab pill, hairlines, CTAs. ~5.6:1 on paper — AA pass.
  caramel:      "#9dd560",   // secondary accent — bright lime
                             //   kickers, ratings, meta links. ~13:1 on paper — AAA pass.
                             //   (Name retained from light theme for compat; reads as lime.)
  sage:         "#7A8B6F",   // tertiary — currently unused, reserved.

  // Input / search surface — a touch lighter than `paperTint` so an input
  // feels visually pressable on dark surfaces (key UX cue: "this is editable").
  inputGray:    "#262C27",

  // Photo chrome — semi-transparent neutrals that sit over imagery.
  // Always dark, regardless of theme, since imagery is its own surface.
  glassDark:    "rgba(20,15,10,0.50)",     // dark glass — icon buttons over photos
  glassDarkAlt: "rgba(0,0,0,0.45)",        // alt darker glass — for very busy images

  // Status / semantic
  error:        "#E5705F",   // brightened terracotta — legible on dark surfaces.
} as const;

// ─── Alpha helpers ────────────────────────────────────────────────────────────
// Return ink at a given alpha. Used by the semantic layer to derive secondary
// text, dividers, etc. — keeping every translucent shade in the same hue family.
//
// In the dark theme, "ink" is light, so these produce semi-transparent LIGHT
// shades that sit on dark surfaces (secondary text, hairline borders).
const inkAlpha        = (a: number) => `rgba(232,234,230,${a})`;
const inkInverseAlpha = (a: number) => `rgba(245,240,230,${a})`;
// Photo-overlay alpha: ALWAYS dark, regardless of theme. Photo gradients
// exist to darken imagery so light text is legible on top — they must stay
// dark in dark mode (using `inkAlpha` here would lighten the photo, washing
// out captions). Tinted slightly warm to harmonise with the slate palette.
const photoInkAlpha   = (a: number) => `rgba(8,12,10,${a})`;

// ─── 2. Semantic color tokens ────────────────────────────────────────────────
// USE THESE IN SCREENS. The values point at `palette` above.
export const colors = {
  // ── Backgrounds / surfaces ──────────────────────────────────────────────
  background:         palette.paper,        // page background
  surface:            palette.paperTint,    // cards, chips, search bars
  surfaceDeep:        palette.paperDeep,    // heavier surfaces / inset rows
  surfaceElevated:    palette.paperLight,   // lifted cards (with shadow) — sleek/modern depth

  // ── Text ────────────────────────────────────────────────────────────────
  // In the dark theme `ink` is a soft off-white — these tokens read light on
  // the dark surfaces. Three steps of alpha establish a clear typographic
  // hierarchy (primary > secondary > muted) without introducing arbitrary
  // greys: every shade stays in the same hue family.
  textPrimary:        palette.ink,          // body, headlines on dark surface
  textSecondary:      inkAlpha(0.72),       // subdued body, captions
  textMuted:          inkAlpha(0.50),       // metadata, placeholders, labels
  textOnDark:         palette.inkInverse,   // text overlaid on photos/gradients
  textOnDarkMuted:    inkInverseAlpha(0.72),
  textOnDarkSubtle:   inkInverseAlpha(0.45),

  // ── Accents ─────────────────────────────────────────────────────────────
  accent:             palette.forest,       // primary CTA, hairline rule, active chip
  accentSoft:         palette.caramel,      // kicker text, rating numbers, meta links
  accentTertiary:     palette.sage,

  // Foreground color for elements that sit ON the primary accent (forest):
  // tab icon when focused, label text on a CTA button, options icon on the
  // search submit button, map cluster numbers, etc. Always near-white so
  // forest reads as a confident, high-contrast surface — independent of
  // whether `colors.background` happens to be light or dark.
  onAccent:           palette.inkInverse,

  // ── Input / search surface ──────────────────────────────────────────
  inputSurface:       palette.inputGray,     // search bars + filter chips

  // ── Borders / dividers ──────────────────────────────────────────────────
  // In the dark theme these are light-on-dark hairlines (inkAlpha returns
  // a soft off-white at the requested alpha). Two strengths give clear
  // hierarchy between divider lines and card edges.
  border:             inkAlpha(0.10),       // hairlines on dark surface
  borderStrong:       inkAlpha(0.20),
  borderOnDark:       "rgba(255,255,255,0.20)", // borders for chrome over photos

  // ── Photo / hero chrome ────────────────────────────────────────────────
  // For elements that float over imagery (icon buttons on a hero, header pills
  // on a photo). Always dark-glass for legibility, regardless of page bg.
  photoChrome:        palette.glassDark,
  photoChromeAlt:     palette.glassDarkAlt,

  // ── Photo overlays (for expo-linear-gradient stops over imagery) ───────
  // Editorial photos use DARK vignettes so overlaid text reads cleanly.
  // We use `photoInkAlpha` (deep slate) rather than `inkAlpha` (which is
  // light in dark mode) so overlays continue to darken photos rather than
  // wash them out.
  photoOverlayTop:        "rgba(0,0,0,0.35)",            // top status-bar scrim
  photoOverlaySoft:       photoInkAlpha(0.35),           // soft bottom vignette on hero photos
  photoOverlayMedium:     photoInkAlpha(0.45),           // medium bottom on featured cards
  photoOverlayStrong:     photoInkAlpha(0.80),           // strong bottom on small/dense cards
  photoOverlayDeep:       photoInkAlpha(0.94),           // deepest stop just before solid bg
  photoOverlayBottom:     photoInkAlpha(0.88),           // double-gradient companion to photoOverlayTop

  // Gradient stops that fade hero photos into the page background.
  // Use these as the *final* color in a vertical gradient so the photo
  // feels mounted on the page rather than abruptly cut off.
  // In dark mode both stops use the dark page color.
  fadeToBgSoft:           "rgba(15,20,17,0.92)",
  fadeToBg:               palette.paper,

  // ── Modal scrim ────────────────────────────────────────────────────────
  // Backdrop behind modals/bottom-sheets — always dark for legibility.
  scrim:              "rgba(0,0,0,0.65)",

  // ── Drop shadows ────────────────────────────────────────────────────────
  // Native iOS/Android shadows (`shadowColor`/`elevation`). Must remain dark
  // regardless of theme — a light shadow on a dark surface vanishes and the
  // elevation cue (cards "lifting" off the page) is lost.
  shadow:             "#000000",

  // ── Status ──────────────────────────────────────────────────────────────
  error:              palette.error,
} as const;

// ─── 3. Typography ───────────────────────────────────────────────────────────
// Family tokens.
//
// We load Playfair Display (headlines) and DM Sans (body / UI) as Google
// Fonts via `@expo-google-fonts/*` in `app/_layout.tsx`. Each weight + style
// is loaded as its own family — that's how custom fonts work on RN, where
// `fontWeight` and `fontStyle` don't reliably synthesize for non-system
// families. Pick the variant that matches the role you want.
//
// Headline weights: 700 (bold titles) and 600 (semi-bold subheadings).
// Body / UI weights: 400 and 500 via DM Sans (unchanged).
//
// `serif` defaults to 700Bold because most call sites use it for titles. Use
// `serifSemiBold` for subheadings, `serifItalic` for editorial italic lede, etc.
//
// `mono` is kept as a backward-compat alias to `sansMedium` so old call
// sites that referenced the prior monospace kicker family still resolve to
// a sensible DM Sans variant rather than the system default.
export const fonts = {
  // Headline (Playfair Display) — classic editorial serif
  serif:              "PlayfairDisplay_700Bold",
  serifRegular:       "PlayfairDisplay_400Regular",
  serifItalic:        "PlayfairDisplay_400Regular_Italic",
  serifSemiBold:      "PlayfairDisplay_600SemiBold",
  serifSemiBoldItalic:"PlayfairDisplay_600SemiBold_Italic",
  serifBold:          "PlayfairDisplay_700Bold",
  serifBoldItalic:    "PlayfairDisplay_700Bold_Italic",

  // Sans (DM Sans) — body, UI, labels
  sans:            "DMSans_400Regular",
  sansMedium:      "DMSans_500Medium",
  sansBold:        "DMSans_700Bold",

  // Display (Bebas Neue) — brand logo + hero "by the glass" headline.
  // Tall, condensed sans with a single weight; pair with extra letter-spacing.
  display:         "BebasNeue_400Regular",

  // Backward-compat aliases.
  mono:            "DMSans_500Medium",
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
    fontFamily:    fonts.sansMedium,
    fontSize:      10,
    letterSpacing: 2.5,
  },
  caption: {
    fontFamily:    fonts.sans,
    fontSize:      12,
    lineHeight:    16,
  },
  body: {
    fontFamily:    fonts.sans,
    fontSize:      14,
    lineHeight:    20,
  },
  lede: {
    fontFamily:    fonts.serifSemiBoldItalic,  // 600 italic — editorial lede
    fontSize:      17,
    lineHeight:    27,
  },
  h3: {
    fontFamily:    fonts.serifSemiBold,   // 600 — subheading weight
    fontSize:      22,
    lineHeight:    27,
    letterSpacing: -0.2,
  },
  h2: {
    fontFamily:    fonts.serifSemiBold,   // 600 — subheading weight
    fontSize:      28,
    lineHeight:    34,
    letterSpacing: -0.4,
  },
  h1: {
    fontFamily:    fonts.serifBold,       // 700 — headline weight
    fontSize:      36,
    lineHeight:    42,
    letterSpacing: -0.5,
  },
  display: {
    fontFamily:    fonts.display,           // Bebas Neue — condensed, single weight
    fontSize:      54,                      // Bebas's x-height runs small, size up
    lineHeight:    58,
    letterSpacing: 1.5,                     // wide tracking matches the brand mark
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
// cardLg is for elevated, "lifted" cards that read as standalone units —
// slightly more rounded for a sleeker, modern feel without breaking the
// editorial tone.
export const radius = {
  sharp:  0,
  card:   4,
  cardLg: 12,
  pill:   999,
} as const;

// ─── 6. Convenience exports ──────────────────────────────────────────────────
// Some files want all of them at once.
export const theme = { colors, fonts, palette, type, weights, spacing, radius } as const;
export default theme;
