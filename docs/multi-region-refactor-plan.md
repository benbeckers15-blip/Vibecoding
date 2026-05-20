# SipLocal — Multi-Region Refactor (Option A)

One binary serves every region. Data is partitioned by a `region` field on every content document, with per-region config living in a new `regions/{regionId}` Firestore collection. The active region travels with the user (AsyncStorage + optional profile sync) and is piped through every Firestore query and every concierge request.

This plan is grounded in the current state of `/Users/ben/Desktop/SipLocal` and references real file paths and line numbers. Code sketches show the intended shape; treat them as targets, not finished diffs.

---

## 0. Guiding principles

- **One canonical region id everywhere.** Pick `regionId: string` (slug, kebab-case) as the field name across documents, request bodies, and AsyncStorage keys. Avoid the legacy `region` name on new fields — `wineries.region` already holds a *display* string like `"Tamar Valley"` (a sub-region, not a region). Sub-region stays on the doc; the new top-level partition key is `regionId` (e.g. `"tasmania"`).
- **The app is never region-less.** A region is always selected, including for signed-out users. The picker is a blocking gate on first launch; after that the choice is persisted and queries always have a `where("regionId", "==", activeRegionId)` clause.
- **Sub-regions are optional.** Tasmania has six (Tamar Valley, Pipers River, etc.) and the prompt + UI lean on them heavily. Other regions may be flat — one geographic area, no internal subdivision. Every piece of code that touches sub-regions must gracefully handle `subRegions: []` (or absent): hide sub-region UI, skip neighbour expansion, drop the "don't combine sub-regions" itinerary rule, fall back to a simpler `<user_location>` line. The cleanest way to enforce this is to make `subRegions` the *only* source of sub-region structure on the server — once it's empty, all the dependent logic short-circuits automatically.
- **The corpus stays in one Firebase project.** Multi-region is achieved through document partitioning, not multi-project. (Moving to one Firebase project per region is a heavier alternative; not in scope here.)
- **Tasmania is the seed region.** All existing data is backfilled as `regionId: "tasmania"`. Nothing about the live app changes for current users on day one of the refactor.

---

## 1. Firestore schema

### 1a. New collection: `regions/{regionId}`

One document per supported region. Document id is the slug (`tasmania`, `margaret-river`, …).

```ts
// types/region.ts (NEW — shared by client + functions)
export interface SubRegion {
  name: string;      // "Tamar Valley"
  lat: number;
  lon: number;
  adjacent: string[];// other sub-region names that are <45min drive away
}

export interface RegionConfig {
  regionId: string;            // "tasmania" — matches doc id
  displayName: string;         // "Tasmania"
  displayNameUpper: string;    // "TASMANIA" (precomputed; the prompt and UI both need it)
  brandVoiceLine: string;      // substituted for the "Tasmania" mention in BRAND_VOICE
  regionalPrimer: string;      // long-form markdown injected into the system prompt
  /**
   * Optional. Tasmania has six (Tamar Valley, Pipers River, etc.). Other
   * regions may be flat — leave this empty or omit. Every dependent code
   * path treats `[]`/missing as "this region has no sub-regions": no chip
   * row, no neighbour expansion, no `<user_location>` sub-region anchor,
   * no "don't cross sub-regions" itinerary rule.
   */
  subRegions?: SubRegion[];
  suggestedPrompts: string[];  // empty-state chips (currently hardcoded in ConciergeChat.tsx:66)
  homeHeadline?: string;       // optional editorial header
  mapBounds: {                 // replaces TASMANIA_REGION in wineries/index.tsx:116
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  driveTimeHints?: string;     // free-text — folded into the regional primer if absent there
  /**
   * Optional override for the prompt's itinerary-discipline rule. Today this
   * rule is hardcoded in HARD_RULES and refers to Tasmanian sub-regions and
   * the 45-min drive cap. For Tasmania, leave this blank and keep the
   * existing wording in the regional primer. For a flat region, supply a
   * region-appropriate sentence (or "") and the prompt builder will use it
   * in place of the Tasmanian default. See §4b.
   */
  itineraryDisciplineRule?: string;
  schemaVersion: number;       // 1 — bump if shape changes so callers can defend
}
```

**When `subRegions` is non-empty, it replaces three server-side constants in one shot. When it's empty, all three become no-ops:**

| Today | New source (when subRegions present) | When subRegions empty |
|---|---|---|
| `TASMANIA_REGIONS` (`buildContext.ts:20`) | `subRegions.map(s => s.name)` | `[]` — router never emits a region filter; nothing to enumerate |
| `KNOWN_REGIONS` (`router.ts:22`) | same — but router needs it as a const-time literal for its tool schema; see §4c | tool schema drops the `regions` field entirely, or accepts an always-empty array |
| `REGION_CENTROIDS` (`orchestrator.ts:193`) | `subRegions.map(s => ({ name: s.name, lat: s.lat, lon: s.lon }))` | `[]` — `nearestRegion()` is never called; `<user_location>` falls back to "User is in {displayName}" or omits the sub-region clause |
| `ADJACENT_REGIONS` (`orchestrator.ts:184`) | derived from `subRegions[].adjacent` | `{}` — neighbour expansion in `retrieveCandidates` is skipped |

### 1b. `regionId` field on every content document

| Collection | New field | Notes |
|---|---|---|
| `wineries` | `regionId: string` | Backfill all docs to `"tasmania"`. Keep existing `region` field (sub-region label like `"Tamar Valley"`) — it is still used by the prompt, router, and UI **when the region has sub-regions**. For wineries in a flat region, this field can be left absent/empty/equal to the region's display name; the prompt's `region:` row in the compact format will be omitted when empty (`compactWinery` in `buildContext.ts:217-237` already gates on truthiness, so no code change needed). |
| `premade_trips` | `regionId: string` | Backfill all to `"tasmania"`. Existing `region` (sub-region) stays. |
| `pour_articles` | `regionId: string` | Backfill all to `"tasmania"`. |
| `explore_articles` | `regionId: string` | Backfill all to `"tasmania"`. |
| `knowledge_chunks` | `regionId: string` | Backfill all to `"tasmania"`. **Also** add `regionId` to the Upstash metadata payload — see risk callout in §6. |
| `users/{uid}` | `activeRegionId?: string` | Optional. Sync from AsyncStorage on sign-in so a user moving devices keeps their pick. |

### 1c. Indexes

Adding `where("regionId", "==", ...)` next to existing `orderBy(...)` clauses will trigger Firestore composite-index requirements for:

- `explore_articles`: `regionId asc, order asc` (currently `orderBy("order", "asc")` at `app/(tabs)/explore/index.tsx:73` and `app/(tabs)/home/index.tsx:199`).
- `pour_articles`: `regionId asc, issueNumber desc` (currently `orderBy("issueNumber", "desc")` at `app/(tabs)/explore/index.tsx:98`, `app/(tabs)/home/pour.tsx:96`, `app/(tabs)/home/index.tsx:224`).
- `premade_trips`: `regionId asc, order asc` if `order` is currently used (`app/(tabs)/trips/index.tsx:72`).

Add the index definitions to `firestore.indexes.json` before shipping the queries — deploy index changes first, give them a few minutes to build, *then* deploy the client.

### 1d. Security rules

`firestore.rules` currently allows public read on all content collections. Two adjustments:

- Add `match /regions/{regionId} { allow read: if true; }`.
- Tighten `users/{uid}.activeRegionId` writes to the owner (already covered by the existing owner-only rule on `users/{uid}`).

Region-scoped read enforcement (e.g. preventing client-A from reading region-B docs) is **not** needed today — content is already public-read. If you ever switch to per-region paid access, you'd add a `request.auth` check; out of scope here.

---

## 2. Backfill + migration script

### 2a. Script

Create `scripts/backfill-region-id.js` modelled on the existing `scripts/seed-pour.js` (same admin SDK bootstrap). Idempotent: skip any doc that already has `regionId`.

```js
// scripts/backfill-region-id.js
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const DEFAULT_REGION_ID = "tasmania";
const COLLECTIONS = [
  "wineries",
  "premade_trips",
  "pour_articles",
  "explore_articles",
  "knowledge_chunks",
];
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 400; // Firestore batch limit is 500

(async () => {
  for (const name of COLLECTIONS) {
    const snap = await db.collection(name).get();
    let toUpdate = snap.docs.filter((d) => !d.data().regionId);
    console.log(`${name}: ${snap.size} total, ${toUpdate.length} missing regionId`);
    if (DRY_RUN || toUpdate.length === 0) continue;

    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const doc of toUpdate.slice(i, i + BATCH_SIZE)) {
        batch.update(doc.ref, { regionId: DEFAULT_REGION_ID });
      }
      await batch.commit();
      console.log(`  ${name}: committed ${Math.min(i + BATCH_SIZE, toUpdate.length)}/${toUpdate.length}`);
    }
  }
  console.log("Done.");
  process.exit(0);
})();
```

Run order:

1. `node scripts/backfill-region-id.js --dry-run` and eyeball the counts.
2. `node scripts/backfill-region-id.js` for real.
3. Verify with a quick `_check-*` script (or ad-hoc): every doc in every listed collection now has `regionId: "tasmania"`.

### 2b. Seed the Tasmania region doc

Create `scripts/seed-region-tasmania.js` that writes `regions/tasmania` with all the values currently hardcoded in:

- `BRAND_VOICE` → strip out the "Tasmania" phrase, keep the rest in `brandVoiceLine`. Actually: keep a *full sentence template* in `brandVoiceLine` so the prompt can drop it in verbatim — see §4b.
- `REGIONAL_PRIMER` (`systemPrompt.ts:305`) → `regionalPrimer`.
- `TASMANIA_REGIONS` + `REGION_CENTROIDS` + `ADJACENT_REGIONS` → fold into `subRegions[]`.
- `ConciergeChat.tsx:66` `SUGGESTIONS` → `suggestedPrompts`.
- `wineries/index.tsx:116` `TASMANIA_REGION` → `mapBounds`.
- `REGION_OPTIONS` (`wineries/index.tsx:101`) → derivable from `subRegions.map(s => s.name)`; no need to store separately.

### 2c. Knowledge chunks: Upstash metadata too

`scripts/rag/ingest.js` already writes each chunk to both Firestore and Upstash. Two work items:

- Update `ingest.js` to include `regionId` in the chunk metadata for *new* writes.
- Add a one-off `scripts/rag/backfill-region-upstash.js` that walks the Upstash `knowledge` namespace (and the `wines` namespace for tasting notes) and re-uploads each vector with `regionId: "tasmania"` in metadata. Upstash supports metadata filtering in queries — `knowledgeRetrieve.ts` will then add `filter: { regionId }` to the search call.

---

## 3. Client refactor

### 3a. New: `context/RegionContext.tsx`

This replaces `constants/region.ts` (which becomes a thin re-export for back-compat during the migration, then deleted).

```ts
// context/RegionContext.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import React, { createContext, useContext, useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import type { RegionConfig } from "../types/region";

const STORAGE_KEY = "active_region_id_v1";

type State =
  | { status: "loading" }
  | { status: "needs_picker"; available: { regionId: string; displayName: string }[] }
  | { status: "ready"; regionId: string; config: RegionConfig };

interface Ctx extends Pick<State, "status"> {
  regionId: string | null;
  config: RegionConfig | null;
  available: { regionId: string; displayName: string }[];
  setRegion: (regionId: string) => Promise<void>;
}

const RegionContext = createContext<Ctx>(/* sensible default */ {} as Ctx);

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [available, setAvailable] = useState<Ctx["available"]>([]);

  // 1. On mount: read persisted choice + load the regions index.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, indexSnap] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        // Cheap: tiny doc per region, no listener — we just need names.
        // Could be a top-level `regions_index` doc, or a getDocs on `regions`.
        getRegionsIndex(),
      ]);
      if (cancelled) return;
      setAvailable(indexSnap);
      if (!stored || !indexSnap.find((r) => r.regionId === stored)) {
        setState({ status: "needs_picker", available: indexSnap });
        return;
      }
      const config = await loadRegionConfig(stored);
      setState({ status: "ready", regionId: stored, config });
    })();
    return () => { cancelled = true; };
  }, []);

  const setRegion = async (regionId: string) => {
    await AsyncStorage.setItem(STORAGE_KEY, regionId);
    const config = await loadRegionConfig(regionId);
    setState({ status: "ready", regionId, config });
  };

  return (
    <RegionContext.Provider
      value={{
        status: state.status,
        regionId: state.status === "ready" ? state.regionId : null,
        config: state.status === "ready" ? state.config : null,
        available,
        setRegion,
      }}
    >
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion(): Ctx {
  return useContext(RegionContext);
}

// Convenience for the many screens that just want the display string.
export function useActiveRegionId(): string {
  const { regionId } = useRegion();
  if (!regionId) throw new Error("useActiveRegionId called before region is ready");
  return regionId;
}
```

Helpers (same file or `services/region.ts`):

```ts
async function loadRegionConfig(regionId: string): Promise<RegionConfig> {
  const snap = await getDoc(doc(db, "regions", regionId));
  if (!snap.exists()) throw new Error(`Region ${regionId} not found`);
  return { regionId, ...(snap.data() as Omit<RegionConfig, "regionId">) };
}
```

### 3b. Wire `RegionProvider` into `app/_layout.tsx`

Currently (`app/_layout.tsx:83-104`):

```tsx
<AuthProvider>
  <SavedProvider>
    <TripProvider>
      <Stack>...</Stack>
    </TripProvider>
  </SavedProvider>
</AuthProvider>
```

Becomes:

```tsx
<RegionProvider>
  <AuthProvider>
    <SavedProvider>
      <TripProvider>
        <RegionGate>{/* Stack */}</RegionGate>
      </TripProvider>
    </SavedProvider>
  </AuthProvider>
</RegionProvider>
```

`RegionGate` is a tiny component: renders the splash spinner while `status === "loading"`, renders the picker screen while `"needs_picker"`, renders children once `"ready"`. Region must be settled before Auth proceeds (so the `users/{uid}.activeRegionId` sync in §3d can rely on it), hence Region wraps Auth — not the other way around.

### 3c. Region picker screen

New route: `app/region-picker.tsx`. Shown via `RegionGate` when `status === "needs_picker"`. Modal-style, dark editorial register (matches existing theme tokens in `constants/theme.ts`). Lists `available` regions in two-column cards. On tap → `setRegion(regionId)` → `RegionGate` flips to `"ready"` and the user lands on the home tab.

Add a "Change region" entry to the profile screen that calls `setRegion(newId)`. The transition reloads the cached corpus on next concierge use (see §4d).

### 3d. Optional: sync to `users/{uid}.activeRegionId`

In `context/AuthContext.tsx:54-73` (`ensureUserProfile`), persist the current region from the RegionContext at first sign-in. On subsequent sign-ins, prefer the server value if present and different — but only on a fresh device (i.e. when AsyncStorage doesn't already have a value). Otherwise local wins. Conflict policy: AsyncStorage is canonical for the active session; we write through to Firestore on every `setRegion`.

### 3e. Screen-by-screen edits

Pattern: each Firestore query that returns content gets `where("regionId", "==", regionId)`. Each `REGION_NAME_UPPER` import becomes `useRegion().config.displayNameUpper`.

| File | Lines | Change |
|---|---|---|
| `constants/region.ts` | 15-18 | Delete the file. Replace imports across the app with `useRegion().config.{displayName, displayNameUpper}`. (Or temporarily keep it returning the active value via a sneaky hook re-export until all callers migrate.) |
| `app/index.tsx`, `app/auth.tsx` | render | `REGION_NAME_UPPER` → `config.displayNameUpper`. |
| `app/(tabs)/home/index.tsx` | 175, 198, 223 | Add `where("regionId", "==", regionId)` to each Firestore `query(...)`. Replace `REGION_NAME_UPPER`. |
| `app/(tabs)/home/pour.tsx` | 94-104 | Same: add region filter on both the ordered query and the unordered fallback. |
| `app/(tabs)/explore/index.tsx` | 71-73, 96-98 | Add region filter on `explore_articles` and `pour_articles` queries. |
| `app/(tabs)/wineries/index.tsx` | 101-109 | Delete hardcoded `REGION_OPTIONS`. Derive from `config.subRegions ?? []`. **If empty, hide the sub-region chip row entirely** — don't render a half-filter the user can't use. The same applies to any chip-row container styling that assumes the row is present (margins, dividers); use a conditional render, not an empty array. |
| `app/(tabs)/wineries/index.tsx` | 116-121 | Delete hardcoded `TASMANIA_REGION`. Replace with `config.mapBounds`. |
| `app/(tabs)/wineries/index.tsx` | 267 | Add region filter on the `wineries` getDocs. |
| `app/(tabs)/wineries/[slug].tsx` | 17-18, 95, 155-157 | `REGION_NAME` → `config.displayName`. |
| `app/(tabs)/trips/index.tsx` | 72 | Add region filter on `premade_trips`. |
| `app/(tabs)/trips/[id].tsx` | 111 | Add region filter on `wineries`. |
| `app/(tabs)/trips/create.tsx` | 62 | Add region filter on `wineries`. |
| `filler-articles/collections/[key].tsx` | 137 | Add region filter on `wineries`. |
| `components/ConciergeChat.tsx` | 41, 66, 628 | Replace `REGION_NAME` import; pull `SUGGESTIONS` from `config.suggestedPrompts`. |
| `services/concierge/concierge.ts` | 207-214 (`init` / `loadContext`) | `loadContext` becomes region-scoped: take `regionId`, filter `wineries` collection. See §4d. |
| `services/concierge/concierge.ts` | 245-249 (request body) | Add `regionId` to the request body alongside `userLocation` and `history`. |

### 3f. The "active concierge" footgun

The concierge holds a per-process singleton (`services/concierge/concierge.ts:195-198`) with a cached `wineries[]` array and a chat history. When the user switches region, that singleton's corpus must be invalidated; otherwise `getWinery(slug)` returns wineries from the *old* region. Two clean options:

- **Reset on region change.** `setRegion` calls `getConcierge().reset()` and re-runs `init(newRegionId)`. Chat history is dropped — fair, since the new region has different wineries and the conversation no longer makes sense.
- **Concierge keyed by region.** Replace the singleton with a `Map<regionId, Concierge>`; `getConcierge(regionId)` resolves from the map. Conversation history per region is preserved but RAM grows linearly with regions visited. Probably overkill at two regions.

Recommend the reset path.

---

## 4. Concierge refactor (server)

### 4a. Request body: add `regionId`

Update `functions/src/index.ts:139-196`:

- `ConciergeRequest` gets `regionId?: unknown`.
- `validateRequest` enforces `typeof body.regionId === "string"` and a non-empty trim. Return `{ ok: false, error: "regionId is required" }` if missing.
- The validated `regionId` is passed through to `orchestrateTurn`.

Update `services/concierge/concierge.ts:245-249` so `requestBody.regionId = this.regionId` (stored on the concierge instance after `init`).

### 4b. `buildSystemPrompt` takes a `RegionConfig`

`functions/src/concierge/systemPrompt.ts:481-496` today: `buildSystemPrompt(worldIndex: string): string`. After:

```ts
export function buildSystemPrompt(
  worldIndex: string,
  region: RegionConfig,
): string {
  return [
    buildBrandVoice(region),       // substitutes brandVoiceLine
    TASK_AND_SCOPE,                // can stay constant — it's about the role, not the place
    buildHardRules(region),        // see notes below: sub-region rule is now per-region
    HOURS_RULE,                    // constant
    STYLE_NOTES,                   // mostly constant — region names in the example line are illustrative
    LENGTH_DISCIPLINE,             // constant
    FEW_SHOT,                      // KEEP TASMANIAN for now; few-shot is tone calibration. See §4e.
    region.regionalPrimer,         // ← was REGIONAL_PRIMER constant
    DATASET_FORMAT,                // constant
    TRIP_PROPOSAL_PROTOCOL,        // constant
    WINERY_CARD_PROTOCOL,          // constant
    worldIndex,                    // already per-region once retrieval is filtered
  ].join("\n\n");
}

function buildBrandVoice(region: RegionConfig): string {
  return BRAND_VOICE_TEMPLATE.replace("{{BRAND_VOICE_LINE}}", region.brandVoiceLine);
}
```

The current `BRAND_VOICE` constant becomes `BRAND_VOICE_TEMPLATE` with the Tasmania-specific sentence replaced by `{{BRAND_VOICE_LINE}}`. Sample value for `regions/tasmania.brandVoiceLine`:

> `"the in-app concierge for SipLocal, an editorial wine-tourism guide to Tasmania"`

Sample value for `regions/margaret-river.brandVoiceLine`:

> `"the in-app concierge for SipLocal, an editorial wine-tourism guide to Margaret River"`

For `HARD_RULES`: the rule about "real Tasmanian producer" near line 96 references the place name. Either generalise to "real producer in this region" or template it; both are fine. Recommend keeping the literal "Tasmanian" for now and templating with `{{REGION_DISPLAY_NAME}}` in v2.

**Itinerary-discipline rule (sub-region-aware).** The HARD_RULES block today contains a hardcoded paragraph (around `systemPrompt.ts:146-153`) about not combining sub-regions more than ~45 minutes apart and not crossing the island in a single day. That rule is Tasmania-specific and assumes the region *has* sub-regions and an island geography. The plan is:

- Extract that paragraph into a templated chunk. `buildHardRules(region)` emits the static rule text plus:
  - If `region.subRegions && region.subRegions.length > 0` and `region.itineraryDisciplineRule` is unset: use the current Tasmanian wording (for backwards compat).
  - If `region.itineraryDisciplineRule` is a non-empty string: use it verbatim. This is how Tasmania can opt into a slightly cleaner generic wording later, and how flat regions like Margaret River supply their own ("Keep the day to two to four cellar doors within reasonable driving distance — most of the region is accessible within 30 minutes of itself.").
  - If `region.itineraryDisciplineRule === ""`: skip the rule entirely. Good for tiny regions where any itinerary in the area is fine.

The point of templating this rule (rather than leaving it in the regional primer) is that the model treats `HARD_RULES` as more authoritative than the primer, so itinerary discipline belongs there.

### 4c. Region-config cache (module-scope, per region)

`functions/src/concierge/orchestrator.ts:107` currently has `let _contextPromise: Promise<ConciergeContext> | null = null` — one global cache. Replace with a per-region map:

```ts
const _contextByRegion = new Map<string, Promise<ConciergeContext>>();
const _regionConfigCache = new Map<string, Promise<RegionConfig>>();

async function getRegionConfig(regionId: string): Promise<RegionConfig> {
  let p = _regionConfigCache.get(regionId);
  if (!p) {
    p = (async () => {
      const snap = await getFirestore().collection("regions").doc(regionId).get();
      if (!snap.exists) throw new Error(`Unknown regionId: ${regionId}`);
      return { regionId, ...(snap.data() as Omit<RegionConfig, "regionId">) };
    })();
    p.catch(() => _regionConfigCache.delete(regionId));
    _regionConfigCache.set(regionId, p);
  }
  return p;
}

async function getContext(regionId: string): Promise<ConciergeContext> {
  let p = _contextByRegion.get(regionId);
  if (!p) {
    p = (async () => {
      const { wineries } = await loadContext(regionId); // ← also takes regionId
      const bySlug = new Map<string, WineryDoc>();
      for (const w of wineries) bySlug.set(w.slug || w.id, w);
      const worldIndex = renderWorldIndex(wineries);
      return { wineries, bySlug, worldIndex };
    })();
    p.catch(() => _contextByRegion.delete(regionId));
    _contextByRegion.set(regionId, p);
  }
  return p;
}
```

`loadContext` in `buildContext.ts:390-398` adds the filter:

```ts
export async function loadContext(regionId: string): Promise<{ wineries: WineryDoc[] }> {
  const db = getFirestore();
  const snap = await db.collection("wineries").where("regionId", "==", regionId).get();
  const wineries: WineryDoc[] = snap.docs.map((d) => ({ ...(d.data() as Omit<WineryDoc, "id">), id: d.id }));
  return { wineries };
}
```

`orchestrateTurn` signature in `orchestrator.ts:515-521` gains `regionId: string`:

```ts
export async function orchestrateTurn(
  userMessage: string,
  history: ChatMessage[],
  userLocation: { latitude: number; longitude: number } | null,
  regionId: string,                                  // ← NEW
  onDelta: (delta: string) => void,
  opts: OrchestrateOptions = {},
): Promise<AskResult> {
  const [context, regionConfig] = await Promise.all([
    getContext(regionId),
    getRegionConfig(regionId),
  ]);
  // …
  messages: [{ role: "system", content: buildSystemPrompt(context.worldIndex, regionConfig) }],
  // …
}
```

### 4d. Router & adjacency/centroid lookups

`router.ts:22-29` declares `KNOWN_REGIONS` as a const tuple used in the tool's JSON schema. The tool definition expects an enum of region names. Two options:

- **Strict (recommended for safety):** generate the tool schema at request time from `regionConfig.subRegions`. The router result then validates against the active region only.
- **Loose:** drop the enum constraint from the tool schema and post-validate against `subRegions`.

When `subRegions` is empty (flat region), the `regions` field on the tool drops to either an always-empty enum or — cleaner — gets omitted from the schema altogether. The router prompt should also be conditional: the current prompt encourages the model to extract sub-region names, which is pointless for a flat region. Pull the sub-region examples out of the router system prompt and inject them only when `subRegions.length > 0`.

Same for `ADJACENT_REGIONS` and `REGION_CENTROIDS` in `orchestrator.ts:184-201`: derive them from `regionConfig.subRegions` at the top of `orchestrateTurn` and pass the derived structures into the helpers (`nearestRegion`, the neighbour expansion in `retrieveCandidates`). The helpers themselves move from module scope to plain functions that take adjacency/centroid maps as arguments.

Specifically when `subRegions` is empty:

- `nearestRegion()` is never called.
- The `<user_location>` block (`orchestrator.ts:279-283`) falls back to `"User is currently in {displayName}."` or is omitted (the user's lat/lon still flows into drive-time sort, just without a sub-region label).
- Neighbour expansion in `retrieveCandidates` (`orchestrator.ts:346-395`) short-circuits: it's a same-region-vs-adjacent-region split that doesn't apply when there's only one bucket. The drive-time sort and rating sort already give acceptable results.
- The `decision.regions` filter coming out of the router is always `[]`, so the filter pass at `orchestrator.ts:309-321` reduces to tag-only and named-winery filtering. That's the right behaviour.

### 4e. Few-shot examples

`FEW_SHOT` (`systemPrompt.ts:239-303`) is Tasmania-flavoured. The doc string already acknowledges this is **tone calibration**, not factual. Leave it as-is in v1. In v2, optionally allow `regions/{regionId}.fewShotOverride` to provide a region-tuned version; default falls back to the Tasmanian set.

### 4f. `<user_location>` block

`orchestrator.ts:281` hardcodes `"the ${region} area of Tasmania."` — templatize:

```ts
parts.push(
  `<user_location>User is currently near the ${region} area of ${regionConfig.displayName}.</user_location>`
);
```

### 4g. Knowledge retrieval is region-filtered

`functions/src/concierge/knowledgeRetrieve.ts` needs to filter Upstash queries by `regionId` metadata. The Upstash SDK supports a `filter` parameter on `query()` calls — add `filter: \`regionId = '${regionId}'\`` (Upstash uses an SQL-like metadata filter syntax — verify against their current docs). Pass `regionId` through `retrieveKnowledge(userMessage, regionId)`.

Same change in `functions/src/concierge/tastingNotes.ts` for the `wines` namespace.

---

## 5. Phased rollout

The whole change is bigger than any single deploy should be. Keep the app live throughout.

**Phase 1 — Foundation, no behaviour change** (1 deploy each, can ship in any order)

1. Add `firestore.indexes.json` entries for the new composite indexes. Deploy and wait for index build.
2. Run `scripts/backfill-region-id.js` against production. Verify all docs have `regionId: "tasmania"`. Re-running is safe (idempotent).
3. Seed `regions/tasmania` via `scripts/seed-region-tasmania.js`. Verify the doc.
4. Update `scripts/rag/ingest.js` to write `regionId` metadata on new chunks; run `scripts/rag/backfill-region-upstash.js` once.

At this point: nothing in the app or functions has changed. Production is unaffected.

**Phase 2 — Server, dual-mode**

5. Ship the concierge refactor with `regionId` defaulting to `"tasmania"` when missing from the request body. The function reads from the new `regions/tasmania` doc and applies `where("regionId", "==", ...)` filters. The old client (no `regionId` in body) keeps working.

Verify in production traffic that responses are unchanged. Then:

**Phase 3 — Client**

6. Ship the client: `RegionProvider`, `RegionGate`, picker screen, all screens updated. Active region defaults to `"tasmania"` for existing users (first launch: AsyncStorage is empty → picker shows — but with only one region available, you can either auto-pick or have the picker render only Tasmania as the single card and require a confirming tap). The client now sends `regionId` in every concierge request.

**Phase 4 — Tighten**

7. Remove the `regionId: "tasmania"` default on the server; require it. Bump the API version or rely on the rate-limited rollout to catch stragglers.
8. Delete `constants/region.ts`. Remove all `REGION_NAME` imports.
9. Add a second region (`regions/margaret-river`) and corresponding content. The picker now shows two cards.

**Phase 5 — Hardening (post-second region)**

10. Region-tuned `fewShotOverride` if v1 prompts feel off-tone.
11. Templatize the few "Tasmanian" mentions left in `HARD_RULES` etc.
12. Per-region knowledge namespaces in Upstash, if the metadata-filter approach turns out to be slow at scale.

---

## 6. Risk callouts

**Flat regions vs. sub-regional regions.** Tasmania's prompt and retrieval pipeline are sub-region-aware in many subtle places: the router extracts sub-region names, the orchestrator does neighbour expansion across adjacent sub-regions, `<user_location>` anchors to the nearest sub-region centroid, and `HARD_RULES` contains a "don't combine sub-regions more than 45 minutes apart" rule. Every one of those paths needs to no-op cleanly when `subRegions` is empty, **and the no-op must be testable in isolation** — a regression there will silently degrade the concierge on flat regions (wineries will still come back, but ranking will be subtly wrong and the model may volunteer made-up sub-regional structure). Concrete checklist for any flat region you add:

- The router never returns non-empty `decision.regions`. Confirm with a test query like "best cellar door for chardonnay" — it should retrieve by tag, not by region.
- `<user_location>` either drops the sub-region clause or names the whole region. The model should not invent a sub-region name.
- The system prompt's itinerary discipline rule reads sensibly for the region's geography (see `regions/{regionId}.itineraryDisciplineRule` in §1a / §4b).
- The regional primer describes the *region's* character holistically — climate, varietals, road structure, hub town(s) — rather than enumerating sub-regions that don't exist.
- The wineries screen hides the sub-region chip row entirely (not just rendering an empty row with chrome).

**Upstash namespace vs metadata filter.** The current setup uses a single `knowledge` namespace for all chunks. Adding `regionId` as metadata and filtering at query time is the lightest-touch path, but it depends on Upstash's filter expressions performing well at scale. If you later see latency creep, switch to one namespace per region (`knowledge:tasmania`, `knowledge:margaret-river`). The retrieval helper would then build the namespace string from `regionId`.

**Active-concierge state across region switch.** The `Concierge` singleton in `services/concierge/concierge.ts` caches both the corpus and chat history. Without a reset on `setRegion`, `getWinery(slug)` will return wineries from the previous region while the system prompt and retrieved candidates come from the new one — and chat history will reference wineries the model no longer "knows about". Wire `setRegion` → `concierge.reset()` → re-`init(newRegionId)`. Document this in the profile screen's "Change region" copy.

**Mid-session region switching during an in-flight chat turn.** If the user changes region while an `askStream` call is mid-flight, abort the fetch (`AbortController`) before resetting. Otherwise the SSE stream lands and writes deltas into a UI that has already moved on.

**Active trip survives a region switch.** `TripContext` stores trips in AsyncStorage (`user_trips_v1`). A trip composed of Tasmanian winery slugs becomes orphaned if the user switches to Margaret River — those slug → winery lookups will miss. Options: (a) tag each trip with its source `regionId` and only show trips matching the active region; (b) keep showing all trips but disable Start on cross-region trips. (a) is cleaner.

**Saved wineries** (`user_trips_v1`, `saved_cellar_doors` in AsyncStorage, plus `users/{uid}/savedWineries` subcollection) have the same orphaning issue. Same fix: tag each saved entry with `regionId` and filter on render.

**Composite indexes deploy lag.** Firestore index builds run for minutes-to-tens-of-minutes on collections with thousands of docs. Deploy indexes *first*, wait for them to be `READY`, then ship the client. Otherwise the first user to hit a region-filtered query gets a hard error in production.

**Few-shot drift.** Even with tone calibration as the goal, having only Tasmanian few-shot examples for a Margaret River user might leak unintended priors (specific producers, drive times). If after v1 the model starts mentioning "Jansz" or "Coal River" when serving Margaret River, that's the signal to introduce `regions/{regionId}.fewShotOverride`.

**Signed-out users + `users/{uid}.activeRegionId`.** AsyncStorage is the source of truth for signed-out users. The profile-sync write only happens after sign-in. This is fine — just be explicit in code that the Firestore write is a *backup* and AsyncStorage is canonical for the active session.

**Region picker visible to brand-new sign-ins.** First launch order is: RegionProvider mounts → AsyncStorage empty → picker shown → user picks → AuthProvider runs → user signs in or in as guest. Make sure no auth-gated UI tries to render before the picker resolves. The provider nesting in §3b enforces this.

**Cost of `regionId` on prompt cache.** The system prompt now contains `regionConfig.regionalPrimer` and `regionConfig.brandVoiceLine` — both per-region. OpenAI's prompt cache works prefix-wise, so as long as you put all region-variable content together (e.g. early in the prompt) and keep the truly constant blocks (HARD_RULES, HOURS_RULE, FEW_SHOT, DATASET_FORMAT, the protocols) in identical positions across regions, the cacheable suffix stays large. The plan keeps the order as it is today, which already has the regional primer in the middle, so the cache for the trailing blocks remains shared per-region. Worth measuring after rollout.

---

## 7. Concrete file change summary

**New files**
- `types/region.ts` — shared `RegionConfig`, `SubRegion` types.
- `context/RegionContext.tsx` — provider + `useRegion` hook.
- `app/region-picker.tsx` — picker screen.
- `scripts/backfill-region-id.js`, `scripts/seed-region-tasmania.js`, `scripts/rag/backfill-region-upstash.js`.

**Deleted (after migration completes)**
- `constants/region.ts`.

**Modified — client**
- `app/_layout.tsx` (add provider + gate).
- `context/AuthContext.tsx` (optional `activeRegionId` sync).
- `services/concierge/concierge.ts` (`init(regionId)`, send `regionId` in body, reset on region change).
- `services/concierge/buildContext.ts` (client-side `loadContext(regionId)` filter).
- Every screen in §3e (12 files).

**Modified — functions**
- `functions/src/index.ts` (validate + thread `regionId`).
- `functions/src/concierge/orchestrator.ts` (per-region cache, signature change, dynamic adjacency/centroids).
- `functions/src/concierge/buildContext.ts` (`loadContext(regionId)`, delete `TASMANIA_REGIONS`).
- `functions/src/concierge/systemPrompt.ts` (template `BRAND_VOICE`, take `RegionConfig`).
- `functions/src/concierge/router.ts` (dynamic region enum or post-validate).
- `functions/src/concierge/knowledgeRetrieve.ts` (region-filtered Upstash query).
- `functions/src/concierge/tastingNotes.ts` (same).

**Modified — scripts**
- `scripts/rag/ingest.js` (write `regionId` metadata on new chunks).

**Firestore config**
- `firestore.indexes.json` (composite indexes for region-filtered queries).
- `firestore.rules` (public read on `regions/`).
