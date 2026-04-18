# WineryTourism — Project Context for Claude

## What This App Is

A hyper-regional mobile tourism app focused on the **Margaret River** wine region of Western Australia. Designed for both tourists and locals. The app is a discovery and editorial hub for the region's wineries, events, and content.

**Owner:** Benjamin (benbeckers15@gmail.com)
**Goal:** Build and launch this app end-to-end using Claude (Cowork + Claude Code)
**App name (package):** `winerytourism`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 54 with React Native 0.81 |
| Language | TypeScript 5.9 — **strict mode ON** |
| Router | Expo Router v6 — file-based routing |
| Database | Firebase Firestore v12 |
| Storage | Firebase Cloud Storage |
| Animations | React Native Reanimated v4 + Reanimated Carousel v4 |
| Maps | `react-native-maps` 1.20.1 + `react-native-map-clustering` |
| Navigation | Custom floating animated tab bar (bottom tabs via `@react-navigation/bottom-tabs`) |
| State | React hooks only (`useState`, `useEffect`, `useCallback`, `useMemo`) — no Redux/Zustand |
| Styling | `React Native StyleSheet` — no Tailwind, no CSS-in-JS |
| Icons | `@expo/vector-icons` (Ionicons) |
| In-app browser | `expo-web-browser` (`openBrowserAsync`) |
| AI | `@anthropic-ai/sdk` installed — used in data pipeline scripts for winery classification |

---

## Project Structure

```
/
├── app/
│   ├── _layout.tsx              # Root layout
│   ├── index.tsx                # Splash / loading screen (redirects to home tab)
│   └── (tabs)/
│       ├── _layout.tsx          # Custom floating animated tab bar
│       ├── home/
│       │   ├── _layout.tsx
│       │   └── index.tsx        # Homepage: hero carousel + featured winery + explore cards
│       ├── wineries/
│       │   ├── _layout.tsx
│       │   ├── index.tsx        # Winery list: search, filter chips, rating filter, list/map toggle
│       │   └── [slug].tsx       # Winery detail: parallax hero carousel, info grid, badges, editorial
│       ├── events/
│       │   ├── _layout.tsx
│       │   └── index.tsx        # Events: list/calendar toggle, time/winery filters, event cards
│       └── specials/
│           ├── _layout.tsx
│           └── index.tsx        # PLACEHOLDER — not yet implemented
├── assets/images/               # App icon, splash, etc.
├── scripts/                     # Node.js data pipeline scripts (see section below)
├── firebaseConfig.js            # Firebase init — exports `db` and `storage`
├── .env                         # Firebase credentials via EXPO_PUBLIC_ env vars
├── package.json
├── tsconfig.json
├── babel.config.js
├── eslint.config.js
└── app.json                     # Expo config
```

---

## Screens — What's Built

### Home (`app/(tabs)/home/index.tsx`)
- Auto-playing carousel fetched from `homepage_carousel` Firestore collection (filtered to `active: true`, sorted by `order`)
- Tap detection uses `touchStartX` ref to differentiate taps from carousel swipes
- Featured winery block: queries `wineries` where `featured == true && featuredTier == 'hero'`
- Explore cards grid: links to Events, Specials, and two placeholder screens ("Somm's Picks", "Private Dinners")
- Screen background is **white** (`#fff`) with a light editorial aesthetic

### Wineries List (`app/(tabs)/wineries/index.tsx`)
- Fetches entire `wineries` collection on mount, sorted alphabetically client-side
- **Search:** prefix match on winery name
- **Boolean filter chips:** Dog Friendly, Restaurant, Organic, Biodynamic, Walk-ins Welcome
- **Rating filter:** All / 4.0+ / 4.3+ / 4.5+
- **List/Map toggle:** switches between `FlatList` and `MapView` (with clustering)
- Map uses `MARGARET_RIVER_REGION` as initial region (`latitude: -33.95, longitude: 115.07`)
- Map markers show `Callout` with name, rating, and "TAP TO VIEW ›" → pushes to winery detail

### Winery Detail (`app/(tabs)/wineries/[slug].tsx`)
- Routed by `slug` field (document ID in Firestore)
- Parallax hero: `Animated.ScrollView` + `useAnimatedScrollHandler` drives `translateY` on carousel
- Hero carousel in `mode="parallax"` with `HERO_HEIGHT = 380`, extra `PARALLAX_EXTRA = 80`
- Info grid: Hours / Location (always "Margaret River")
- Contact buttons: CALL (tel link) and WEBSITE (`safeOpenURL` function handles missing protocol)
- Feature badges (shown only if `true` in Firestore): Dog Friendly 🐕, Restaurant 🍽, Organic 🌿, Biodynamic 🌱
- About section: first paragraph styled as italic lede (Georgia 17pt), optional `pullQuote` injected after first paragraph, remaining paragraphs in body style
- `description` field is an **array of strings** (paragraphs); `images` is an **array of URLs**
- Share button uses native `Share.share()`
- Custom back button overlaid on hero ("‹ Wineries")

### Events (`app/(tabs)/events/index.tsx`)
- Fetches `events` collection, sorted by `startDate` ascending
- **Time filter chips:** All / Today / This Week / This Month
- **Winery Sponsored toggle chip**
- **List/Calendar toggle:** calendar icon button in header switches view mode
- `CalendarView` component: full month grid with prev/next navigation, dots on dates with events, tap a day to filter list to that day
- Events support date ranges (`startDate` + optional `endDate`, both "YYYY-MM-DD")
- Legacy `date` field still supported for backward compatibility
- Event cards: hero image with gradient, date badge (top-left), sponsored badge (top-right, `#4B0E15`)
- Tapping card opens `sourceUrl` in in-app browser (`openBrowserAsync`) or navigates to winery detail

### Specials (`app/(tabs)/specials/index.tsx`)
- **Placeholder only** — empty screen, not yet implemented

---

## Firebase / Backend

**Config:** `firebaseConfig.js` — reads from `.env` via `EXPO_PUBLIC_` variables. Exports:
- `db` — Firestore instance (`experimentalForceLongPolling: true` for Expo/non-US region compatibility)
- `storage` — Firebase Cloud Storage instance

**Firestore Collections:**

| Collection | Key Fields |
|---|---|
| `wineries` | `name`, `slug`, `description` (string[]), `pullQuote` (string), `phone`, `website`, `hours`, `images` (string[]), `rating`, `userRatingsTotal`, `latitude`, `longitude`, `dogFriendly`, `hasRestaurant`, `isOrganic`, `isBiodynamic`, `walkinWelcome`, `featured` (bool), `featuredTier` ('hero'), `featuredLabel` (string) |
| `homepage_carousel` | `title`, `description`, `imageUrl`, `linkTo`, `order`, `active` (bool) |
| `events` | `title`, `wineryName`, `winerySlug`, `venue`, `startDate` (YYYY-MM-DD), `endDate` (YYYY-MM-DD), `date` (legacy), `description`, `image`, `isWinerySponsored` (bool), `sourceUrl` |

**Auth:** Not yet implemented — all Firestore reads are currently unauthenticated (no security rules).

---

## Design & UI Conventions

**Typography:**
- Headlines / editorial titles: `fontFamily: "Georgia"` (serif, bold)
- First paragraph on winery detail: Georgia italic, 17pt, acts as an editorial lede
- Pull quote: Georgia italic, 20pt, with left `#940c0c` border bar
- Labels / metadata: system font, small size (9–11pt), heavy `letterSpacing` (2–4)
- Body: system font

**Color Palette (actual values from code):**
- `#1a1a1a` — primary dark (text, active tab bar, toggle backgrounds, map markers)
- `#fff` — screen backgrounds (all screens are light/white, NOT dark)
- `#faf9f6` — off-white/cream (about section backgrounds, carousel placeholder)
- `#940c0c` — wine red accent (card titles, section label dividers, pull quote bar)
- `#4B0E15` — dark burgundy (sponsored event badges, calendar event dots)
- `#e0e0e0` / `#e8e8e8` — border/divider lines
- `#999` / `#aaa` / `#ccc` — secondary text, labels, placeholders
- Tab bar: `#1a1a1a` background, `#faf9f6` sliding pill indicator for active tab

**Layout Patterns:**
- `StyleSheet` definitions always go at the **bottom** of the file
- Consistent 24px horizontal padding on screens
- Divider rows: `flex: 1` lines + uppercase spaced label in center
- Cards: `borderWidth: 1, borderColor: "#e8e8e8"`, no `borderRadius` (sharp/editorial style)
- Chips (filters): `borderRadius: 999` (pill), black fill when active
- No global style constants file — colors are inlined per file

**Tab Bar:**
- Custom `CustomTabBar` component in `app/(tabs)/_layout.tsx`
- Floating pill shape, absolutely positioned 20px from bottom (iOS) / 12px (Android)
- Animated sliding `#faf9f6` circle indicator (Reanimated `withSpring`)
- `TabButton` is `React.memo` with spring animations on scale and translateY
- Tabs: Home (home icon), Events (calendar), Specials (star), Wineries (wine)

---

## Data Pipeline Scripts (`/scripts/`)

Node.js scripts for seeding and managing Firestore data. Run with `node scripts/<name>.js`.

| Script | Purpose |
|---|---|
| `update_firestore.js` | Bulk update winery documents in Firestore |
| `seed-carousel.js` | Seed the `homepage_carousel` collection |
| `geocode-wineries.js` | Add lat/lng to winery docs via Google Geocoding API |
| `extract_place_ids.js` | Extract Google Place IDs from winery data |
| `merge-ratings.js` | Merge Google Places ratings into winery documents |
| `add-featured-fields.js` | Add `featured`, `featuredTier`, `featuredLabel` fields |
| `add-winery-filters.js` | Add boolean filter fields to winery docs |
| `classify.js` | Uses `@anthropic-ai/sdk` to classify wineries (style, vibe, etc.) |
| `fix_ids.js` | Fix document IDs / slugs |
| `remove_lamonts.js` | Remove a specific winery entry |
| `updateEventsSchema.mjs` | Migrate events schema to new format |

JSON data files in root: `margswineryreviews1.json`, `margswineryreviews2.json`, `winery_classifications_all.json`, `place_ids.txt`

---

## Known Issues & Tech Debt

### 🔴 High Priority
- **Dead navigation links on home screen:** "Somm's Picks" and "Private Dinners" cards both navigate to `/wineries` as a fallback — the intended `/somms-picks` and `/private-dinners` routes don't exist yet
- **Specials tab is empty** — shows a placeholder; should either be hidden from nav until built or implemented
- **`testCollection` in Firestore** — debug artifact, should be deleted from DB (there may also be test code in `_layout.tsx` — check and remove)

### 🟠 Medium Priority
- No `useFirestoreCollection` shared hook — fetch logic is copy-pasted across screens
- No data caching — every screen fetches fresh from Firestore on every mount
- Animated tab bar creates Reanimated hooks inside `.map()` — `TabButton` is already `React.memo`'d but the `useSharedValue` instances in the parent loop is the real concern
- `FlatList` missing `removeClippedSubviews` and batching props for long lists
- No Firestore security rules
- No URL validation before `Linking.openURL()` on phone/website fields (mitigated by `safeOpenURL` on website but phone link is raw)

### 🟡 Lower Priority / Future
- No test framework (no Jest, no Testing Library)
- No error boundaries
- No image caching (consider `react-native-fast-image`)
- No server-side search or pagination (all client-side)
- No offline support
- No user authentication
- Unused packages: `expo-haptics`, `expo-constants`, `expo-status-bar`, `expo-system-ui`, `expo-symbols`

---

## Roadmap / Planned Features

- [ ] Build Specials screen
- [ ] Build `/somms-picks` and `/private-dinners` screens (or rethink home card links)
- [ ] Add user authentication (Firebase Auth)
- [ ] Add Firestore security rules
- [ ] Add articles/editorial section (screen + Firestore collection)
- [ ] Data caching / offline support
- [ ] Push notifications for events
- [ ] Submit to App Store and Google Play

---

## Development Notes

- **Run:** `npx expo start`
- **iOS simulator:** `npx expo run:ios`
- **Android:** `npx expo run:android`
- TypeScript strict mode is **ON** — keep all types explicit, avoid `any`
- Prefer functional components with hooks
- `StyleSheet` definitions go at the **bottom** of each file (existing convention)
- No global state management — if adding shared state, prefer React Context before Redux/Zustand
- Firebase config reads from `.env` via `EXPO_PUBLIC_` variables — never hardcode secrets
- The `service-account.json` in root is for Admin SDK in scripts — **do not commit this to git**

## Working with This Codebase

When making changes:
1. Keep TypeScript strict — define interfaces for all Firestore data shapes
2. Follow Expo Router's file-based routing structure
3. Match the existing editorial aesthetic: light backgrounds, Georgia serif for titles, wide letter-spacing on labels, sharp-cornered cards
4. All colors are inlined in each file's `StyleSheet` — use the palette values above
5. Test on both iOS and Android where possible
6. Never commit `.env` or `service-account.json`
