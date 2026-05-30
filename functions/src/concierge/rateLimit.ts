// functions/src/concierge/rateLimit.ts
// ─────────────────────────────────────────────────────────────────────────────
// Durable per-session daily quota for the concierge endpoint.
//
// Why this exists:
//   The in-memory per-IP minute limiter in index.ts is fast burst control,
//   but it lives inside a single Cloud Run container. With maxInstances=10
//   and an attacker rotating IPs, the documented cap is trivially bypassed.
//   This module backs a per-session daily counter with Firestore so the
//   quota survives container recycle, applies across instances, and gives
//   us a real ceiling on the OpenAI / Voyage / Upstash bill from any
//   single client (mobile install OR website visitor).
//
// How it's keyed:
//   The doc id is `${sessionId}-${dayUtc}` where `dayUtc` is "YYYY-MM-DD"
//   in UTC. UTC is deliberate — this is a server-side budget concept, not
//   a user-facing one. Resetting at UTC midnight is consistent for every
//   user globally and makes the cleanup TTL trivial to reason about.
//
//   A user without a sessionId (older clients, or curl) falls back to a
//   shared bucket keyed by IP. That bucket counts against ALL anonymous
//   no-session traffic from the same IP — incentivizes clients to send
//   their sessionId. Same daily limit applies.
//
// How it stays cheap:
//   One Firestore read + one write per turn (a transaction, but the doc
//   is single-document and contention is per-session so writes are fast).
//   At ~10K turns/day across the user base, that's ~$0.05/month of
//   Firestore. Negligible.
//
//   The `expiresAt` field is set 48h ahead. Configure a Firestore TTL
//   policy on this field (one-time, via Firebase console or gcloud) so
//   old counters auto-delete:
//
//     gcloud firestore fields ttls update expiresAt \
//       --collection-group=concierge_rate_limits \
//       --enable-ttl
//
//   Without the TTL policy, docs accumulate forever — still cheap (~365
//   docs/year/active user) but tidy is better.
//
// Failure mode:
//   If Firestore is unavailable, we fail OPEN — let the request through
//   rather than break the chat for everyone. The in-memory IP limiter
//   still applies as a second line. We log the failure to Cloud Logging
//   so we'd notice if it became chronic.
// ─────────────────────────────────────────────────────────────────────────────

import { Timestamp, getFirestore } from "firebase-admin/firestore";

const COLLECTION = "concierge_rate_limits";

// Default: 100 turns per session per day. Generous for a real user (a
// dedicated trip-planner might do 30–50), tight enough that one
// compromised session can't tank the bill. Override at deploy time via
// CONCIERGE_DAILY_LIMIT_PER_SESSION.
const DEFAULT_DAILY_LIMIT = 100;
const DAILY_LIMIT =
  Number(process.env.CONCIERGE_DAILY_LIMIT_PER_SESSION) || DEFAULT_DAILY_LIMIT;

// How long to keep counter docs around for the Firestore TTL sweeper.
// 48h gives ops time to inspect a hot counter the day after; the TTL
// policy on `expiresAt` does the actual delete.
const COUNTER_KEEP_MS = 48 * 60 * 60 * 1000;

/** Public — result returned to the HTTP handler. */
export interface QuotaResult {
  /** True if the request is within the quota and should be processed. */
  allowed: boolean;
  /** Turns used today (post-increment). When `allowed: false`, this is
   *  the count at the moment of denial — useful for the 429 body. */
  used: number;
  /** The active limit. Exposed in the 429 body so the client can show
   *  "X / Y today" without guessing the server config. */
  limit: number;
  /** Milliseconds (epoch) at which the quota resets — next UTC midnight.
   *  Clients can compute "retry in N hours" from this. */
  resetsAt: number;
  /** True when the Firestore call failed and we fell open. The caller
   *  may want to log this. */
  failedOpen?: boolean;
}

/**
 * Increment the per-session daily counter atomically and report whether
 * the request is within quota.
 *
 * Pre-charge semantics: we increment FIRST and then decide. A server
 * error after the increment "costs" the user one turn against their
 * daily cap. That's the price of having a deterministic, race-free
 * counter without bookkeeping. The error rate is low; the simplicity
 * is worth it.
 *
 * @param identity One of:
 *   - { sessionId: "<uuid>" } — preferred path. Quota is per-session.
 *   - { fallbackIp: "<ip>" }  — used when the client didn't send a
 *                                sessionId. Shared bucket across all
 *                                no-session traffic from that IP.
 */
export async function checkAndIncrementDailyQuota(
  identity: { sessionId: string } | { fallbackIp: string }
): Promise<QuotaResult> {
  const now = Date.now();
  const dayUtc = utcDayKey(new Date(now));
  const resetsAt = nextUtcMidnight(now);

  // Doc id format documents itself in Firestore — easy to grep when
  // chasing a noisy session.
  const docId =
    "sessionId" in identity
      ? `s_${identity.sessionId}_${dayUtc}`
      : `ip_${identity.fallbackIp}_${dayUtc}`;

  const db = getFirestore();
  const ref = db.collection(COLLECTION).doc(docId);

  try {
    const used = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const prev = snap.exists ? Number(snap.data()?.count ?? 0) : 0;
      const next = prev + 1;
      tx.set(
        ref,
        {
          count: next,
          // Keep identity facets readable so we can grep for a bad
          // actor in the console. `key` is the docId stem; `kind` is
          // either "session" or "ip".
          kind: "sessionId" in identity ? "session" : "ip",
          identifier:
            "sessionId" in identity ? identity.sessionId : identity.fallbackIp,
          dayUtc,
          updatedAt: Timestamp.fromMillis(now),
          expiresAt: Timestamp.fromMillis(now + COUNTER_KEEP_MS),
        },
        { merge: true }
      );
      return next;
    });

    return {
      allowed: used <= DAILY_LIMIT,
      used,
      limit: DAILY_LIMIT,
      resetsAt,
    };
  } catch (err) {
    // Firestore unavailable / transaction conflict exhaustion / IAM
    // misconfig. Fail OPEN — better to over-serve than to break the
    // chat for everyone. The in-memory per-IP burst limiter in index.ts
    // is the second line.
    console.warn(
      "[concierge] daily-quota Firestore call failed, failing open:",
      err
    );
    return {
      allowed: true,
      used: 0,
      limit: DAILY_LIMIT,
      resetsAt,
      failedOpen: true,
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** YYYY-MM-DD in UTC. */
function utcDayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Epoch ms at the next UTC midnight after `now`. */
function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0); // setUTCHours(24, ...) rolls to tomorrow 00:00 UTC
  return d.getTime();
}
