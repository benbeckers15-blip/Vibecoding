# Tasmania Workflow

> **Status:** SipLocal targets the `winery-tourism-tasmania` Firestore project
> exclusively. This document is a historical record of how the project was
> bootstrapped, plus an operating manual for the ongoing data pipeline.
>
> An earlier prototype briefly targeted a Margaret River (WA) Firestore
> project; that project has been retired. **Do not re-introduce it.** If you
> see a reference to it in code or config, treat it as a bug.

---

## Current setup

- **Firestore project:** `winery-tourism-tasmania`
- **Service-account JSON:** `service-account-tasmania.json` (repo root, gitignored)
- **App `.env`:** loads `EXPO_PUBLIC_FIREBASE_PROJECT_ID=winery-tourism-tasmania`
- **Active region label:** `EXPO_PUBLIC_REGION_NAME=Tasmania` (drives `constants/region.ts`)

The Firestore collections in use:

```
winery-tourism-tasmania/
├── wineries              ← canonical winery dataset
├── homepage_carousel     ← homepage hero slides
└── premade_trips         ← curated multi-stop itineraries
```

Tasmanian sub-region values stored on `wineries.region` are listed in
`services/concierge/buildContext.ts` (`TASMANIA_REGIONS`). Keep that constant
in sync if a new sub-region is added.

---

## Environment files

```
project-root/
├── .env                ← Active environment (gitignored)
├── .env.tasmania       ← Reference copy of the Tasmania config
└── .gitignore          ← Lists all .env files and service-account-tasmania.json
```

The `scripts/setup-region-env.js` helper exists to interactively manage `.env`
files. It is a remnant of when the codebase briefly supported a second
region — for normal day-to-day work you can ignore it; just edit `.env`
directly. The script is harmless if invoked.

---

## Data pipeline

Scripts in `/scripts` all target the Tasmania project. They obtain
credentials by reading `service-account-tasmania.json` (either directly or
via the `FIREBASE_SERVICE_ACCOUNT_PATH` env var).

Key scripts:

| Script | Purpose |
|---|---|
| `seed-carousel.js` | Seed `homepage_carousel` |
| `geocode-wineries.js` | Add lat/lng to winery docs (Google Geocoding API) |
| `merge-ratings.js` | Merge Google Places ratings into winery docs |
| `add-featured-fields.js` | Add `featured`, `featuredTier`, `featuredLabel` |
| `add-winery-filters.js` | Add boolean filter fields |
| `classify.js` | Use Claude to classify wineries (style, vibe, etc.) |
| `generate-descriptions-tasmania.js` | Generate editorial descriptions via Claude |
| `updateEventsSchema.mjs` | Migrate events to current schema |
| `setup-region-env.js` | Optional env-file switcher (legacy) |

---

## Security best practices

- `.env` files are in `.gitignore` — never commit.
- `service-account-tasmania.json` is in `.gitignore` — never commit.
- Never hardcode Firebase keys, API keys, or project IDs in source code; read
  from env vars instead.
- Once the app ships, set Firestore security rules requiring authenticated
  reads/writes. Example skeleton:

```firestore
match /databases/{database}/documents {
  match /{document=**} {
    allow read, write: if request.auth != null;
  }
}
```

---

## Troubleshooting

**"Permission denied" running a script**
Check `service-account-tasmania.json` exists in the repo root. Either place
it at the default path or set `FIREBASE_SERVICE_ACCOUNT_PATH` in the
environment.

**App shows the wrong region label**
Confirm `EXPO_PUBLIC_REGION_NAME=Tasmania` is set in `.env`. The fallback in
`constants/region.ts` is also `"Tasmania"`, so the only way to see anything
else is if a script or build overrides the env var.

**Firestore reads return nothing**
Confirm `EXPO_PUBLIC_FIREBASE_PROJECT_ID=winery-tourism-tasmania` in `.env`
and re-bundle (Expo doesn't hot-reload env changes — restart `expo start`).
