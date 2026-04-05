# WineryTourism — Project Context for Claude

## What This App Is

A mobile tourism app for discovering wineries, events, and special offers. Built for iOS and Android (with web support). The app lets users browse wineries, view details (description, photos, contact info, website), and see upcoming events. A "Specials" tab is planned but not yet implemented.

**Owner:** Benjamin (benbeckers15@gmail.com)
**Goal:** Build and launch this app end-to-end using Claude (Cowork + Claude Code)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo (v54) with React Native (v0.81) |
| Language | TypeScript (v5.9, strict mode) |
| Router | Expo Router v6 — file-based routing |
| Database | Firebase Firestore (v12) |
| Storage | Firebase Cloud Storage |
| Animations | React Native Reanimated v4 + Reanimated Carousel |
| Navigation | Bottom tabs (custom floating animated tab bar) |
| State | React hooks only (useState, useEffect, useCallback) — no Redux/Zustand |
| Styling | React Native StyleSheet — no Tailwind or CSS-in-CSS |
| Utilities | Expo Linear Gradient, Expo Linking, Expo Web Browser |

---

## Project Structure

```
/
├── app/
│   ├── _layout.tsx              # Root layout (NOTE: contains debug Firestore test — needs removal)
│   ├── index.tsx                # Splash / loading screen
│   └── (tabs)/
│       ├── _layout.tsx          # Custom floating animated tab bar
│       ├── home/
│       │   ├── _layout.tsx
│       │   └── index.tsx        # Homepage — carousel + feature cards
│       ├── wineries/
│       │   ├── _layout.tsx
│       │   ├── index.tsx        # Winery list with client-side search
│       │   └── [slug].tsx       # Winery detail page (photos, info, links)
│       ├── events/
│       │   ├── _layout.tsx
│       │   └── index.tsx        # Events list
│       └── specials/
│           ├── _layout.tsx
│           └── index.tsx        # PLACEHOLDER — not implemented yet
├── assets/                      # Images and icons
├── firebaseConfig.js            # Firebase init and export
├── package.json
├── tsconfig.json
├── babel.config.js
├── eslint.config.js
└── app.json                     # Expo config (package name: winerytourism, version: 1.0.0)
```

---

## Firebase / Backend

- **Project ID:** solid-garden-474012-q4
- **Firestore Collections:**
  - `wineries` — winery documents with fields: name, slug, description, phone, website, images (array), location, etc.
  - `events` — event documents
  - `testCollection` — debug artifact, should be deleted
- **Auth:** Not yet implemented — all Firestore reads are currently unauthenticated
- **Config file:** `firebaseConfig.js` — exports `db` (Firestore instance) and `storage`
- **Setting:** `experimentalForceLongPolling: true` is set for compatibility

---

## Design & UI Conventions

- **Primary color:** `#723FEB` (purple)
- **Accent/dark:** `#4B0E15` (dark wine red)
- **Background:** Dark theme throughout
- **Tab bar:** Custom floating animated bar with Reanimated spring animations
- **Cards:** Shadows + elevation, consistent padding
- **Images:** Gradient overlays on top of images for text legibility
- **Loading states:** ActivityIndicator spinners
- **Empty states:** Handled in all list screens

---

## Known Issues & Tech Debt (as of March 2026)

### 🚨 Critical
- **Firebase API key is hardcoded in `firebaseConfig.js`** — must be moved to `.env` before any public release or GitHub push. Key needs to be rotated in Firebase Console.

### 🔴 High Priority Bugs
- **Dead navigation links on home screen:** `/somms-picks` and `/private-dinners` routes don't exist — tapping will crash the app
- **Specials tab is empty** — shows placeholder only, should be hidden from nav until built
- **Firestore test code** in `app/_layout.tsx` runs on every app launch — writes/reads `testCollection` — remove this

### 🟠 Medium Priority
- `useState<any[]>` used for events list — needs a proper `Event` TypeScript interface
- Firestore fetch logic is copy-pasted across 3 screens — should be a shared `useFirestoreCollection` hook
- No URL validation before `Linking.openURL()` on phone/website fields in winery detail
- Animated tab bar creates Reanimated hooks inside a `.map()` loop — should extract to memoized component
- No data caching — every screen fetches fresh from Firestore on every mount
- FlatList missing `removeClippedSubviews` and batching props

### 🟡 Lower Priority / Future
- No test framework set up (no Jest, no Testing Library)
- No error boundaries
- No image caching (consider `react-native-fast-image`)
- No server-side search or pagination (currently all client-side)
- No offline support
- Unused packages: `expo-haptics`, `expo-constants`, `expo-status-bar`, `expo-system-ui`, `expo-symbols`

---

## Roadmap / Planned Features

- [ ] Fix all critical and high-priority issues above
- [ ] Implement Specials screen
- [ ] Build out `/somms-picks` and `/private-dinners` screens
- [ ] Add user authentication (Firebase Auth)
- [ ] Add Firestore security rules
- [ ] Implement map/location features
- [ ] Push notifications for events
- [ ] Submit to App Store and Google Play

---

## Development Notes

- Run with: `npx expo start`
- iOS simulator: `npx expo run:ios`
- Android: `npx expo run:android`
- TypeScript strict mode is ON — keep all types explicit, avoid `any`
- Prefer functional components with hooks
- StyleSheet definitions go at the bottom of each file (existing convention)
- No global state management yet — if adding shared state, prefer React Context before reaching for Redux/Zustand

---

## Working with This Codebase

When making changes:
1. Keep TypeScript strict — define interfaces for all Firestore data shapes
2. Follow the existing file-based routing structure (Expo Router)
3. Match the existing color scheme and dark theme
4. Test on both iOS and Android when possible
5. Don't commit `.env` files or secrets
