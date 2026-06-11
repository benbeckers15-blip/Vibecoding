# SipLocal — Project Context for Claude

> **Last verified: 2026-06-11** — every claim below was checked against the code on this date.

## What This App Is

A regional mobile wine-tourism app — discovery, trip planning, and editorial hub for a wine region's wineries and wine culture. **Multi-region by architecture**: one binary serves any number of regions; content is partitioned by a `regionId` field and per-region config lives in a `regions/{regionId}` Firestore collection. **Tasmania is the only live region today.**

**Firestore project:** `winery-tourism-tasmania` (set via `EXPO_PUBLIC_FIREBASE_PROJECT_ID` in `.env`). An earlier prototype targeted a Margaret River (WA) Firestore project called `solid-garden-474012-q4` — **that project is deprecated and must not be referenced.**

**Owner:** Benjamin (benbeckers15@gmail.com)
**Goal:** Build and launch this app end-to-end using Claude (Cowork + Claude Code)
**App name (package):** `SipLocal` (Expo slug: `siplocal`, bundle id `com.siplocalguide.app`, URL scheme `siplocal`)

> **SECURITY:** `.env.tasmania` (including the Google Maps API key) exists in git history (commit `4080e9a`, pushed to GitHub remotes). **Rotating that key is recommended.** Never commit `.env*` files — `.gitignore` now covers them, but history is history.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 54 with React Native 0.81, React 19 |
| Language | TypeScript 5.9 — **strict mode ON** |
| Router | Expo Router v6 — file-based routing (typed routes + React Compiler enabled) |
| Database | Firebase Firestore v12 (in-memory cache only; persistent cache unavailable in RN — see firebaseConfig.js) |
| Auth | Firebase Auth (email/password) with AsyncStorage persistence |
| Storage | Firebase Cloud Storage |
| Backend | **Firebase Cloud Functions Gen2 (TypeScript, Node 22) in `functions/`** — concierge (SSE streaming), deleteAccount (callable), ping, testEmbed |
| AI / Concierge (server-side) | OpenAI (router/resolver), Gemini (response leg, `LLM_PROVIDER` default `gemini`), Voyage AI embeddings, Upstash Vector, Langfuse observability |
| Local persistence | `@react-native-async-storage/async-storage` (active region id, trips, session id) |
| Network state | `@react-native-community/netinfo` via `context/NetworkContext.tsx` |
| Animations | React Native Reanimated v4 + Reanimated Carousel v4 |
| Maps | `react-native-maps` 1.20.1 (Google provider) + `react-native-map-clustering` |
| Location | `expo-location` (foreground only) |
| Navigation | Custom floating animated tab bar (`@react-navigation/bottom-tabs`) |
| State | React hooks + Context (`RegionContext`, `AuthContext`, `SavedContext`, `TripContext`, `NetworkContext`) — no Redux/Zustand |
| Styling | RN `StyleSheet` + centralized design tokens in `constants/theme.ts` |
| Fonts | `@expo-google-fonts/*`: Playfair Display, DM Sans, Bebas Neue, Roboto |
| Icons | `@expo/vector-icons` (Ionicons) |
| Images | `expo-image` |
| Streaming fetch | `expo/fetch` (RN's fetch can't stream — needed for the concierge SSE typewriter) |

---

## Multi-Region Architecture (the big one)

The old hardcoded-Tasmania setup (`constants/region.ts`, `REGION_NAME` env var) is **gone**. Replaced by:

- **`regions/{regionId}` Firestore collection** — one doc per region: `displayName`, `brandVoiceLine`, `regionalPrimer` (markdown for the concierge system prompt), `subRegions[]` (name/lat/lon/adjacent — optional, regions may be flat), `suggestedPrompts`, `mapBounds`, `timezone`, `regionAdjective`, `schemaVersion`, etc. Schema in **`types/region.ts`** (`RegionConfig`, `SubRegion`, `RegionMapBounds`, `RegionSummary`) — shared by client AND Cloud Functions.
- **`context/RegionContext.tsx`** — owns the active region. States: `loading` / `needs_picker` / `ready` / `error`. Persists choice to AsyncStorage (`active_region_id_v1`); auto-selects when exactly one region exists (Tasmania-only users never see the picker). Hooks: `useRegion()`, `useActiveRegionId()`, `useRegionConfig()` (the latter two are only safe below the gate).
- **`components/RegionGate.tsx`** — blocks the Stack from rendering until the region settles; renders the picker directly for `needs_picker`, `ErrorScreen` (network-aware via `NetworkContext`) on failure.
- **`app/region-picker.tsx`** — full-screen picker, also addressable at `/region-picker` for switching later.
- **`regionId` field on every content document** — all content screens query with `where("regionId", "==", regionId)` (home, pour, wineries list, trips hub/create/detail, explore). Composite indexes in `firestore.indexes.json`.
- **Concierge requests carry `regionId`** — the Cloud Function loads the region's config per cold start and region-filters retrieval.

**Status (see `docs/multi-region-refactor-plan.md`):** Phases 1–3 are shipped (backfill, server dual-mode, client), and `regionId` is now **required** server-side (Phase 4 step 1 — requests without it get a 400). **Rest of Phase 4–5 remains**: purge legacy client AI deps/env vars, add a second region, hardening. `docs/adding-a-new-region.md` is the playbook for onboarding a region.

---

## Project Structure

```
/
├── app/
│   ├── _layout.tsx                 # Root: fonts, RootErrorBoundary > Network > Region > Auth > Saved > Trip > RegionGate > Stack
│   ├── index.tsx                   # Splash — redirects to /home (signed in) or /auth
│   ├── auth.tsx                    # Sign in / Create account
│   ├── region-picker.tsx           # Region picker (gate target + /region-picker route)
│   ├── trip-active.tsx             # Full-screen modal: active-trip experience
│   └── (tabs)/
│       ├── _layout.tsx             # Custom floating animated tab bar (4 visible tabs; explore hidden)
│       ├── home/
│       │   ├── index.tsx           # Hero, concierge search, featured winery, "The Pour", article rail
│       │   ├── pour.tsx            # "The Pour" editorial reader (region-filtered pour_articles)
│       │   └── articles/           # 5 static editorial pages (sommelier-recommendations, hidden-gems,
│       │                           #   vintage-reports, behind-the-cellar-door, pairings)
│       │                           #   NOTE: collections/[key].tsx was REMOVED
│       ├── trips/                  # index (hub) / create / [id] (premade|user detail)
│       ├── wineries/               # index (list/map) / [slug] (detail w/ About·Wines·Events·Tasting Notes tabs)
│       ├── profile/
│       │   ├── index.tsx           # Saved / Tastings / Palate + privacy-policy link
│       │   └── delete-account.tsx  # Account deletion (Apple 5.1.1(v)) → deleteAccount Cloud Function
│       └── explore/                # Hidden route (href: null) — kept for inbound links
├── components/
│   ├── ConciergeChat.tsx           # Sommelier chat UI — streams SSE, sends regionId + sessionId/userId
│   ├── LogoPinMarker.tsx           # Branded map pin (manages tracksViewChanges so pins reliably paint)
│   ├── SectionHeader.tsx           # Shared editorial section header
│   ├── EmptyState.tsx / ErrorScreen.tsx / SkeletonBox.tsx
│   ├── RegionGate.tsx / RootErrorBoundary.tsx / ScreenErrorBoundary.tsx
│   └── articles/                   # ArticleRenderer + ArticleFetcher + Magazine/Editorial/List/Interview layouts
├── constants/                      # theme.ts (design tokens — single source of truth), mapStyle.ts
│                                   # NOTE: constants/region.ts NO LONGER EXISTS
├── context/                        # RegionContext, AuthContext, SavedContext (Firestore-synced),
│                                   #   TripContext (AsyncStorage), NetworkContext (netinfo)
├── functions/                      # Cloud Functions (TypeScript, Node 22) — see Concierge section
│   └── src/
│       ├── index.ts                # ping, testEmbed, concierge (SSE), re-exports deleteAccount
│       ├── deleteAccount.ts        # Wipes Auth user + users/{uid} tree
│       └── concierge/              # v1 orchestrator + retrieval, rateLimit, rerank, resolveCoreference,
│           └── v2/                 #   regionConfig, geminiResponse, …; v2/ = rewrite behind CONCIERGE_USE_V2
├── lib/deleteAccount.ts            # Client wrapper: re-auth + callable invocation
├── services/concierge/             # THIN CLIENT ONLY: concierge.ts (SSE client), buildContext.ts
│                                   #   (corpus load for inline winery cards), costTracker.ts, types.ts
├── types/                          # trip.ts, region.ts
├── utils/                          # routePlanner, fetchRoutePolyline, openExternalDirections,
│                                   #   errorReporting (Crashlytics-ready reportError), sessionId
├── scripts/                        # Node admin / data-pipeline scripts (see below) + rag/ + concierge/
├── docs/                           # multi-region-refactor-plan, adding-a-new-region, concierge-audit,
│                                   #   concierge-rewrite-spec, ACCOUNT_DELETION, setup-crashlytics
├── public/                         # privacy.html (hosted privacy policy), index.html
├── firebaseConfig.js               # app, auth (AsyncStorage persistence), db (memory cache), storage, functions
├── firestore.rules / firestore.indexes.json / firebase.json / .firebaserc
├── service-account-tasmania.json   # Admin SDK creds for scripts (gitignored — DO NOT COMMIT)
├── app.json / app.config.js        # app.config.js injects EXPO_PUBLIC_GOOGLE_MAPS_API_KEY into native config
├── .env / .env.tasmania            # EXPO_PUBLIC_* vars (gitignored; see SECURITY note above)
└── TASMANIA_SETUP.md / TASMANIA_WORKFLOW.md / README.md
```

---

## Screens — What's Built

### Splash / Auth (`app/index.tsx`, `app/auth.tsx`)
- 2s minimum splash, waits for Firebase auth; redirects `/home` or `/auth`.
- Email/password sign-in & sign-up; `AuthContext` auto-creates `users/{uid}` on first sign-in.

### Region Picker (`app/region-picker.tsx`)
- Shown by `RegionGate` on first launch when 2+ regions exist (auto-picks when only one). Also reachable later to switch regions; `setRegion()` persists to AsyncStorage and reloads region config.

### Home (`app/(tabs)/home/index.tsx`)
- Dark parallax hero (image URL + crop from `config/homepage` — still global, not per-region).
- Search bar opens `ConciergeChat`; suggested prompt chips come from `regionConfig.suggestedPrompts`.
- Featured winery (`featured == true && featuredTier == 'hero'`), latest `pour_articles` issue, `explore_articles` rail — all region-filtered.

### Wineries List (`app/(tabs)/wineries/index.tsx`)
- Region-filtered `wineries` query; search, boolean filter chips, sort (featured / nearMe / az).
- List ↔ Map toggle; map camera starts at `regionConfig.mapBounds`; clustering + custom dark `MAP_STYLE`.
- Save toggle via `useSaved()`.

### Winery Detail (`app/(tabs)/wineries/[slug].tsx`)
- Routed by `slug` (= Firestore doc id). Parallax hero carousel, hours (legacy string + `hoursStructured`), contact, directions hand-off, feature badges, editorial About with lede + `pullQuote`.
- **Four content tabs: About / Wines / Events / Tasting Notes.**
  - **Wines** — public `wines` collection (`where wineryId == slug`): vintage, variety, tasting notes, pairings, awards, bottle image.
  - **Events** — public `events` collection (`where winerySlug == slug`); past/upcoming aware. (Events are back in-app via this tab — there is still no standalone Events tab screen.)
  - **Tasting Notes** — community notes from public `winery_tastings`; signed-in users can submit (wine, 0–5 score, note) — also mirrored into their private `users/{uid}/tastings`.

### Trips (`trips/index.tsx`, `create.tsx`, `[id].tsx`, `trip-active.tsx`)
- Hub: region-filtered `premade_trips` (half-day rail + full-day stack) + "My Trips" from `TripContext` (AsyncStorage) + build-your-own CTA.
- Create: pick 2–8 wineries (region-filtered, coords required), reorder, save locally.
- Detail (`?kind=premade|user`): map preview with `LogoPinMarker` pins + route polyline; route optimisation runs only at start-time. **iOS polyline color workaround**: pass `strokeColors` alongside `strokeColor` (Google Maps SDK style-span bug, react-native-maps #5253) — same workaround in `trip-active.tsx`.
- Active trip: full-screen modal, live progress, foreground location watch for distance-to-next-stop, mark-visited, native directions hand-off.

### Profile (`profile/index.tsx`, `profile/delete-account.tsx`)
- Live `users/{uid}` profile + Saved / Tastings / Palate tabs from subcollections (`onSnapshot`); inline edit modals; privacy-policy link.
- **Delete account**: dedicated screen (Apple guideline 5.1.1(v)) → password re-auth → `deleteAccount` Cloud Function wipes Auth user + Firestore tree. See `docs/ACCOUNT_DELETION.md`.

### Explore (`explore/index.tsx`)
- Hidden from tab bar (`href: null`); region-filtered editorial directory. Kept for inbound links.

---

## Firebase / Backend

**Client config:** `firebaseConfig.js` exports `auth` (AsyncStorage persistence), `db` (Firestore, `experimentalForceLongPolling: true`, **memory-only cache** — JS SDK persistent cache needs IndexedDB which RN lacks; true offline would require `@react-native-firebase/firestore`), `storage`, and `functions` (us-central1, used by the callable `deleteAccount`).

**Firestore collections:**

| Collection | Purpose / Notes |
|---|---|
| `regions/{regionId}` | Per-region config (see Multi-Region section). Public read; Admin-SDK-only writes (`scripts/seed-region-tasmania.js`). |
| `wineries` | Core winery docs: `name`, `slug`, `regionId`, `region` (sub-region display string), `description[]`, `pullQuote`, `phone`, `website`, `hours`/`hoursStructured`, `images[]`, `rating`, `userRatingsTotal`, lat/lon, `googlePlaceId`, boolean feature flags, `featured`/`featuredTier`/`featuredLabel`, `boost`. |
| `wines` | Per-winery wine list (`wineryId` FK). Read by the Wines tab; also the source for the concierge's wine index. |
| `events` | Winery events (`winerySlug` FK). Read by winery detail's Events tab. |
| `winery_tastings` | **Community tasting notes.** Public read; signed-in create with field validation (authorId == uid, wine ≤120 chars, score 0–5, note ≤1000); update/delete owner-only. |
| `premade_trips` | Curated trips — `regionId`, `title`, `blurb`, `heroImage`, `durationHours`, `wineryIds[]`, `order`. |
| `pour_articles` | "The Pour" editorial issues — `regionId`, `issueNumber`, typed `blocks[]`, sponsor, continue rail. |
| `explore_articles` | Article rail entries — `regionId`. |
| `knowledge_chunks` | RAG chunks (mirror of Upstash content). Written by `scripts/rag/ingest.js`. |
| `concierge_rate_limits` | Per-session daily quota counters, written by the Cloud Function via Admin SDK. **No client access.** TTL on `expiresAt`. |
| `config/{doc}` | Global config — `config/homepage` holds hero image URL + crop. |
| `homepage_carousel` | Legacy — still in rules/seed script, but **no screen reads it**. |
| `users/{uid}` | Profile + subcollections `savedWineries`, `savedArticles`, `lists`, `tastings`. Owner-only. |

**Security rules (`firestore.rules`):** public read on content collections, Admin-SDK-only writes — except `winery_tastings` (authed create/update/delete as above) and `users/{uid}` (owner-only incl. all subcollections). `concierge_rate_limits` denies all client access. Everything else denied. *Known gap: `winery_tastings` `update` only checks authorship — it does not re-validate the field constraints enforced on `create`.*

**SavedContext is Firestore-backed now:** hearts write to `users/{uid}/savedWineries/{id}` with optimistic local toggle + rollback, and an `onSnapshot` listener reconciles every screen (this is why hearts on the list immediately appear on the profile). Not AsyncStorage.

---

## Concierge (AI sommelier) — SERVER-SIDE

The concierge pipeline moved out of the app. **No AI API keys ship in the JS bundle.**

**Server (`functions/src/`):**
- `concierge` — public HTTPS Gen2 function, POST `{ message, history (≤40), userLocation?, regionId, sessionId?, userId? }` → **SSE stream** (`delta` / `done` / `error` events). `regionId` is **required** (400 if missing — no Tasmania fallback).
- Orchestrator flow: **resolve coreference → route (structured filters) → retrieve → respond**, streaming tokens back. Two implementations: v1 (live) and `v2/` rewrite, selected by `CONCIERGE_USE_V2` env (default off). Both expose the same `AskResult` shape (reply, proposal, wineryCards, history, cost).
- Retrieval: `retrieve.ts` (winery descriptions), `knowledgeRetrieve.ts` (`knowledge` Upstash namespace), `tastingNotes.ts` (`wines` namespace), `winerySourcesRetrieve.ts` (`winery_sources` namespace, scraped winery-website chunks) — all Voyage-embedded queries against Upstash Vector, with `rerank.ts` reranking. `driveTimes.ts` uses Google Distance Matrix for itinerary ordering. `regionConfig.ts` loads + caches `regions/{regionId}` per cold start; the system prompt is templated from it (`brandVoiceLine`, `regionalPrimer`, sub-regions, timezone-correct "today").
- Response LLM: Gemini by default (`LLM_PROVIDER`, `geminiResponse.ts`); router/resolver stay on OpenAI. Rollback to OpenAI = one env var.
- **Abuse protection (3 layers, `index.ts` + `rateLimit.ts`):** in-memory per-IP burst limit (30/min) → Firestore-backed per-session daily quota (`concierge_rate_limits`) → App Check verification (env-gated via `CONCIERGE_ENFORCE_APP_CHECK`, currently off).
- **Observability:** Langfuse tracing (optional secrets — function works without them), grouped by `sessionId`/`userId`. Secrets bound: OPENAI, GEMINI, VOYAGE, UPSTASH URL/TOKEN, GOOGLE_DIRECTIONS, LANGFUSE keys.
- `deleteAccount` (callable), `ping`, `testEmbed` (Voyage smoke test).
- Deploy: `cd functions && npm run deploy` (build = `tsc`, Node 22).

**Client (`services/concierge/`):** `concierge.ts` is a thin SSE client (via `expo/fetch`) hitting `EXPO_PUBLIC_CONCIERGE_URL` (falls back to the deployed cloudfunctions.net URL), keeping the same public API (`init`, `askStream`, `getHistory`, `reset`, …) so `ConciergeChat.tsx` was unchanged. Multi-turn history is sent each turn. `buildContext.ts` still loads the winery corpus client-side — only for `getWinery(slug)` inline-card rendering. The old client-side RAG modules (router/retrieve/knowledgeRetrieve/tastingNotes/systemPrompt/driveTimes) have been **deleted from disk**, and the legacy `openai` / `voyageai` / `@upstash/vector` deps now live in **devDependencies** (used only by `scripts/`) — nothing AI-related ships in app `dependencies`, and no `EXPO_PUBLIC_*` AI keys exist in the env files.

Knowledge-base content lives in `scripts/rag/content/*.md` (+ `tasting-notes/`); `scripts/winery-sources/*.md` holds scraped per-winery source docs. Docs: `docs/concierge-audit.md`, `docs/concierge-rewrite-spec.md`.

---

## Design & UI Conventions

Theme: **"Forest Slate"** — dark editorial UI. **All colors, fonts, spacing, radii live in `constants/theme.ts`** — never inline hex values or font names.

**Tokens (from `constants/theme.ts`):**
- **Surfaces:** `background` `#0F1411` / `surface` `#1A201B` / `surfaceDeep` `#070A08` / `surfaceElevated` `#222823`
- **Text:** `textPrimary` `#E8EAE6` / `textSecondary` (ink @ 72%) / `textMuted` (ink @ 50%) / `textOnDark` `#F5F0E6`
- **Accents:** `accent` `#548323` (forest — CTAs, active tab pill) / `accentSoft` `#9dd560` (lime — kickers, ratings) / `onAccent` `#F5F0E6`
- **Borders:** `border` / `borderStrong` (10% / 20% alpha hairlines); **photo chrome:** `photoChrome` + `photoOverlay*` gradient stops; **status:** `error` `#E5705F`

**Typography:** `fonts.serif` (Playfair 700) headlines; `serifSemiBold(/Italic)` subheads + ledes; `serifItalic`; `sans/sansMedium/sansBold` (DM Sans) body/UI; `display` (Bebas Neue) brand; `roboto/robotoMedium` concierge replies. DM Sans is the **default** `<Text>`/`<TextInput>` font via `defaultProps` in `app/_layout.tsx`.

**Type scale (`type.*`):** kicker 10 / caption 12 / body 14 / lede 17 / h3 22 / h2 28 / h1 36 / display 54 — each bundles family/size/line-height/tracking.
**Spacing (`spacing.*`):** xs 4 → hero 40; `hitTarget` 44. **Radii (`radius.*`):** sharp 0 / card 4 / cardLg 12 / pill 999.

**Layout patterns:** `StyleSheet` at the **bottom** of each file; 24px screen horizontal padding (`spacing.xxl`); low-radius cards; pill chips with accent fill when active.

**Tab bar:** custom `CustomTabBar` in `app/(tabs)/_layout.tsx` — floating pill, animated forest indicator (Reanimated springs), memoized `TabButton`. Visible: Home / Trips / Wineries / Profile. Hidden: `explore` (`href: null`).

**Error handling:** `RootErrorBoundary` wraps the whole tree; `withScreenErrorBoundary` wraps individual screens; failures route through `utils/errorReporting.ts` `reportError()` (console-only today, Crashlytics-ready — see `docs/setup-crashlytics.md`).

---

## Data Pipeline Scripts (`/scripts/`)

Run with `node scripts/<name>.js` against `winery-tourism-tasmania` using `service-account-tasmania.json`. Highlights (the directory has ~60 scripts; names are self-describing):

**Multi-region** — `backfill-region-id.js` (stamp `regionId: "tasmania"` on all content docs), `seed-region-tasmania.js` (seed `regions/tasmania`), `rag/backfill-region-upstash.js` (add `regionId` metadata to existing vectors).

**Ingestion / geocoding / enrichment** — `upload-tasmania-wineries.js`, `add-missing-wineries-tasmania.js`, `geocode-*.js`, `fetch-place-details*.js`, `merge-ratings*.js`, `add-hours-structured*.js`, `add-featured-fields.js`, `add-award-*.js`, `add-winery-filters.js`, `add-boost-field.js`, `extract_place_ids.js`, `test-places-api.js`.

**Cleanup / audits** — `cleanup-duplicate-wineries-tasmania.js`, `cleanup-placeid-docs-tasmania.js`, `fix-slugs.js`, `check-slugs.js` / `check-place-ids.js` / `check-coords.js` / `check-explore-articles.js`, `audit-winery-fields.js`, `list-winery-ids.js`.

**Sheets sync** — `export-wineries-csv-tasmania.js`, `export-to-sheets-tasmania.js`, `import-from-sheets-tasmania.js`, `push-winery-ids-to-template.js`, `seed-wines-from-csv.js` (seed the `wines` collection from the spreadsheet template).

**Content / editorial** — `seed-explore-articles.js`, `seed-pour.js`, `seed-carousel.js`, `seed-premade-trips(-smart).js`, `generate-descriptions-tasmania.js` (Claude-drafted descriptions → human review in `scripts/review/tasmania/`), `upload-hero-image*.js`, `set-hero-position.js`, `upload-premade-trip-thumbnails-tasmania.js`, `strip-citations.js`.

**Winery sources (concierge grounding)** — `collect-winery-sources.js` / `probe-winery-sources.js` / `audit-winery-sources.js` (scrape + vet winery websites into `scripts/winery-sources/*.md`), `ingest-winery-sources.js` (embed into the `winery_sources` Upstash namespace).

**RAG** — `rag/ingest.js` (knowledge markdown → Upstash `knowledge` namespace + Firestore `knowledge_chunks`; Voyage `voyage-3-lite`, 512-dim), `rag/ingest-tasting-notes.js` (`wines` namespace), `rag/query.js`, `rag/retrieve.js`, `rag/lib/*`, `embed-wineries.js`, `inspect-embeddings.js`, `test-retrieval.js`.

**Concierge testing (`scripts/concierge/`)** — `test-queries.js` / `test-queries-live.js` / `test-gemini-live.js`, `ab-test-providers.js` (+ `ab-test-report.md`), `eval-v2.js` (v2 orchestrator eval), `sommelier-prompt.js`.

**Cost** — `measure-token-usage.js`, `verify-token-savings.js`. **Housekeeping** — `updateEventsSchema.mjs`.

> **Do not reintroduce** the deprecated WA Firestore project (`solid-garden-474012-q4`) or its credentials.

---

## Known Issues & Tech Debt

### 🟠 Medium Priority
- **`winery_tastings` rules gap** — `update` doesn't re-validate the field constraints that `create` enforces (an author could update their note past the size/score limits).
- No `useFirestoreCollection` shared hook — fetch logic is copy-pasted across screens.
- Firestore cache is memory-only (lost on cold restart); true offline needs `@react-native-firebase/firestore`.
- The hidden `explore` tab still ships its full screen.

### 🟡 Lower Priority / Future
- **No test framework** (no Jest / Testing Library) — the concierge eval scripts are the closest thing.
- `reportError()` is console-only — Crashlytics not yet wired (`docs/setup-crashlytics.md` has the steps).
- No push notifications.
- **Store submission in progress** — `eas.json` + encryption flag exist; remaining steps (Apple Developer enrollment, EAS env vars, screenshots, listing) in `docs/app-store-submission.md`.
- No server-side search or pagination (client-side only; fine at current volume).
- Lightly-used `expo-*` packages (`expo-haptics`, `expo-constants`, `expo-symbols`, `expo-system-ui`) — review and prune.

---

## Roadmap / Planned Features

- [x] **Multi-region Phase 4 step 1**: `regionId` required server-side (deploy pending).
- [x] **Multi-region Phase 4 step 2**: legacy AI deps (`openai`, `voyageai`, `@upstash/vector`) and script-only deps (`firebase-admin`, `googleapis`, `node-fetch`) moved to devDependencies — scripts keep working, nothing AI-related in app `dependencies`. Stale `EXPO_PUBLIC_REGION_NAME` removed from env files.
- [ ] **Multi-region Phase 4 (rest)**: add the second region (picker shows 2+ cards).
- [ ] **Multi-region Phase 5**: hardening — region-tuned prompts, per-region Upstash namespaces if metadata filters get slow.
- [ ] Concierge v2 cutover (`CONCIERGE_USE_V2=true`) after soak testing — see `docs/concierge-rewrite-spec.md`.
- [ ] Wire Crashlytics into `reportError()`.
- [ ] App Check enforcement on the concierge endpoint (`CONCIERGE_ENFORCE_APP_CHECK`).
- [ ] Push notifications for trip reminders + new "Pour" issues.
- [ ] App Store submission — config + listing copy done (`eas.json`, `docs/app-store-submission.md`); owner actions remain (enrollment, builds, screenshots, review).
- [ ] Decide fate of `homepage_carousel` (unused) and a standalone Events surface (events currently live only on the winery detail tab).

---

## Development Notes

- **Run:** `npx expo start` (`app.config.js` injects the Google Maps key from `.env` into native config)
- **iOS / Android:** `npx expo run:ios` / `npx expo run:android` — **Lint:** `npm run lint`
- **Functions:** `cd functions && npm run build` (tsc) / `npm run serve` (emulator) / `npm run deploy`
- TypeScript strict mode is **ON** — explicit types, no `any`. Functional components + hooks.
- `StyleSheet` definitions at the **bottom** of each file.
- Pull all colors/fonts/spacing/radii from `constants/theme.ts` — add a token if you need one.
- **Shared state:** React Context only. Add a new Context before reaching for Redux/Zustand.
- Firebase config reads from `.env` via `EXPO_PUBLIC_` vars; server secrets live in Firebase Secrets Manager (`firebase functions:secrets:set …`) — **never hardcode secrets, never commit `.env*` or `service-account*.json`** (and remember the `.env.tasmania` history exposure above).

## Working with This Codebase

When making changes:
1. Keep TypeScript strict — define interfaces for Firestore data shapes (see `types/trip.ts`, `types/region.ts`).
2. Follow Expo Router's file-based routing.
3. Match the dark editorial aesthetic: forest-slate surfaces, Playfair titles, DM Sans body, lime/forest accents, low-radius cards.
4. **Region-aware by default:** any new content query must filter `where("regionId", "==", useActiveRegionId())`; any region-specific copy/config comes from `useRegionConfig()` — never hardcode "Tasmania". New per-region settings go on the `regions/{regionId}` doc + `types/region.ts` (bump `schemaVersion`).
5. New screens get `withScreenErrorBoundary` and report failures via `reportError()`.
6. Anything touching the concierge pipeline belongs in `functions/src/concierge/` (server), not the client; keep `types/region.ts` the shared contract.
7. Test on both iOS and Android where possible (maps provider, `expo-location`, and the iOS polyline `strokeColors` workaround in particular).
8. Reject any code or config referencing the deprecated WA project (`solid-garden-474012-q4`).
