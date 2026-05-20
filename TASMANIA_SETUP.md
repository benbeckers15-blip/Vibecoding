# Tasmania Firebase Project Setup Guide

> **Status:** The migration from the original prototype Firestore to the Tasmania
> project is complete. This document is kept as a reference for how the
> `winery-tourism-tasmania` project was provisioned. The app and all scripts
> now read/write `winery-tourism-tasmania` exclusively. **Do not re-introduce
> the deprecated prototype project.**

---

## Current state

- **Active Firestore project:** `winery-tourism-tasmania`
- **Service-account JSON:** `service-account-tasmania.json` (in repo root, gitignored)
- **App env file:** `.env` (loads `EXPO_PUBLIC_FIREBASE_PROJECT_ID=winery-tourism-tasmania`)
- **Region:** `australia-southeast1` (Sydney) — closest available to Tasmania

---

## How the project was created (historical reference)

1. In the [Firebase Console](https://console.firebase.google.com), a new project
   named `winery-tourism-tasmania` was created.
2. Google Analytics was left disabled (prototype-stage).
3. **Build → Firestore Database** → **Create database** → **production mode** →
   region `australia-southeast1` (Sydney).
4. **Project Settings → Your apps → Web** → registered a web app as
   `winery-tourism-tasmania`; the web config was copied into `.env`.
5. **Project Settings → Service Accounts → Generate New Private Key** → saved
   as `service-account-tasmania.json` in the repo root. **Never commit this
   file** — it is in `.gitignore`.

---

## Environment files

`.env` (root) holds the active Firebase config via `EXPO_PUBLIC_` variables.
Example shape (real values omitted):

```
EXPO_PUBLIC_FIREBASE_API_KEY=<api-key>
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=winery-tourism-tasmania.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=winery-tourism-tasmania
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=winery-tourism-tasmania.firebasestorage.app
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<sender-id>
EXPO_PUBLIC_FIREBASE_APP_ID=<app-id>
EXPO_PUBLIC_REGION_NAME=Tasmania
```

A duplicate copy lives at `.env.tasmania` for convenience when switching
environments via `scripts/setup-region-env.js`.

---

## Troubleshooting

- **"Permission denied" from a script:** check `service-account-tasmania.json`
  is present in the repo root and that the env var
  `FIREBASE_SERVICE_ACCOUNT_PATH` points to it (or defaults to it).
- **Firestore initialization stuck:** confirm the project's Firestore region
  is `australia-southeast1`.
- **App shows region label "undefined" or wrong region:** check that
  `EXPO_PUBLIC_REGION_NAME=Tasmania` is set in `.env`.
