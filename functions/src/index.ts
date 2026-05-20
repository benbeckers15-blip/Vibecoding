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
import { logger } from "firebase-functions/v2";

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
//     "userLocation": { "latitude": -42.88, "longitude": 147.32 } | null
//   }
//
// Response: text/event-stream with three event types:
//   event: delta   data: {"text": "<token fragment>"}
//   event: done    data: {<full AskResult>}
//   event: error   data: {"message": "..."}
//
// The client appends delta.text into the active assistant bubble as each
// chunk arrives, then resyncs from done.history when the stream ends.

interface ConciergeRequest {
  message?: unknown;
  history?: unknown;
  userLocation?: unknown;
}

function validateRequest(body: ConciergeRequest): {
  ok: true;
  message: string;
  history: import("./concierge/orchestrator").ChatMessage[];
  userLocation: { latitude: number; longitude: number } | null;
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
  return { ok: true, message: body.message, history, userLocation };
}

// Bounded per-IP rate limiter. Cheap, in-process map keyed by remote IP.
// Resets every RATE_WINDOW_MS. Survives within a single container's warm
// lifespan; a request landing on a different container starts a fresh
// bucket — that's acceptable as a coarse first-line defence.
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

export const concierge = onRequest(
  {
    cors: true,
    invoker: "public",
    // App Check enforcement gets turned on once the iOS app is registered
    // in the Firebase console (Phase 4 work). Leaving off for now so we can
    // hit this endpoint from a laptop with curl during testing.
    // enforceAppCheck: true,

    // Bind every secret the orchestrator's lazy clients read.
    secrets: [
      "OPENAI_API_KEY",
      "VOYAGE_API_KEY",
      "UPSTASH_VECTOR_URL",
      "UPSTASH_VECTOR_TOKEN",
      "GOOGLE_DIRECTIONS_API_KEY",
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

    // Rate-limit by remote IP. Cloud Run / Functions sets the real client
    // IP on `req.ip` via the trust-proxy chain.
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
    let orchestrateTurn: typeof import("./concierge/orchestrator").orchestrateTurn;
    try {
      ({ orchestrateTurn } = await import("./concierge/orchestrator"));
    } catch (err) {
      logger.error("Failed to load orchestrator", err);
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
        (delta) => send("delta", { text: delta }),
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

