# SipLocal — App Store Submission Guide (iOS)

> Created 2026-06-11. Target: first iOS release, v1.0.0.
> Companion config: `eas.json` (build profiles), `app.json` (bundle id `com.siplocalguide.app`, encryption flag).

---

## Phase 0 — Accounts (you, ~1–2 days lead time)

1. **Enroll in the Apple Developer Program** at https://developer.apple.com/programs/enroll/ — USD $99/yr. Enroll as an *individual* unless you have an ABN/company you want on the store listing ("Seller" name shows publicly). Identity verification can take 24–48h.
2. Once enrolled, sign in to **App Store Connect** (https://appstoreconnect.apple.com) with the same Apple ID.
3. Create an **Expo account** at https://expo.dev (free tier is fine for this).

## Phase 1 — EAS project setup (one-time, ~15 min)

```bash
npm install -g eas-cli
eas login
eas init                  # links the repo to an EAS project (writes extra.eas.projectId)
```

Then push the build-time env vars (EAS cloud builds don't read your local `.env`):

```bash
eas env:create --environment production --name EXPO_PUBLIC_FIREBASE_API_KEY --value "..."
# repeat for: EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN, EXPO_PUBLIC_FIREBASE_PROJECT_ID,
#   EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET, EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
#   EXPO_PUBLIC_FIREBASE_APP_ID, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
# (EXPO_PUBLIC_CONCIERGE_URL is optional — the client falls back to the deployed URL)
```

> Build numbers: `eas.json` sets `appVersionSource: "remote"` + `autoIncrement`, so EAS
> manages `buildNumber` automatically — never hand-edit it in `app.json`.

## Phase 2 — Pre-flight decisions

- [ ] **iPad: keep or drop.** `app.json` has `"supportsTablet": true`, which makes iPad
      screenshots **mandatory** and means reviewers test on iPad. The layout was designed
      phone-first. Recommendation: set `supportsTablet: false` for v1.0 and add iPad
      support deliberately later. (One-line change; decide before the production build.)
- [ ] **Verify the privacy policy URL is live:** open
      https://winery-tourism-tasmania.web.app/privacy — if 404, run `firebase deploy --only hosting`.
      This URL goes in App Store Connect AND is already linked from the profile screen.
- [ ] **Create a reviewer demo account** (e.g. `applereview@siplocalguide.com` + password)
      in Firebase Auth and verify it can sign in and use every feature. Apple WILL sign in.
- [ ] **Forced-login risk (Guideline 5.1.1).** The app currently routes signed-out users to
      `/auth` — all content is behind account creation, but the content (winery directory,
      editorial) isn't inherently account-based. Apple sometimes rejects this. Options if
      flagged: add a "Continue as guest" path (browse-only, no saves/tastings), or argue
      the concierge/trips are account-based services. Budget for one rejection cycle here.
- [ ] **Account deletion** ✅ already implemented (profile → delete account → Cloud Function).
      Required by 5.1.1(v); reviewers check it works.

## Phase 3 — App Store Connect listing

Create the app record: App Store Connect → My Apps → "+" → New App → platform iOS,
bundle ID `com.siplocalguide.app`, SKU `siplocal-ios-001`.

### Listing copy (paste-ready)

**Name (30 chars max):** `SipLocal — Tasmania Wine`  *(24)*

**Subtitle (30 chars max):** `Cellar doors, trips & advice`  *(28)*

**Promotional text (170 chars max — editable without review):**
`Discover Tasmania's cellar doors, plan your wine trail, and ask the AI sommelier anything — from the best pinot near Hobart to a perfect Saturday in the Tamar Valley.` *(166)*

**Keywords (100 chars max, comma-separated):**
`wine,winery,tasmania,cellar door,vineyard,wine tasting,sommelier,pinot noir,trip planner,hobart` *(95)*

**Description (4000 chars max):**

```
Tasmania makes some of the most exciting cool-climate wine in the world — if you
know where to look. SipLocal is your local guide to all of it: every cellar door,
the stories behind them, and a planner that turns a list of wineries into a day
you'll actually remember.

EXPLORE EVERY CELLAR DOOR
Browse 70+ Tasmanian wineries with rich profiles: opening hours, tasting options,
food, family- and dog-friendliness, current-release wines and award history.
Filter by what matters to you and see everything on a beautiful map, from the
Tamar Valley to the Coal River Valley to the East Coast.

ASK THE SOMMELIER
Our AI sommelier knows Tasmanian wine inside out. Ask it anything — "where should
we taste sparkling near Launceston?", "plan a Saturday from Hobart, we love
pinot" — and get real answers grounded in real winery data: who's open, what
they pour, and how long the drive is. It can sketch a full itinerary in seconds.

PLAN THE PERFECT WINE TRAIL
Choose a curated half-day or full-day trip, or build your own from any wineries
you like. SipLocal orders the stops sensibly, maps the route, tracks your
progress on the day, and hands off to your favourite navigation app for
turn-by-turn directions.

READ THE POUR
Our in-app editorial digs into the people and places behind the bottles —
vintage reports, hidden gems, interviews from behind the cellar door, and
food-pairing guides written for Tasmania's produce.

MAKE IT YOURS
Save the wineries you want to visit, log tasting notes as you go, build your
palate profile, and see community notes from fellow travellers.

Whether you're a first-time visitor planning a weekend or a local who wants to
know what's pouring this season, SipLocal helps you drink better in Tasmania.

Drink responsibly. SipLocal is intended for users of legal drinking age.
```

**Support URL:** your website (e.g. `https://siplocalguide.com`) — must be live.
**Marketing URL (optional):** same.
**Privacy Policy URL:** `https://winery-tourism-tasmania.web.app/privacy` (or the
custom domain once the website deploys).
**Copyright:** `© 2026 Benjamin Beckers`

### Age rating questionnaire
Answer "Alcohol, Tobacco, or Drug Use or References" → **Frequent/Intense**.
Everything else None. Resulting rating: **17+**. (Unavoidable for a wine app; do
not under-declare — it's a rejection if caught.)

### App Privacy ("nutrition labels")
Declare exactly this — it matches what the code actually does:

| Data type | Collected? | Linked to identity | Tracking | Purpose |
|---|---|---|---|---|
| Email address | Yes (account sign-up) | Yes | No | App functionality |
| User ID | Yes (Firebase UID) | Yes | No | App functionality |
| Precise location | Yes (near-me sort, distance-to-stop, concierge context) | Yes (sent with userId when signed in) | No | App functionality |
| Other user content (saved wineries, tasting notes, chat messages) | Yes | Yes | No | App functionality, Analytics |
| Product interaction (screens viewed, buttons tapped, articles opened) | Yes (once analytics ships) | Yes | No | App functionality, Analytics |

No third-party advertising, no linking with third-party data for ads, no data-broker
sales of user-level data → **not "tracking" under ATT, no ATT prompt needed**. The
aggregated winery-insights program is fine under these labels because partners only
ever receive de-identified statistics — never user-level data. If that ever changes
(user-level data to partners), the labels, the policy, AND an ATT prompt would all
need revisiting first.
(If Crashlytics gets wired in later, add "Crash Data" before the next submission.)

### Review notes (App Review Information section)
- Demo account: the reviewer credentials from Phase 2.
- Note: "Location is used to sort wineries by distance, show distance to the next
  stop on an active trip, and give the AI concierge geographic context. It is only
  used in the foreground."
- Note: "Account deletion is available at Profile → settings (gear) → Delete account."

## Phase 4 — Screenshots (shot list)

Required size: **6.9" (1320 × 2868)** — iPhone 16/17 Pro Max simulator. Apple scales
this set down for smaller phones. 3 minimum, 10 max — aim for 6:

1. **Home** — hero + "Ask the sommelier" search bar (the brand moment).
2. **Concierge mid-answer** — a real itinerary answer with winery cards visible
   (e.g. "Plan a Saturday from Hobart, we love pinot").
3. **Wineries map** — map view with clustered branded pins over Tasmania.
4. **Winery detail** — a strong profile (hero carousel + Wines tab visible).
5. **Trip detail** — route map with numbered stops + polyline.
6. **The Pour** — editorial issue open (shows depth beyond directory).

Capture: `npx expo run:ios --device "iPhone 17 Pro Max"` (or the production build via
TestFlight), then Cmd+S in Simulator. Statusbar: consider `xcrun simctl status_bar
override --time "9:41"` for clean shots. No device frames or marketing text needed
for v1 — clean in-app shots are fine.

## Phase 5 — Build & submit

```bash
eas build --platform ios --profile production   # first run walks through certs/profiles — accept defaults
eas submit --platform ios --latest              # uploads to App Store Connect
```

Then in App Store Connect: select the build, complete export compliance (already
answered by `usesNonExemptEncryption: false` — standard HTTPS only), add screenshots
+ copy, and **Submit for Review**. First reviews typically take 24–48h.

### Pre-submission smoke test (TestFlight)
- [ ] Install the production build via TestFlight on a real device.
- [ ] Sign up fresh → region resolves → browse wineries → map renders (Maps key works in release build!).
- [ ] Concierge streams an answer (production Cloud Function, requires regionId — deployed ✅).
- [ ] Create + start a trip, directions hand-off works.
- [ ] Save a winery, write a tasting note, delete the account.

## Known review risks (ranked)

1. **5.1.1 forced login** — see Phase 2. Most likely rejection; guest browsing is the fix.
2. **2.1 performance** — reviewer hits a crash/blank screen (e.g. Firestore index missing,
   concierge cold start ~5s). The smoke test above covers this.
3. **4.2 minimum functionality** — unlikely; the app is clearly substantial.
4. **Maps key restrictions** — after rotating the exposed Google Maps key, make sure the
   new key is restricted to bundle id `com.siplocalguide.app` AND added to EAS env vars,
   or maps will render blank in the store build.

## Android (later)

Google Play needs: Play Console account ($25 one-time), `eas build -p android`,
data-safety form (same answers as the privacy table above), and a 17+/Mature
content rating via their questionnaire. The eas.json profiles already cover it.
