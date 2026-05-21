// utils/sessionId.ts
// ─────────────────────────────────────────────────────────────────────────────
// Anonymous session identifier for the concierge / Langfuse.
//
// What is a "session" here?
//   • A stable UUID per install, persisted in AsyncStorage.
//   • Lives across app restarts and survives reinstalls only if the OS
//     retained AsyncStorage (it usually doesn't).
//   • Not tied to a Firebase user — works for fully anonymous users too.
//     When the same person later signs up, the Langfuse trace records
//     BOTH `sessionId` (this UUID) and `userId` (their Firebase UID),
//     so their conversation history stays grouped under the session
//     while also being linkable to the account.
//
// Why not a per-modal-open UUID?
//   • A session in Langfuse is the right grouping for "one user's
//     conversation thread" over time. A new UUID every modal open
//     would split the dashboard into thousands of one-turn rows.
//
// Why AsyncStorage (not SecureStore)?
//   • This isn't a credential. It's a random opaque ID — the only thing
//     it identifies is "the device that talked to the concierge before".
//     No PII, no auth value. AsyncStorage is the right tool.
// ─────────────────────────────────────────────────────────────────────────────

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "siplocal.concierge.sessionId.v1";

let _cached: string | null = null;
let _inFlight: Promise<string> | null = null;

/**
 * RFC4122 v4 UUID generator. Uses `crypto.getRandomValues` when available
 * (Hermes provides it under the Web Crypto polyfill) and falls back to
 * Math.random — fine for an opaque session ID, which isn't a credential.
 *
 * Kept inline so we don't add another dependency just for this one call.
 */
function uuidv4(): string {
  // Prefer crypto-quality randomness when available. RN/Hermes exposes
  // `crypto.randomUUID()` on recent versions; if it exists, just use it.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    try {
      return g.crypto.randomUUID();
    } catch {
      // fall through
    }
  }
  // Hand-rolled v4 — version-4, variant-1 UUID using Math.random.
  // 122 bits of entropy is plenty for what's effectively a UUID-shaped
  // bucket key in the Langfuse dashboard.
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += "-";
    } else if (i === 14) {
      out += "4"; // version
    } else if (i === 19) {
      // variant — one of 8, 9, a, b
      out += hex[8 + Math.floor(Math.random() * 4)];
    } else {
      out += hex[Math.floor(Math.random() * 16)];
    }
  }
  return out;
}

/**
 * Get-or-create the device's persistent concierge session ID.
 *
 * Cached in memory after the first call so subsequent reads don't hit
 * AsyncStorage. The in-flight Promise is also memoised so concurrent
 * callers share a single read+write rather than racing to mint two IDs.
 */
export async function getOrCreateSessionId(): Promise<string> {
  if (_cached) return _cached;
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const existing = await AsyncStorage.getItem(STORAGE_KEY);
      if (existing && existing.length > 0) {
        _cached = existing;
        return existing;
      }
    } catch {
      // AsyncStorage read failed — proceed to mint a fresh ID. We don't
      // bail because Langfuse without a session ID is much worse than a
      // session ID that doesn't survive this app lifetime.
    }
    const fresh = uuidv4();
    try {
      await AsyncStorage.setItem(STORAGE_KEY, fresh);
    } catch {
      // Write failed — we'll re-mint next launch. Still return the value
      // we just generated so the current session is at least grouped.
    }
    _cached = fresh;
    return fresh;
  })();
  try {
    return await _inFlight;
  } finally {
    _inFlight = null;
  }
}

/**
 * Reset the device's concierge session — used if you ever want to give
 * users a "start a fresh conversation thread" button. Mints a new ID
 * on the next call to getOrCreateSessionId().
 *
 * NOT wired up to anything in the UI right now; kept here as a hook.
 */
export async function resetSessionId(): Promise<void> {
  _cached = null;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore — best effort
  }
}
