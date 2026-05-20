# Setting up Firebase Crashlytics

Crashlytics is the App Store-ready crash reporting layer. The Phase 4 error infrastructure (error boundaries, network awareness, region failure modes, concierge resilience) all funnel through `utils/errorReporting.ts`, which today logs to console. This doc walks through swapping that log for real Crashlytics reporting.

You'll do this once, then every existing `reportError()` call site lights up automatically — no code changes needed beyond the file you'll edit in step 5.

---

## Prerequisites

Crashlytics requires the **native** Firebase SDKs (`@react-native-firebase/app` + `@react-native-firebase/crashlytics`). That means leaving Expo Go for development. You'll switch to **EAS Dev Builds** — same fast iteration cycle as Expo Go, but with native modules compiled in.

If you've never used EAS:

```sh
npm install -g eas-cli
eas login
eas init  # creates eas.json + an EAS project for this repo
```

You'll need an Expo account (free) and an Apple Developer account ($99/year) to build for iOS. Android dev builds work without a paid account.

---

## Step 1 — Install the Firebase native packages

From the repo root:

```sh
npx expo install @react-native-firebase/app @react-native-firebase/crashlytics
```

Two packages. The first is the Firebase native runtime; the second is the Crashlytics binding on top.

---

## Step 2 — Add the config plugins to `app.config.js`

Open `app.config.js`. Find the existing config (you have one that injects `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`). Add the Firebase plugins next to it:

```js
// app.config.js
module.exports = {
  // …existing config…
  plugins: [
    // …existing plugins…
    "@react-native-firebase/app",
    "@react-native-firebase/crashlytics",
    [
      "expo-build-properties",
      {
        ios: { useFrameworks: "static" },
      },
    ],
  ],
};
```

The `expo-build-properties` plugin and `useFrameworks: "static"` are required for `@react-native-firebase/app` to work with iOS — without them, you'll get a build error about CocoaPods incompatibility. Install it if you don't already have it:

```sh
npx expo install expo-build-properties
```

---

## Step 3 — Drop the `GoogleService-Info.plist` into the repo

Crashlytics needs the iOS Firebase config file (`GoogleService-Info.plist`). You can download it from the Firebase Console:

1. Go to https://console.firebase.google.com/project/winery-tourism-tasmania/settings/general
2. Scroll to "Your apps" → iOS app section.
3. If you don't have an iOS app registered yet, click "Add app" → iOS, and use bundle id `com.siplocalguide.app`.
4. Download `GoogleService-Info.plist` and save it to the repo root: `~/Desktop/SipLocal/GoogleService-Info.plist`.

For Android, do the same with `google-services.json` (also at repo root).

**Add these to `.gitignore`** — they contain project identifiers and shouldn't be in version control:

```
# Firebase native config (downloaded from Firebase Console)
GoogleService-Info.plist
google-services.json
```

Reference them in `app.config.js` so EAS Build copies them into the native projects:

```js
module.exports = {
  // …
  ios: {
    // …existing iOS config…
    googleServicesFile: "./GoogleService-Info.plist",
  },
  android: {
    // …existing Android config…
    googleServicesFile: "./google-services.json",
  },
  // …
};
```

---

## Step 4 — Build an EAS Dev Build

The first time you add native modules to an Expo project, you need to do a clean rebuild. You can't use Expo Go anymore — it doesn't have the Firebase native modules baked in.

```sh
# iOS dev build (runs on simulator or device)
eas build --profile development --platform ios

# Android dev build
eas build --profile development --platform android
```

This takes 10–20 minutes the first time (Cloud Build compiles the native shell). EAS will give you a QR code or `tar.gz` download link when it's done. Install the resulting `.app` on your simulator or device and use it instead of Expo Go for development.

Subsequent `npx expo start` invocations should still work — the JS bundle reloads through Metro into the dev build the same way it does in Expo Go.

---

## Step 5 — Flip the switch in `utils/errorReporting.ts`

Now wire the live Crashlytics calls. Open `utils/errorReporting.ts`. The file has a clearly-marked placeholder section in `reportError()`:

```ts
// ── Crashlytics hook (placeholder — wire up when ready) ────────────
// import crashlytics from "@react-native-firebase/crashlytics";
// for (const [k, v] of Object.entries(context)) {
//   if (v !== undefined) crashlytics().setAttribute(k, String(v));
// }
// crashlytics().recordError(error, severity === "fatal" ? "fatal" : undefined);
```

Uncomment those lines and move the import to the top of the file:

```ts
// At the top of utils/errorReporting.ts, alongside the existing imports:
import crashlytics from "@react-native-firebase/crashlytics";
```

That's the only line change in the entire app. Every existing `reportError()` call site now sends to Crashlytics.

---

## Step 6 — Verify crashes show up

Crashlytics doesn't surface dev events in real time — they get batched and sent on the *next* app launch (this is a Firebase design choice, not something we can change). To verify:

1. From the dev build, trigger a deliberate error. Easiest way: add a temporary button somewhere that does:
   ```ts
   <Pressable onPress={() => reportError(new Error("Test from dev build"), { source: "smoke_test" })}>
     <Text>Trigger Crashlytics test</Text>
   </Pressable>
   ```
2. Tap it. Force-quit the app. Reopen.
3. Check the Crashlytics dashboard at https://console.firebase.google.com/project/winery-tourism-tasmania/crashlytics — your test error should appear within a few minutes.
4. Confirm the `context` keys you passed (`source`, `region_id`, etc.) show up as custom keys on the event.

For production crashes: real crashes ship from real users' devices on next launch, no manual flow needed.

---

## Step 7 — Test a real uncaught error

The `RootErrorBoundary` and `ScreenErrorBoundary` both call `reportError(..., "fatal")` and `reportError(..., "error")` respectively. To verify they reach Crashlytics:

1. Pick a screen — say `app/(tabs)/wineries/index.tsx`. Add a deliberate render-time throw:
   ```ts
   if (Math.random() > 0) throw new Error("Smoke test for ScreenErrorBoundary");
   ```
2. Open the app, navigate to the Wineries tab. You should see the `ScreenErrorBoundary`'s ErrorScreen with the retry button.
3. Force-quit and reopen the app. Check Crashlytics — the error should be there with `source: "ScreenErrorBoundary:wineries/index"` as a custom key.
4. Remove the deliberate throw before committing.

---

## Tying off — turning Crashlytics OFF in development

Crashlytics by default sends events from any build it's installed in, including dev builds. If you want only production crashes hitting the dashboard:

```ts
// In utils/errorReporting.ts, gate the call:
if (!__DEV__) {
  crashlytics().recordError(error, severity === "fatal" ? "fatal" : undefined);
}
```

I'd recommend leaving dev events flowing initially — you'll spot bugs faster — and adding the gate only once the dashboard fills with noise.

---

## When to do this work

Crashlytics is App Store-recommended but not required. Apple doesn't reject an app for *lacking* Crashlytics. So a reasonable sequence:

1. **Submit to App Store** with the current `reportError()` setup logging to console. You'll catch crash reports through Apple's TestFlight + App Store Connect → "Crashes" tab, which works automatically with zero code changes. Limited but free.
2. **Add Crashlytics post-launch**, after you've validated the submission process and have real users to learn from. The work in this doc takes a single afternoon once you decide to do it.

The Phase 4 error infrastructure is fully usable today without Crashlytics — every error has a user-facing recovery path, every uncaught exception is caught, and every retry works. Crashlytics is the *visibility* layer; it makes you faster at fixing bugs but doesn't gate shipping.
