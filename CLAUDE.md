# SipLocal — Project Context for Claude

## What This App Is

A hyper-regional mobile tourism app focused on the **Tasmania** wine region of Australia. Designed for both tourists and locals as a discovery, planning, and editorial hub for Tasmania's wineries and wine culture.

**Firestore project:** `winery-tourism-tasmania` (set via `EXPO_PUBLIC_FIREBASE_PROJECT_ID` in `.env`). An earlier prototype targeted a Margaret River (WA) Firestore project called `solid-garden-474012-q4` — **that project is deprecated and must not be referenced.** All app reads/writes go to `winery-tourism-tasmania` only.

**Owner:** Benjamin (benbeckers15@gmail.com)
**Goal:** Build and launch this app end-to-end using Claude (Cowork + Claude Code)
**App name (package):** `SipLocal` (Expo slug: `siplocal`, bundle id `com.siplocalguide.app`, URL scheme `siplocal`)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 54 with React Native 0.81, React 19 |
| Language | TypeScript 5.9 — **strict mode ON** |
| Router | Expo Router v6 — file-based routing (typed routes + React Compiler enabled) |
| Database | Firebase Firestore v12 (in-memory cache; persistent cache unavailable in RN — see firebaseConfig.js) |
| Auth | Firebase Auth (email/password) with AsyncStorage persistence |
| Storage | Firebase Cloud Storage |
| Local persistence | `@react-native-async-storage/async-storage` (saved items, trips) |
| Animations | React Native Reanimated v4 + Reanimated Carousel v4 |
| Maps | `react-native-maps` 1.20.1 (Google provider) + `react-native-map-clustering` |
| Location | `expo-location` (foreground only, while active trip is mounted) |
| Navigation | Custom floating animated tab bar (bottom tabs via `@react-navigation/bottom-tabs`) |
| State | React hooks + React Context (`AuthContext`, `SavedContext`, `TripContext`) — no Redux/Zustand |
| Styling | `React Native StyleSheet` + centralized design tokens in `constants/theme.ts` |
| Fonts | Google Fonts via `@expo-google-fonts/*`: Playfair Display, DM Sans, Bebas Neue, Roboto |
| Icons | `@expo/vector-icons` (Ionicons) |
| In-app browser | `expo-web-browser` (`openBrowserAsync`) |
| Images | `expo-image` (replaces RN `Image` for caching + performance) |
| AI / Concierge | OpenAI (chat completions, mini model for routing), Voyage AI (embeddings), Upstash Vector (RAG index) |
| Server scripts | `firebase-admin`, `googleapis` (Sheets sync), `node-fetch` |

---

## Project Structure

```
/
├── app/                            # Expo Router file-based routes
│   ├── _layout.tsx                 # Root: font loading, Auth/Saved/Trip providers, Stack
│   ├── index.tsx                   # Splash — redirects to /home (signed in) or /auth
│   ├── auth.tsx                    # Sign in / Create account
│   ├── trip-active.tsx             # Full-screen modal: active-trip experience
│   └── (tabs)/
│       ├── _layout.tsx             # Custom floating animated tab bar (4 visible tabs)
│       ├── home/
│       │   ├── _layout.tsx
│       │   ├── index.tsx           # Home: hero, search, featured winery, "The Pour", "The Library"
│       │   ├── pour.tsx            # "The Tassie Pour" editorial reader
│       │   └── articles/           # "The Library" — editorial article pages (linked from home)
│       │       ├── sommelier-recommendations.tsx
│       │       ├── hidden-gems.tsx
│       │       ├── vintage-reports.tsx
│       │       ├── behind-the-cellar-door.tsx
│       │       ├── pairings.tsx
│       │       └── collections/
│       │           └── [key].tsx   # Dynamic collection screen (filter by boolean tag)
│       ├── trips/
│       │   ├── _layout.tsx
│       │   ├── index.tsx           # Trips hub: premade trips + my trips + CTA
│       │   ├── create.tsx          # Build-your-own trip
│       │   └── [id].tsx            # Trip detail (premade or user)
│       ├── wineries/
│       │   ├── _layout.tsx
│       │   ├── index.tsx           # Winery list: search, filter chips, sort, list/map toggle
│       │   └── [slug].tsx          # Winery detail: parallax hero carousel, hours, badges, editorial
│       ├── profile/
│       │   ├── _layout.tsx
│       │   └── index.tsx           # Saved / Tastings / Palate
│       └── explore/
│           ├── _layout.tsx
│           └── index.tsx           # Hidden route (href: null) — preserved for inbound links
├── components/
│   ├── ConciergeChat.tsx           # In-app sommelier chat UI
│   ├── EmptyState.tsx              # Shared empty-state placeholder
│   ├── ErrorScreen.tsx             # Shared error screen (retry CTA)
│   ├── RegionGate.tsx              # Blocks rendering until active region loads
│   ├── RootErrorBoundary.tsx       # Wraps the entire app tree
│   ├── ScreenErrorBoundary.tsx     # Per-screen error boundary
│   ├── SkeletonBox.tsx             # Animated loading placeholder
│   └── articles/                   # Editorial-article rendering system
│       ├── ArticleRenderer.tsx     # Layout dispatcher (switches on article.layout)
│       ├── MagazineLayout.tsx      # Image-forward feature spread
│       ├── EditorialLayout.tsx     # Long-form prose with drop cap
│       ├── ListLayout.tsx          # Numbered editorial list
│       ├── InterviewLayout.tsx     # Q&A transcript
│       └── types.ts                # Article block types
├── constants/
│   ├── theme.ts                    # SINGLE SOURCE OF TRUTH for colors/fonts/spacing/radii
│   └── mapStyle.ts                 # Google Maps custom dark style JSON
├── context/
│   ├── AuthContext.tsx             # Firebase auth state + auto-create users/{uid} doc
│   ├── SavedContext.tsx            # AsyncStorage-backed saved cellar doors
│   └── TripContext.tsx             # AsyncStorage-backed user trips (one active at a time)
├── services/
│   └── concierge/                  # Concierge / RAG client-side services
│       ├── concierge.ts            # OpenAI wrapper (router → retrieve → respond)
│       ├── router.ts               # Cheap mini call → structured filters
│       ├── buildContext.ts         # Loads + compacts winery collection per session
│       ├── knowledgeRetrieve.ts    # Semantic search over knowledge_chunks (Upstash)
│       ├── retrieve.ts             # Description hydration for selected wineries
│       ├── tastingNotes.ts         # Wine-level retrieval from "wines" namespace
│       ├── systemPrompt.ts         # Sommelier voice + guardrails (cached prompt)
│       ├── costTracker.ts          # Per-turn token + USD accounting
│       └── driveTimes.ts           # Google Distance Matrix for trip ordering
├── types/
│   └── trip.ts                     # Trip, TripStop, TripStatus, PremadeTrip
├── utils/
│   ├── routePlanner.ts             # Google Directions optimisation (TSP-ish)
│   ├── fetchRoutePolyline.ts       # Decode driving polyline for <Polyline>
│   └── openExternalDirections.ts   # Hand off to Apple Maps / Google Maps
├── scripts/                        # Node.js admin / data-pipeline scripts (see below)
│   └── rag/                        # RAG ingest + retrieve subsystem (Voyage + Upstash)
├── assets/images/                  # App icon, splash, logos
├── firebaseConfig.js               # Initializes app, auth, db (memory cache), storage, functions
├── firestore.rules                 # Security rules (public read content, owner-only users/*)
├── firebase.json / .firebaserc     # Firebase CLI config
├── service-account-tasmania.json   # Admin SDK creds for scripts (DO NOT COMMIT)
├── app.json                        # Expo config
├── app.config.js                   # Injects EXPO_PUBLIC_GOOGLE_MAPS_API_KEY into native config
├── .env / .env.tasmania            # EXPO_PUBLIC_* env vars
├── tsconfig.json                   # strict: true, @/* paths alias
├── babel.config.js
├── eslint.config.js
├── README.md
├── TASMANIA_SETUP.md               # Region-specific setup notes
└── TASMANIA_WORKFLOW.md            # Region-specific workflow notes
```

---

## Screens — What's Built

### Splash (`app/index.tsx`)
- 2-second minimum splash + waits for Firebase auth state to resolve.
- `FadingDots` animated indicator.
- Redirects to `/home` when signed in, `/auth` otherwise.

### Auth (`app/auth.tsx`)
- Email/password sign-in & sign-up, toggled via a bottom link.
- On success, `AuthContext.onAuthStateChanged` fires, auto-creates the `users/{uid}` Firestore doc, and the splash redirects into `/home`.
- Friendly mapping of Firebase Auth error codes.

### Home (`app/(tabs)/home/index.tsx`)
- Cinematic Dusk dark hero with parallax cover image (URL + crop position read from `config/homepage` in Firestore so the hero can be re-positioned without a release).
- Glass search bar opens `ConciergeChat` (OpenAI-backed sommelier).
- Featured winery block fetched from `wineries` where `featured == true && featuredTier == 'hero'`.
- "The Tassie Pour" featured-article block reads the latest doc from `pour_articles` (sorted by `issueNumber` desc), tap → `/home/pour`.
- Article-rail entries are seeded from `explore_articles`.

### Home → Pour (`app/(tabs)/home/pour.tsx`)
- Article reader for the latest active `pour_articles` issue.
- Renders typed block list: `paragraph` (with optional drop cap), `pullquote`, `image`.
- Native `Share.share()`, sponsor block, and "continue reading" rail.

### Wineries List (`app/(tabs)/wineries/index.tsx`)
- Fetches entire `wineries` collection, sorted client-side.
- **Search:** prefix match on winery name.
- **Boolean filter chips:** Walk-ins, Award-Winning, Tours Offered, Organic, Biodynamic, Restaurant, Dog Friendly.
- **Sort modes:** `featured` / `nearMe` (uses `expo-location` foreground permission) / `az`.
- **List/Map toggle:** `FlatList` ↔ `MapView` (Google provider) with clustering and custom dark `MAP_STYLE`.
- Map markers show a `Callout` with name + rating → pushes to winery detail.
- Card surfaces a tap-to-call phone CTA when `walkinWelcome === false`.
- Save toggle uses `useSaved()` from `SavedContext`.

### Winery Detail (`app/(tabs)/wineries/[slug].tsx`)
- Routed by `slug` (which is the Firestore doc ID).
- Parallax hero carousel: `Animated.ScrollView` + `useAnimatedScrollHandler` drives `translateY` on a Reanimated Carousel in `mode="parallax"`. `HERO_HEIGHT = 400`, `PARALLAX_EXTRA = 80`.
- Info grid: hours (supports legacy string and structured `hoursStructured`), location label (derived from `REGION_NAME`).
- Contact: `tel:` call link, `safeOpenURL` for website (auto-prepends `https://`), and `openDirections()` which hands off to Apple Maps (iOS) / `geo:` URI (Android) with a Google Maps universal fallback.
- Feature badges from boolean Firestore fields (Dog Friendly / Restaurant / Organic / Biodynamic / Walk-ins / Tours / Award-Winning).
- About section: first paragraph as editorial italic lede (Playfair 600 Italic 17pt), optional `pullQuote` injected after, remaining paragraphs in body style.
- Save / share modal, custom glass-style back button overlaid on the hero.

### Trips Hub (`app/(tabs)/trips/index.tsx`)
- Editorial header + "Active Trip" banner (only when one is in progress → resumes `/trip-active`).
- **REGIONAL HALF-DAY** — horizontal rail of compact cards (≤3 stops).
- **REGIONAL FULL-DAY** — vertical stack of large cards (≥4 stops).
- "My Trips" section from `TripContext` (AsyncStorage-backed).
- Floating "+ Build Your Own" CTA → `/trips/create`.
- Curated trips are read from the `premade_trips` Firestore collection (sorted by `order`).

### Trip Create (`app/(tabs)/trips/create.tsx`)
- Pick wineries (only those with coordinates), reorder, name the trip, save.
- Validation: 2–8 stops (Google Maps multi-stop URL limit).
- Creates a Trip locally via `TripContext.createTrip()`, then routes to its detail page.

### Trip Detail (`app/(tabs)/trips/[id].tsx`)
- Two flavours via `?kind=premade|user`:
  - `premade`: read-only view. "Start Trip" clones into a fresh user Trip, runs route optimisation, pushes to `/trip-active`.
  - `user`: editable view. "Start Trip" runs route optimisation in place, flips status to `active`, pushes to `/trip-active`. If already completed, shows the read-only summary.
- Map preview with all stops; optimised order is only computed at start-time (no Directions API hit on every view).

### Trip Active (`app/trip-active.tsx`)
- Full-screen modal route outside `(tabs)`.
- Live progress bar (visited / total), optimised stop list, next-stop highlight.
- Live distance to next stop via `expo-location` foreground watch (subscribes only while mounted).
- Per-stop "Mark Visited" + auto-complete when the last stop is marked.
- "Get Directions" hands off to native maps via `openExternalDirections()`.

### Profile (`app/(tabs)/profile/index.tsx`)
- Avatar, name, location, member-since (live from `users/{uid}`).
- Stats + Saved (lists / wineries / articles) live from `users/{uid}/savedWineries`, `savedArticles`, `lists` subcollections (via `onSnapshot`).
- **Tastings** subcollection — per-bottle notes, drives a Palate breakdown chart derived on the fly.
- Inline edit modals for profile fields.

### Explore (`app/(tabs)/explore/index.tsx`)
- **Hidden from the tab bar** (`Tabs.Screen` declared with `href: null`).
- Editorial directory: latest `pour_articles` issue + static "library" rows. Kept around for any existing inbound links — long-form content has moved onto the home tab.

> **Events** and **Specials** screens have been **removed**. The old `app/(tabs)/events/` and `app/(tabs)/specials/` directories no longer exist. The `events` Firestore collection still exists (read-only) but no screen reads from it.

---

## Firebase / Backend

**Config:** `firebaseConfig.js` — reads from `.env` via `EXPO_PUBLIC_` variables. Exports:
- `auth` — Firebase Auth, persisted via `AsyncStorage` (`getReactNativePersistence`) so users stay signed in across restarts.
- `db` — Firestore. Initialized with `experimentalForceLongPolling: true` (required for Expo + non-US regions). Cache is **in-memory only** — the Firebase JS SDK's `persistentLocalCache` uses IndexedDB, which doesn't exist in React Native, so the persistent cache config silently degrades to memory and emits a boot-time warning. Reads are still cached within a single app session, but the cache is lost on cold restart. For true offline persistence we would need to migrate to `@react-native-firebase/firestore` (native modules).
- `storage` — Firebase Cloud Storage.

**Firestore Collections (current):**

| Collection | Purpose / Key Fields |
|---|---|
| `wineries` | `name`, `slug`, `description` (string[]), `pullQuote`, `phone`, `website`, `hours` (string), `hoursStructured` (per-day array), `images` (string[]), `rating`, `userRatingsTotal`, `latitude`, `longitude`, `region`, `googlePlaceId`, `dogFriendly`, `hasRestaurant`, `hasWifi`, `isOrganic`, `isBiodynamic`, `walkinWelcome`, `awardWinning`, `hasTours`, `featured` (bool), `featuredTier` (`'hero'`), `featuredLabel` (string), `boost` (number, for concierge ranking) |
| `events` | `title`, `wineryName`, `winerySlug`, `venue`, `startDate` / `endDate` (YYYY-MM-DD), `date` (legacy), `description`, `image`, `isWinerySponsored` (bool), `sourceUrl`. **Currently no in-app reader; collection is kept for future re-introduction.** |
| `homepage_carousel` | `title`, `description`, `imageUrl`, `linkTo`, `order`, `active` (bool) |
| `premade_trips` | `title`, `blurb`, `heroImage`, `durationHours`, `wineryIds` (string[]), `region`, `order` |
| `explore_articles` | Article rail entries on the Explore screen |
| `pour_articles` | "The Tassie Pour" editorial issues — `issueNumber`, `issueLabel`, `kicker`, `headline`, `author`, `date`, `readTime`, `heroImage`, `blocks[]` (typed paragraph/pullquote/image), `sponsor`, `continue` |
| `knowledge_chunks` | RAG chunked editorial prose + tasting notes. Written by `scripts/rag/ingest.js`. Read by the concierge at query time. |
| `config/{doc}` | App-wide config. `config/homepage` holds `heroImageUrl` and crop position. |
| `users/{uid}` | Per-user profile + subcollections: `savedWineries`, `savedArticles`, `lists`, `tastings`. Owner-only access. |

**Security rules (`firestore.rules`):** public read on all content collections (wineries, events, homepage_carousel, premade_trips, explore_articles, pour_articles, knowledge_chunks, config); writes only via Admin SDK in scripts. `users/{uid}` is owner-only for both read and write, including all subcollections. Everything else is denied.

**Auth:** Firebase Auth email/password is **live**. `AuthContext` listens to `onAuthStateChanged`, auto-creates the user's Firestore doc on first sign-in, and exposes `user`, `loading`, `signOut`.

---

## Design & UI Conventions

The app has been re-themed to **"Forest Slate"** — a modern dark UI tuned for long-form reading. The previous light/wine-red palette is gone. **All colors, fonts, spacing, and radii live in `constants/theme.ts`** — do not inline hex values or font names in new files.

**Theme tokens (from `constants/theme.ts`):**

- **Surfaces:**
  - `colors.background` `#0F1411` — deep slate w/ green undertone (page bg)
  - `colors.surface` `#1A201B` — chips, search bars, cards
  - `colors.surfaceDeep` `#070A08` — heaviest divider tone
  - `colors.surfaceElevated` `#222823` — lifted cards
- **Text:**
  - `colors.textPrimary` `#E8EAE6` (soft off-white) — primary body
  - `colors.textSecondary` `ink @ 72%` — captions
  - `colors.textMuted` `ink @ 50%` — metadata, placeholders
  - `colors.textOnDark` `#F5F0E6` (warm ivory) — text on photos
- **Accents:**
  - `colors.accent` `#548323` — forest green (active tab pill, CTAs, hairlines)
  - `colors.accentSoft` `#9dd560` — bright lime (kickers, ratings, meta links)
  - `colors.onAccent` `#F5F0E6` — foreground on the forest accent
- **Borders:** `colors.border` / `colors.borderStrong` (light hairlines at 10% / 20% alpha on dark surfaces)
- **Photo chrome:** `colors.photoChrome` (dark glass), `photoOverlayTop/Soft/Medium/Strong/Deep` for gradient stops over imagery
- **Status:** `colors.error` `#E5705F`

**Typography:**
- `fonts.serif` (default = Playfair Display 700 Bold) for headlines
- `fonts.serifSemiBold` / `serifSemiBoldItalic` (Playfair 600) — subheadings and editorial lede
- `fonts.serifItalic` (Playfair 400 Italic) — italic body
- `fonts.sans` / `sansMedium` / `sansBold` (DM Sans 400/500/700) — body, UI, labels
- `fonts.display` (Bebas Neue 400) — brand logo + hero "by the glass" headline
- `fonts.roboto` / `robotoMedium` — concierge chat replies
- DM Sans is wired as the **default** `<Text>` / `<TextInput>` font in `app/_layout.tsx` via `defaultProps`. Anything explicitly setting `fontFamily` (e.g. Playfair for headlines) overrides this.

**Type scale (`type.*`):** kicker 10 / caption 12 / body 14 / lede 17 / h3 22 / h2 28 / h1 36 / display 54. Each role bundles family + size + line-height + tracking so screens can `...type.lede` to get the editorial pairing in one go.

**Spacing scale (`spacing.*`):** xs 4 / sm 8 / md 12 / lg 16 / xl 20 / xxl 24 / xxxl 32 / hero 40 / subSection 24 / hitTarget 44 (Apple HIG floor).

**Radii (`radius.*`):** sharp 0 / card 4 / cardLg 12 / pill 999.

**Layout Patterns:**
- `StyleSheet` definitions go at the **bottom** of each file (existing convention).
- 24px primary screen horizontal padding (`spacing.xxl`).
- Cards: low-radius (`radius.card`) for editorial feel; `cardLg` only for elevated/lifted cards.
- Chips (filters): `radius.pill`, accent fill when active.

**Tab Bar:**
- Custom `CustomTabBar` in `app/(tabs)/_layout.tsx`.
- Floating pill, absolutely positioned 20px from bottom (iOS) / 12px (Android).
- Animated sliding **forest** pill indicator (Reanimated `withSpring`), springs on focused-tab scale and translateY.
- `TabButton` is `React.memo`.
- **Visible tabs:** Home (`home`) / Trips (`map`) / Wineries (`wine`) / Profile (`person`).
- **Hidden:** `explore` is declared with `href: null` so it stays addressable but doesn't appear in the bar.

---

## Concierge / RAG (AI sommelier)

The home-screen search bar opens an in-app sommelier that uses a cost-efficient OpenAI RAG flow.

Flow per turn:
1. **Router** (`services/concierge/router.ts`) — cheap mini call turns the free-form question into structured filters (regions, tags, keywords, day-of-week, intent). Uses prompt caching.
2. **Build context** (`services/concierge/buildContext.ts`) — winery collection is loaded once per session and compacted.
3. **Retrieve** — `retrieve.ts` hydrates descriptions for the shortlist; `knowledgeRetrieve.ts` searches the regional knowledge base (history, etiquette, food culture, seasons); `tastingNotes.ts` searches per-bottle notes. All three hit **Upstash Vector** with Voyage-embedded queries.
4. **Respond** (`services/concierge/concierge.ts`) — final OpenAI call with the cached `systemPrompt.ts` plus retrieved context.
5. **Cost tracking** (`services/concierge/costTracker.ts`) — per-turn token and USD accounting, separating fresh vs cached input.

Drive-time ordering for trip routing uses Google Distance Matrix (`services/concierge/driveTimes.ts`) — replaces naive haversine sort with actual road duration.

The knowledge base itself lives in `scripts/rag/content/*.md` (regional prose, etiquette, history, food culture, seasons, general directions, plus a `tasting-notes/` folder for individual bottles). `scripts/rag/ingest.js` chunks, tags, embeds (Voyage `voyage-3-lite`, 512-dim — matches the Upstash index dimension), and writes to **both** Upstash (vector index, namespace `knowledge`) and Firestore (`knowledge_chunks` collection). Tasting notes use a separate `wines` namespace via `scripts/rag/ingest-tasting-notes.js`.

---

## Data Pipeline Scripts (`/scripts/`)

Node.js scripts run with `node scripts/<name>.js` against the `winery-tourism-tasmania` project using `service-account-tasmania.json`.

**Ingestion / geocoding**
- `upload-tasmania-wineries.js` — upload scraped winery data (PlaceID + name) to Firestore.
- `add-missing-wineries-tasmania.js` — add hardcoded missing wineries via Places lookup.
- `geocode-tasmania-wineries.js` / `geocode-wineries.js` — pull lat/lon from Google Places.
- `fetch-place-details-tasmania.js` / `fetch-place-details.js` — pull phone / website / hours / photos.
- `extract_place_ids.js` — export all `googlePlaceId` values.
- `test-places-api.js` — smoke-test one winery against Places API.

**Cleanup / migration**
- `cleanup-duplicate-wineries-tasmania.js` / `cleanup-placeid-docs-tasmania.js` — remove PlaceID-based duplicates after re-uploading with slug IDs.
- `fix-slugs.js` — backfill `slug` from doc ID.
- `check-slugs.js`, `check-place-ids.js`, `check-coords.js` — audits.

**Enrichment**
- `merge-ratings-tasmania.js` / `merge-ratings.js` — refresh Google ratings + user_ratings_total.
- `add-hours-structured-tasmania.js` / `add-hours-structured.js` — parse hours string into `hoursStructured[]`.
- `add-featured-fields.js`, `add-award-region-fields.js`, `add-award-winning-wineries.js`, `add-winery-filters.js`, `add-boost-field.js` — backfill boolean / metadata fields.

**Validation**
- `audit-winery-fields.js` — report missing required fields.

**Sheets sync**
- `export-wineries-csv-tasmania.js` — CSV export.
- `export-to-sheets-tasmania.js` — push wineries to a Google Sheet.
- `import-from-sheets-tasmania.js` — pull updates back without overwriting blanks.

**Content / editorial**
- `seed-explore-articles.js`, `seed-pour.js`, `seed-carousel.js` — seed the editorial collections.
- `seed-premade-trips.js` / `seed-premade-trips-smart.js` — seed curated trips (smart variant resolves to live winery doc IDs).
- `generate-descriptions-tasmania.js` — auto-generate editorial winery descriptions + pull quotes via Claude; review files saved to `scripts/review/tasmania/` for human approval before upload.

**Hero image management**
- `upload-hero-image-tasmania.js` / `upload-hero-image.js` — upload to Cloud Storage and write public URL to `config/homepage.heroImageUrl`.
- `set-hero-position.js` — adjust crop (X/Y %) and zoom for the home hero.

**RAG / embeddings**
- `embed-wineries.js` — embed winery descriptions to Upstash for semantic shortlisting.
- `test-retrieval.js` — sanity-check the live index with sample queries.
- `scripts/rag/ingest.js` — chunk + tag + embed knowledge-base Markdown into Upstash + Firestore.
- `scripts/rag/ingest-tasting-notes.js` — same flow for the `wines` namespace.
- `scripts/rag/retrieve.js` — importable retriever used by client services.
- `scripts/rag/query.js` — CLI to test queries without spinning up the app.
- `scripts/rag/lib/*` — voyage-client, upstash-client, firestore-client, chunker, metadata tagger, util.

**Cost monitoring**
- `measure-token-usage.js` — send one realistic concierge query, print token usage + projected cost.
- `verify-token-savings.js` — quantify savings from prompt-shape changes.

**Schema / housekeeping**
- `updateEventsSchema.mjs` — backfill missing fields on `events` docs.
- `check-explore-articles.js` — list `explore_articles`.
- `_check-project.js`, `_check-hero.js` — temporary diagnostics (safe to delete).

> **Do not reintroduce** the deprecated WA Firestore project (`solid-garden-474012-q4`) or its credentials.

---

## Known Issues & Tech Debt

### 🟠 Medium Priority
- No `useFirestoreCollection` shared hook — fetch logic is copy-pasted across screens (the persistent Firestore cache softens this, but a hook would centralize loading/error states).
- `FlatList` missing `removeClippedSubviews` and batching props for long lists.
- No URL validation before `Linking.openURL()` on the phone `tel:` link (the website path is mitigated by `safeOpenURL`).
- The hidden `explore` tab still ships its full screen — fine for now, but worth pruning if it stops being a deep-link target.
- `_check-project.js` / `_check-hero.js` are temporary diagnostics still in the repo.

### 🟡 Lower Priority / Future
- No test framework (no Jest, no Testing Library).
- No error boundaries.
- No server-side search or pagination (all client-side; OK at current data volume).
- No push notifications.
- Several `expo-*` packages declared but lightly used (`expo-haptics`, `expo-constants`, `expo-symbols`, `expo-system-ui`) — review and prune.

---

## Roadmap / Planned Features

- [ ] Decide whether to re-introduce an Events surface or fold events into the home rail.
- [ ] Decide whether to re-introduce a Specials surface (was previously a placeholder; now removed).
- [ ] Push notifications for trip reminders + new "Pour" issues.
- [ ] Offline tile pre-cache for active-trip map.
- [ ] Submit to App Store and Google Play.
- [ ] Concierge memory across turns (currently each turn is stateless beyond the system prompt).

---

## Development Notes

- **Run:** `npx expo start` (uses `app.config.js` so the Google Maps API key from `.env` is injected into native config)
- **iOS simulator:** `npx expo run:ios`
- **Android:** `npx expo run:android`
- **Lint:** `npm run lint` (`expo lint`)
- TypeScript strict mode is **ON** — keep all types explicit, avoid `any`.
- Prefer functional components with hooks.
- `StyleSheet` definitions go at the **bottom** of each file (existing convention).
- Use design tokens from `constants/theme.ts`. Do **not** inline hex colors or raw font family strings in new code — add a token if you need one.
- **Shared state:** React Context only (`AuthContext`, `SavedContext`, `TripContext`). Add a new Context before reaching for Redux/Zustand.
- Firebase config reads from `.env` via `EXPO_PUBLIC_` variables — never hardcode secrets.
- `service-account-tasmania.json` is for Admin SDK in scripts — **do not commit this to git**.
- The deprecated WA Firestore project (`solid-garden-474012-q4`) is no longer used; reject any code or config that references it.

## Working with This Codebase

When making changes:
1. Keep TypeScript strict — define interfaces for all Firestore data shapes (see `types/trip.ts` for the pattern).
2. Follow Expo Router's file-based routing structure.
3. Match the existing **dark editorial** aesthetic: forest-slate surfaces, Playfair serif for titles, DM Sans for body, lime/forest accents, low-radius cards.
4. Pull colors, fonts, spacing, and radii from `constants/theme.ts` — never inline hex.
5. For anything region-specific in UI copy, use `REGION_NAME` / `REGION_NAME_UPPER` from `constants/region.ts` so the app is re-skinnable to another wine region by flipping `EXPO_PUBLIC_REGION_NAME` in `.env`.
6. Test on both iOS and Android where possible (Google Maps provider and `expo-location` permissions in particular).
7. Never commit `.env`, `.env.tasmania`, or `service-account-tasmania.json`.
