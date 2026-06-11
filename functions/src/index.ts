// functions/src/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// SipLocal Cloud Functions entry point.
//
// PHASE 0 — `ping` liveness probe. Proves CLI / billing / deploy work.
// PHASE 1 — `testEmbed` smoke test for the Voyage secret + module imports.
// PHASE 2 — `concierge` streaming HTTPS function. Runs the full orchestrator
//           (resolve → route → retrieve → respond) server-side and streams
//           the reply back as SSE events.
// ─────────────────────────────────────────────────────────────────────────────

import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { logger } from "firebase-functions/v2";
import { checkAndIncrementDailyQuota } from "./concierge/rateLimit";

// Initialise the Admin SDK once per cold start. Required by buildContext.ts
// and knowledgeRetrieve.ts, which read Firestore via firebase-admin.
initializeApp();

// Account deletion — see deleteAccount.ts for the full rationale and flow.
// Exported here so it deploys alongside the other functions in this file.
export { deleteAccount } from "./deleteAccount";

// Dev-only logging gate. Cloud Functions sets NODE_ENV=production at runtime,
// so this is false in deployed traffic but true under the local emulator.
const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * Liveness probe. Returns 200 with the deploy SHA + a timestamp so we can
 * confirm a deploy actually shipped without parsing function URLs by hand.
 *
 * Region: us-central1 (default). Most of our latency is the OpenAI round-trip
 * which lives in us-east anyway — moving the function closer to Tasmania
 * users wouldn't help.
 */
export const ping = onRequest(
  {
    cors: true,
    // Cloud Functions Gen2 are built on Cloud Run, which defaults to
    // "private — requires auth". We explicitly mark this function public
    // so anyone with the URL can hit it. The concierge function will keep
    // the same invoker setting but add `enforceAppCheck: true` so only
    // requests carrying a valid App Attest token from our real iOS app
    // make it through. (App Check enforcement gets flipped on in Phase 2
    // once the iOS app is registered in the Firebase console.)
    invoker: "public",
    // enforceAppCheck: true,
  },
  (req, res) => {
    logger.info("ping", { ua: req.get("user-agent") });
    res.json({
      ok: true,
      service: "siplocal-functions",
      now: new Date().toISOString(),
    });
  }
);

/**
 * Phase 1 smoke test. Embeds a query string with Voyage and returns the
 * vector's dimensions + first few values. Lets us verify that:
 *   • The VOYAGE_API_KEY secret is bound to this function
 *   • Voyage's API is reachable from Cloud Functions egress
 *   • Our retrieve.ts module imports cleanly
 *
 * Once we trust the secret pipeline, this endpoint can be deleted (or kept
 * as an ops liveness probe — it's cheap, ~$0.00001 per call).
 *
 * Usage:
 *   curl 'https://testembed-<hash>-uc.a.run.app?q=pinot+noir+tasmania'
 */
export const testEmbed = onRequest(
  {
    cors: true,
    invoker: "public",
    // Bind the secret. At runtime the value is exposed via
    // process.env.VOYAGE_API_KEY (the retrieve.ts module reads it from there).
    secrets: ["VOYAGE_API_KEY"],
  },
  async (req, res) => {
    const query = String(req.query.q ?? "pinot noir Tasmania");
    try {
      // Import lazily so a Voyage import error doesn't break the ping probe.
      const { VoyageAIClient } = await import("voyageai");
      const apiKey = process.env.VOYAGE_API_KEY;
      if (!apiKey) {
        res.status(500).json({
          ok: false,
          error: "VOYAGE_API_KEY secret is not bound to this function.",
        });
        return;
      }
      const voyage = new VoyageAIClient({ apiKey });
      const resp = await voyage.embed({
        input: [query],
        model: "voyage-3-lite",
        inputType: "query",
      });
      const vector = resp?.data?.[0]?.embedding;
      if (!vector || !Array.isArray(vector)) {
        res.status(500).json({ ok: false, error: "Voyage returned no embedding." });
        return;
      }
      res.json({
        ok: true,
        query,
        dimensions: vector.length,
        first5: vector.slice(0, 5).map((n) => Number(n.toFixed(6))),
      });
    } catch (err) {
      logger.error("testEmbed failed", err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

// ─── /concierge — streaming HTTPS endpoint ───────────────────────────────────
// Request body (POST, application/json):
//   {
//     "message": "Plan a Saturday from Hobart, we love pinot",
//     "history": [
//       { "role": "user",      "content": "..." },
//       { "role": "assistant", "content": "..." }
//     ],
//     "userLocation": { "latitude": -42.88, "longitude": 147.32 } | null,
//     "regionId": "tasmania"  // REQUIRED — lowercase kebab-case region slug
//   }
//
// Response: text/event-stream with three event types:
//   event: delta   data: {"text": "<token fragment>"}
//   event: done    data: {<full AskResult>}
//   event: error   data: {"message": "..."}
//
// The client appends delta.text into the active assistant bubble as each
// chunk arrives, then resyncs from done.history when the stream ends.
//
// Multi-region: `regionId` is REQUIRED (Phase 4). Both clients always send
// it — the mobile app from RegionContext (Concierge.askStream throws before
// the request if it's missing) and the website's /api/concierge/stream proxy
// (which fills its own default before forwarding). A request without a valid
// regionId is a contract violation and gets a 400, never a silent Tasmania
// fallback — a wrong-region answer is worse than an error.

interface ConciergeRequest {
  message?: unknown;
  history?: unknown;
  userLocation?: unknown;
  regionId?: unknown;
  // Identity fields used for Langfuse trace grouping. Both optional —
  // anonymous users only send `sessionId`; signed-in users send both.
  sessionId?: unknown;
  userId?: unknown;
}

function validateRequest(body: ConciergeRequest): {
  ok: true;
  message: string;
  history: import("./concierge/orchestrator").ChatMessage[];
  userLocation: { latitude: number; longitude: number } | null;
  regionId: string;
  sessionId: string | undefined;
  userId: string | undefined;
} | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be a JSON object." };
  }
  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    return { ok: false, error: "`message` is required and must be a non-empty string." };
  }
  if (body.message.length > 4000) {
    return { ok: false, error: "`message` is longer than 4000 chars." };
  }
  // History must be an array of {role: 'user'|'assistant', content: string}
  let history: import("./concierge/orchestrator").ChatMessage[] = [];
  if (body.history !== undefined && body.history !== null) {
    if (!Array.isArray(body.history)) {
      return { ok: false, error: "`history` must be an array." };
    }
    if (body.history.length > 40) {
      return { ok: false, error: "`history` is too long (max 40 entries)." };
    }
    for (const m of body.history) {
      if (
        !m ||
        typeof m !== "object" ||
        ((m as { role: unknown }).role !== "user" &&
          (m as { role: unknown }).role !== "assistant") ||
        typeof (m as { content: unknown }).content !== "string"
      ) {
        return { ok: false, error: "Each history entry must be {role:'user'|'assistant', content:string}." };
      }
    }
    history = body.history as import("./concierge/orchestrator").ChatMessage[];
  }
  // userLocation is optional
  let userLocation: { latitude: number; longitude: number } | null = null;
  if (body.userLocation !== undefined && body.userLocation !== null) {
    const loc = body.userLocation as { latitude?: unknown; longitude?: unknown };
    if (
      typeof loc.latitude !== "number" ||
      typeof loc.longitude !== "number" ||
      Number.isNaN(loc.latitude) ||
      Number.isNaN(loc.longitude)
    ) {
      return { ok: false, error: "`userLocation` must be {latitude:number, longitude:number} or null." };
    }
    userLocation = { latitude: loc.latitude, longitude: loc.longitude };
  }
  // regionId — REQUIRED (Phase 4: the "tasmania" back-compat default is
  // gone). Shape validation only; whether the region actually exists is
  // checked downstream by regionConfig (unknown ids fail the Firestore
  // lookup with a clear error).
  if (typeof body.regionId !== "string" || body.regionId.trim().length === 0) {
    return { ok: false, error: "`regionId` is required and must be a non-empty string." };
  }
  if (!/^[a-z0-9-]+$/.test(body.regionId)) {
    return { ok: false, error: "`regionId` must be lowercase kebab-case." };
  }
  const regionId: string = body.regionId;
  // sessionId / userId — both optional strings. We validate shape only; the
  // client generates a UUID v4 for sessionId and forwards the Firebase UID
  // (or omits the field) for userId.
  let sessionId: string | undefined;
  if (body.sessionId !== undefined && body.sessionId !== null) {
    if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
      return { ok: false, error: "`sessionId` must be a non-empty string when provided." };
    }
    if (body.sessionId.length > 128) {
      return { ok: false, error: "`sessionId` is too long (max 128 chars)." };
    }
    sessionId = body.sessionId;
  }
  let userId: string | undefined;
  if (body.userId !== undefined && body.userId !== null) {
    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return { ok: false, error: "`userId` must be a non-empty string when provided." };
    }
    if (body.userId.length > 128) {
      return { ok: false, error: "`userId` is too long (max 128 chars)." };
    }
    userId = body.userId;
  }
  return {
    ok: true,
    message: body.message,
    history,
    userLocation,
    regionId,
    sessionId,
    userId,
  };
}

// Layer 1 — Bounded per-IP burst limiter. Cheap, in-process map keyed by
// remote IP. Resets every RATE_WINDOW_MS. Survives within a single
// container's warm lifespan; a request landing on a different container
// starts a fresh bucket. This is FAST burst control — it stops a single
// IP from hammering one warm instance with hundreds of requests in a
// minute. It does NOT bound the total bill from one client over a day.
//
// Layer 2 (the real ceiling) is the Firestore-backed per-session daily
// quota in ./concierge/rateLimit.ts — that's what stops a single client
// (mobile install or website visitor) from accidentally OR maliciously
// burning the OpenAI budget.
//
// Layer 3 is App Check, which the function options below enforce when
// CONCIERGE_ENFORCE_APP_CHECK=true is set on the deployed environment.
// That blocks traffic that isn't coming from our registered iOS / web
// clients in the first place.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30; // requests per IP per minute
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

// App Check enforcement is env-controlled so we can ship the code path
// before the iOS app and web reCAPTCHA site key are registered in the
// Firebase console. Default OFF — flipping it on without registering
// would 401 every legitimate request.
//
// Deploy with --set-env-vars CONCIERGE_ENFORCE_APP_CHECK=true once:
//   1. The iOS app is registered for App Check (App Attest provider) in
//      Firebase console → App Check → Apps tab.
//   2. The website domain is registered with reCAPTCHA v3 site key
//      bound to the web app entry under the same App Check tab.
//   3. The website AND iOS clients are fetching App Check tokens and
//      attaching them to /concierge requests as `X-Firebase-AppCheck`.
//
// During development against the deployed function, generate a debug
// token via the Firebase JS SDK / iOS SDK init logs and register it in
// Firebase console → App Check → Apps → ⋮ → Manage debug tokens. That
// lets your dev build through without owning real attestation creds.
const ENFORCE_APP_CHECK = process.env.CONCIERGE_ENFORCE_APP_CHECK === "true";

export const concierge = onRequest(
  {
    cors: true,
    invoker: "public",
    // App Check enforcement is handled MANUALLY inside the handler
    // below — Gen 2 `onRequest`'s HttpsOptions does NOT support the
    // `enforceAppCheck` flag (that's a `onCall`-only option). For raw
    // HTTPS functions we verify the X-Firebase-AppCheck header via
    // the Admin SDK. Gated on CONCIERGE_ENFORCE_APP_CHECK env var.

    // Bind every secret the orchestrator's lazy clients read.
    // LANGFUSE_* are optional — if not bound, the orchestrator just skips
    // tracing rather than failing. That lets you deploy the function in
    // environments where you don't want observability (e.g. local emulator
    // without Langfuse keys) and still have the concierge work.
    secrets: [
      "OPENAI_API_KEY",
      // Response-leg LLM key. The orchestrator picks between Gemini and
      // OpenAI via LLM_PROVIDER (default "gemini") — see
      // functions/src/concierge/orchestrator.ts. Even when the default
      // is Gemini, OPENAI_API_KEY stays bound because the router and
      // resolver still run on OpenAI. To roll back the response leg to
      // OpenAI without code changes, set LLM_PROVIDER=openai in the
      // function's env and redeploy; GEMINI_API_KEY can remain bound
      // (an unused bound secret has no cost or effect).
      //
      // Populate with: `firebase functions:secrets:set GEMINI_API_KEY`
      // and paste the AI Studio key (same value as scripts/.env's
      // GEMINI_API_KEY entry).
      "GEMINI_API_KEY",
      "VOYAGE_API_KEY",
      "UPSTASH_VECTOR_URL",
      "UPSTASH_VECTOR_TOKEN",
      "GOOGLE_DIRECTIONS_API_KEY",
      "LANGFUSE_PUBLIC_KEY",
      "LANGFUSE_SECRET_KEY",
      // Optional — only needed when your Langfuse project lives somewhere
      // other than the SDK's default (https://cloud.langfuse.com, which is
      // EU). Set this secret to https://us.cloud.langfuse.com for US Cloud
      // or to your self-hosted URL. If unset, the function falls through
      // to the EU default, which silently splits traces from the dashboard
      // you're actually looking at.
      "LANGFUSE_BASEURL",
    ],

    // The concierge typically runs 5-15 seconds end-to-end (3 OpenAI calls,
    // 3 Voyage embeds, 3 Upstash queries, sometimes a Distance Matrix call).
    // Allow a generous timeout so first-cold-start traffic doesn't get
    // cut off when warming caches.
    timeoutSeconds: 120,

    // 512 MiB gives us headroom for the loaded winery corpus + world index
    // string (~50-100 KB cached at module scope) plus the system prompt
    // building. 256 would also work but the cushion is cheap.
    memory: "512MiB",

    // Cap concurrency so a runaway client can't fan-out our OpenAI bill.
    // Each instance can still handle multiple concurrent users.
    maxInstances: 10,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      // CORS preflight; the `cors: true` option above already sets the
      // headers, but we still need to return 204.
      res.status(204).end();
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    // ── Layer 3 — App Check (env-gated) ────────────────────────────────
    // Manual verification because HttpsOptions on Gen 2 onRequest
    // doesn't expose `enforceAppCheck` (that's a onCall-only option).
    // When ENFORCE_APP_CHECK is on, every request must carry a valid
    // X-Firebase-AppCheck token issued by App Attest (iOS),
    // Play Integrity (Android), or reCAPTCHA v3 (web). Without one,
    // the request is rejected with 401 before touching OpenAI.
    //
    // Verification is ~5–20ms on a warm container (one signed-token
    // check against the App Check public keys, which the SDK caches).
    if (ENFORCE_APP_CHECK) {
      const appCheckToken = req.header("X-Firebase-AppCheck");
      if (!appCheckToken) {
        res.status(401).json({
          error:
            "Missing App Check token. This endpoint requires a valid " +
            "X-Firebase-AppCheck header.",
        });
        return;
      }
      try {
        await getAppCheck().verifyToken(appCheckToken);
      } catch (err) {
        // Don't echo the verifier's error to the client — the message
        // sometimes includes "token signature invalid" / "expired" /
        // etc. which is fine to surface internally but could help an
        // attacker triangulate the verifier's behaviour. Log it for
        // ops; give the client a generic 401.
        logger.warn("App Check verification failed", err);
        res.status(401).json({ error: "Invalid App Check token." });
        return;
      }
    }

    // ── Layer 1 — Per-IP burst limit (in-memory) ──────────────────────
    // Rate-limit by remote IP. Cloud Run / Functions sets the real client
    // IP on `req.ip` via the trust-proxy chain. This is the cheap, fast
    // burst control — the durable per-session-day cap is enforced via
    // checkAndIncrementDailyQuota further down.
    const clientIp = req.ip || (req.headers["x-forwarded-for"] as string) || "unknown";
    if (isRateLimited(clientIp)) {
      res.status(429).json({ error: "Rate limit exceeded. Try again in a moment." });
      return;
    }

    const validation = validateRequest(req.body as ConciergeRequest);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    // Layer 2 — durable per-session daily quota. Caps a single client
    // (mobile install OR website visitor) at N turns per UTC day. The
    // count survives container recycle and applies across instances.
    // When the client didn't send a sessionId, falls back to a per-IP
    // shared bucket (same limit) so older clients and curl users still
    // get bill protection, just with worse isolation than sessionId
    // clients. Fails open on Firestore errors — see rateLimit.ts.
    const quotaIdentity = validation.sessionId
      ? { sessionId: validation.sessionId }
      : { fallbackIp: clientIp };
    const quota = await checkAndIncrementDailyQuota(quotaIdentity);
    if (!quota.allowed) {
      // Standard Retry-After header (in seconds) lets a well-behaved
      // client back off until tomorrow's reset. Payload includes the
      // numbers so the chat UI can show "You've used 100/100 today,
      // resets in 4h".
      const retryAfterSec = Math.max(
        1,
        Math.ceil((quota.resetsAt - Date.now()) / 1000)
      );
      res.set("Retry-After", String(retryAfterSec));
      res.status(429).json({
        error:
          "Daily concierge limit reached. Resets at midnight UTC. " +
          `(${quota.used}/${quota.limit} today.)`,
        used: quota.used,
        limit: quota.limit,
        resetsAt: quota.resetsAt,
      });
      return;
    }

    // ── Open the SSE stream ────────────────────────────────────────────
    // Standard SSE handshake: text/event-stream, no caching, no transform.
    // `X-Accel-Buffering: no` is a nginx hint that some proxies honour to
    // disable response buffering; harmless if ignored.
    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();

    const send = (event: string, data: unknown): void => {
      // SSE wire format: `event: <name>\ndata: <payload>\n\n`.
      // Multi-line data needs each line prefixed with `data: `; we keep our
      // payloads single-line JSON to avoid that complication.
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        // The client disconnected mid-stream. Swallow — there's nowhere to
        // send the error and the rest of the function will tear itself
        // down once the response stream is closed.
        if (IS_DEV) {
          logger.warn("SSE write failed (client disconnected?)", err);
        }
      }
    };

    // Lazy-import the orchestrator so a syntax error in the concierge
    // modules can't break the simpler ping / testEmbed endpoints. (At
    // steady state this import is free — Node caches the resolved module.)
    //
    // V1 / V2 SELECTION. CONCIERGE_USE_V2 picks between the live v1
    // orchestrator and the v2 rewrite (see docs/concierge-rewrite-spec.md).
    // Default OFF — v1 keeps serving production traffic. Set
    // `CONCIERGE_USE_V2=true` in the function's runtime env to flip
    // a single instance over for soak testing, or all instances over
    // for the cutover. Rollback is one env var change — both
    // implementations stay compiled into the bundle.
    //
    // Both orchestrators expose `orchestrateTurn(message, history,
    // userLocation, regionId, onDelta, identity, opts) → AskResult`
    // with identical AskResult shape (reply, proposal, wineryCards,
    // history, cost, etc.) so the SSE event payload is byte-stable
    // across the cutover. The client doesn't notice the switch.
    const USE_V2 = process.env.CONCIERGE_USE_V2 === "true";
    let orchestrateTurn:
      | typeof import("./concierge/orchestrator").orchestrateTurn
      | typeof import("./concierge/v2/orchestrator").orchestrateTurnV2;
    try {
      if (USE_V2) {
        const v2 = await import("./concierge/v2/orchestrator");
        orchestrateTurn = v2.orchestrateTurnV2;
        if (IS_DEV) {
          logger.info("Concierge turn handled by v2 orchestrator");
        }
      } else {
        const v1 = await import("./concierge/orchestrator");
        orchestrateTurn = v1.orchestrateTurn;
      }
    } catch (err) {
      logger.error("Failed to load orchestrator", { useV2: USE_V2, err });
      send("error", {
        message: "Concierge module failed to load. Please try again.",
      });
      res.end();
      return;
    }

    try {
      const result = await orchestrateTurn(
        validation.message,
        validation.history,
        validation.userLocation,
        validation.regionId,
        (delta) => send("delta", { text: delta }),
        {
          sessionId: validation.sessionId,
          userId: validation.userId,
        },
      );
      send("done", result);
      res.end();
    } catch (err) {
      logger.error("Concierge turn failed", err);
      send("error", {
        message: err instanceof Error ? err.message : String(err),
      });
      res.end();
    }
  }
);

