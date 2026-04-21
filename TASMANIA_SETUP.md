# Tasmania Firebase Project Setup Guide

## Step 1: Create New Firebase Project (Manual)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click **"Create a project"** or **"Add project"**
3. **Project name:** `winerytourism-tasmania` (or similar)
4. Uncheck "Enable Google Analytics" (optional for prototype)
5. Click **"Create project"** (wait 1-2 minutes for it to initialize)
6. Once created:
   - Go to **Build → Firestore Database**
   - Click **"Create database"**
   - Select **"Start in production mode"** (we'll set rules later)
   - Choose region: **`australia-southeast1` (Sydney)** — closest to Tasmania
   - Click **"Create"**

7. Once Firestore is live, go to **Project Settings** (⚙️ icon, top-left)
8. Scroll to **"Your apps"** section
9. Click **"</>"** (Web) to add a web app
10. Register app as `winerytourism-tasmania`
11. Copy the Firebase config (you'll need this)

---

## Step 2: Get Service Account Credentials

1. In **Project Settings**, go to **Service Accounts** tab
2. Click **"Generate New Private Key"**
3. Save the JSON file as `service-account-tasmania.json` in your project root
4. ⚠️ **Never commit this to git** — add to `.gitignore`

---

## Step 3: Run the Schema Copy Script

Once you have the new Firebase project set up:

```bash
node scripts/copy-schema-to-tasmania.js
```

This will:
- Read all collections and documents from Margaret River Firestore
- Extract the field structure (but leave values empty/null)
- Create the same collections in Tasmania Firestore with placeholder documents
- Print a summary of what was created

---

## Step 4: Update Your .env Files (later)

After the script completes successfully, you'll need to create region-specific env files:

**`.env.margaret-river`** (your current .env)
```
EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSyA5TNrAIwxLBHnlAb9Sv7vUtwdz-edoFAc
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=solid-garden-474012-q4.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=solid-garden-474012-q4
...
```

**`.env.tasmania`** (new)
```
EXPO_PUBLIC_FIREBASE_API_KEY=<tasmania-api-key>
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=<tasmania-auth-domain>
EXPO_PUBLIC_FIREBASE_PROJECT_ID=winerytourism-tasmania
...
```

Then update your build process to load the correct `.env` file.

---

## Troubleshooting

- **"Permission denied" error:** Make sure `service-account-tasmania.json` is in the root directory
- **"Collection not found" error:** Make sure Margaret River Firestore is accessible with your current credentials
- **Firestore initialization stuck:** Check that the Australia region is selected in Step 1
