# Tasmania Launch Workflow

This document outlines the complete workflow for launching a Tasmania version of WineryTourism alongside the Margaret River version.

---

## Quick Start (3 Steps)

### 1️⃣ Create Tasmania Firebase Project
Follow the instructions in `TASMANIA_SETUP.md` → **Step 1 & 2**

You'll end up with:
- New Firebase project: `winerytourism-tasmania`
- Service account credentials: `service-account-tasmania.json`

### 2️⃣ Copy Schema Structure
```bash
node scripts/copy-schema-to-tasmania.js
```

This reads your Margaret River Firestore and creates equivalent empty collections in Tasmania. You now have:
- ✅ Same collection names (`wineries`, `events`, `homepage_carousel`, etc.)
- ✅ Same field structure (but with placeholder/empty values)
- ✅ Ready to populate with Tasmania data

### 3️⃣ Set Up Region Environments
```bash
node scripts/setup-region-env.js
```

Interactive setup to create `.env.margaret-river` and `.env.tasmania` files.

---

## What the Schema Copy Script Does

### Input: Margaret River Firestore
```
Collections:
├── wineries
│   ├── doc-1 { name: "...", slug: "...", rating: 4.5, ... }
│   └── doc-2 { name: "...", slug: "...", rating: 4.3, ... }
├── events
│   ├── doc-1 { title: "...", startDate: "...", ... }
│   └── doc-2 { ... }
└── homepage_carousel
    └── doc-1 { title: "...", imageUrl: "...", ... }
```

### Output: Tasmania Firestore
```
Collections (NEW, EMPTY):
├── wineries
│   └── _placeholder_<timestamp> { name: "", slug: "", rating: 0, ... }
├── events
│   └── _placeholder_<timestamp> { title: "", startDate: "", ... }
└── homepage_carousel
    └── _placeholder_<timestamp> { title: "", imageUrl: "", ... }
```

**Key points:**
- All collections are created
- All fields are present with empty/placeholder values
- Placeholder documents are marked with `_placeholder_*` IDs (you can delete them)
- Field types are preserved (strings → "", numbers → 0, booleans → false, arrays → [])

---

## Environment File Management

### Structure After Setup

```
project-root/
├── .env                    ← Active environment (DO NOT COMMIT)
├── .env.margaret-river     ← Margaret River credentials
├── .env.tasmania           ← Tasmania credentials
└── .gitignore             ← Should include all .env files
```

### Switching Regions

**Switch to Margaret River:**
```bash
node scripts/setup-region-env.js margaret-river
```

**Switch to Tasmania:**
```bash
node scripts/setup-region-env.js tasmania
```

**Interactive menu:**
```bash
node scripts/setup-region-env.js
```

---

## Next Steps: Populating Tasmania Data

Once you have the empty schema in Tasmania Firestore, you need to:

### Option A: Manual Upload (via Firebase Console)
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your `winerytourism-tasmania` project
3. Go to **Firestore Database**
4. Manually create documents or bulk import JSON

### Option B: Adapt Your Data Pipeline Scripts
Your existing scripts in `/scripts` can be adapted:

**Example: `add-winery-filters.js`**
Currently targets Margaret River. To use for Tasmania:
1. Modify the script to point to Tasmania credentials
2. Update data sources to reference Tasmania wineries
3. Run the script

**Example modification:**
```javascript
// Change this:
const db = admin.firestore();

// To this:
const serviceAccount = require('../service-account-tasmania.json');
const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore(app);
```

### Option C: Create New Data Pipeline for Tasmania
Copy your Margaret River pipeline and adapt it for Tasmania sources:
```bash
cp scripts/add-winery-filters.js scripts/add-winery-filters-tasmania.js
# Edit the new file to use Tasmania credentials + data sources
node scripts/add-winery-filters-tasmania.js
```

---

## Code Changes Required (For Multi-Region Support)

Once Tasmania is live, you'll eventually want one codebase to support both regions. Here's how:

### 1. Create Region Configuration

**`config/regions.ts` (new file)**
```typescript
export type Region = 'margaret-river' | 'tasmania';

export const REGION_CONFIG: Record<Region, RegionData> = {
  'margaret-river': {
    name: 'Margaret River',
    latitude: -33.95,
    longitude: 115.07,
    latitudeDelta: 1.0,
    longitudeDelta: 0.5,
  },
  'tasmania': {
    name: 'Tasmania',
    latitude: -42.0,  // Center of Tasmania
    longitude: 147.0,
    latitudeDelta: 3.0,
    longitudeDelta: 2.0,
  },
};
```

### 2. Update App to Read Region from Environment

**`firebaseConfig.js` (modified)**
```javascript
// Already loads from .env
// Just make sure environment is switched before building/running
```

### 3. Update Map Constants

**`app/(tabs)/wineries/index.tsx` (modified)**
```typescript
// Instead of hardcoded MARGARET_RIVER_REGION:
const REGION = process.env.EXPO_PUBLIC_REGION || 'margaret-river';
const REGION_MAP = REGION_CONFIG[REGION];
```

But **for now** — while you're still building Margaret River — **no code changes are needed**. Just keep using Margaret River as-is.

---

## Security Best Practices

### Firebase Credentials
- ✅ `.env` files are in `.gitignore` (don't commit)
- ✅ `service-account-*.json` files are in `.gitignore`
- ❌ Never hardcode Firebase keys in source code
- ❌ Never commit credentials to git

### Firestore Rules
Once Tasmania goes live, **set up Firestore security rules** to:
- Allow authenticated reads/writes only
- Prevent accidental cross-region access

Example future rule:
```firestore
match /databases/{database}/documents {
  match /{document=**} {
    allow read, write: if request.auth != null;
  }
}
```

---

## Troubleshooting

### "Permission denied" when running copy script
- Check `service-account-tasmania.json` exists in project root
- Verify file has correct Firebase Admin SDK credentials
- Ensure the credentials have Firestore access in GCP

### "Collection not found" when running copy script
- Ensure Margaret River Firestore has the collections
- Verify `service-account.json` has access to Margaret River project

### "Can't switch to Tasmania" with env script
- Ensure you've run `setup-region-env.js 3` to create `.env.tasmania` first
- Verify the Tasmania Firebase credentials are correct

### Schema copy created wrong field types
- The script infers types from the first document in each collection
- If that document has null values, check the second/third document
- Manually verify the schema in Tasmania Firestore looks correct

---

## Quick Reference: File Locations

| File/Script | Purpose |
|---|---|
| `TASMANIA_SETUP.md` | Step-by-step Firebase project creation |
| `TASMANIA_WORKFLOW.md` | This file — overall workflow |
| `scripts/copy-schema-to-tasmania.js` | Copies schema from MR → TAS |
| `scripts/setup-region-env.js` | Manages .env files per region |
| `service-account.json` | Margaret River credentials (DO NOT COMMIT) |
| `service-account-tasmania.json` | Tasmania credentials (DO NOT COMMIT) |
| `.env` | Active environment (DO NOT COMMIT) |
| `.env.margaret-river` | Margaret River env config |
| `.env.tasmania` | Tasmania env config |

---

## Questions?

If you hit any issues:
1. Check the error message carefully
2. Review the relevant script comments
3. Verify Firebase project is properly configured
4. Check that service account JSON is in the root directory with correct permissions
