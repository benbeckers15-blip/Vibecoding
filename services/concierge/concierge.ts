// services/concierge/concierge.ts
// ─────────────────────────────────────────────────────────────────────────────
// Thin SSE client for the server-side concierge function.
//
// Was: a ~1,500-line orchestrator that called OpenAI / Voyage / Upstash
//      directly from the device. That meant shipping all three API keys in
//      the JS bundle — extractable from any release IPA.
//
// Now: this file owns no secrets. Every concierge turn POSTs to a Firebase
//      Cloud Function (`/concierge`), which runs the resolve → route →
//      retrieve → respond pipeline server-side and streams the reply back
//      as SSE events. The class keeps the same public API the chat UI was
//      written against — `init`, `askStream`, `getHistory`, `reset`,
//      `setUserLocation`, `getWinery`, `isReady` — so components/ConciergeChat.tsx
//      doesn't need a single line changed.
//
// What still happens on the device:
//   • `init()` loads the winery corpus from Firestore (public-read collection,
//     no secrets needed). The corpus is used purely for the `getWinery(slug)`
//     lookup the chat UI uses to render inline winery cards. Routing /
//     retrieval / responding all live server-side now.
//   • `askStream()` streams the SSE reply through `onDelta` and resolves
//     with an AskResult (reply text, cost telemetry, parsed proposal +
//     cards, updated history).
//   • Local mutable state: history, GPS location.
//
// Sibling files in this directory (router.ts, retrieve.ts, knowledgeRetrieve.ts,
// tastingNotes.ts, resolveCoreference.ts, driveTimes.ts, systemPrompt.ts) are
// now DEAD CODE — kept on disk only until Phase 4 (the env-var purge), at
// which point they'll be deleted alongside their EXPO_PUBLIC_* secrets.
// ─────────────────────────────────────────────────────────────────────────────

// React Native's built-in `fetch` does not support streaming response bodies —
// the whole body is buffered before `.body.getReader()` returns anything,
// which would defeat the SSE typewriter effect. `expo/fetch` is a drop-in
// replacement that streams properly.
import { fetch as expoFetch } from "expo/fetch";

import { loadContext, type WineryDoc } from "./buildContext";
import type { RouteDecision } from "./types";
import type { TurnCost } from "./costTracker";

// ─── Function URL ───────────────────────────────────────────────────────────
// Override per-build via EXPO_PUBLIC_CONCIERGE_URL. Falls back to the
// deterministic Firebase Functions v1-style URL for the Tasmania project.
// Both that URL and the Cloud Run "tdxk244ojq" URL route to the same Gen2
// function — pick whichever you like; the cloudfunctions.net form is the
// one that doesn't have a per-project random hash.
const CONCIERGE_URL =
  process.env.EXPO_PUBLIC_CONCIERGE_URL ||
  "https://us-central1-winery-tourism-tasmania.cloudfunctions.net/concierge";

// ─── Types re-exported for the chat UI ──────────────────────────────────────

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface TripProposal {
  /** Short editorial label the sommelier picked, e.g. "Coal River pinot day". */
  name: string;
  /** Ordered winery slugs (== Firestore document ids in this app). */
  slugs: string[];
}

export interface WineryCardSuggestion {
  /** Slugs of wineries the model wants to surface as cards. */
  slugs: string[];
}

export interface AskResult {
  reply: string;
  usage?: unknown;
  stopReason?: string | null;
  routerDecision?: RouteDecision;
  candidateCount?: number;
  cost: TurnCost;
  proposal?: TripProposal | null;
  wineryCards?: WineryCardSuggestion | null;
  history: ChatMessage[];
}

// ─── SSE parser ─────────────────────────────────────────────────────────────
// Generic SSE event-stream reader. Splits the response body on the `\n\n`
// event delimiter, peels out `event:` / `data:` lines, JSON-parses the data
// payload, and dispatches each event to the caller.
//
// Throws on:
//   • Non-2xx HTTP status (wrapped as Error with status code in the message)
//   • Network failure
// Server-emitted `event: error` events are dispatched to the caller (not
// thrown here) so askStream() can surface a clean error message.

type SseEvent =
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: AskResult }
  | { event: "error"; data: { message: string } };

async function streamSse(
  url: string,
  body: unknown,
  onEvent: (e: SseEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await expoFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    // Try to surface the server's error JSON if present, otherwise the
    // raw HTTP status. We DON'T try to stream the body here — a non-2xx
    // response is short and one-shot.
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Concierge HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`
    );
  }

  // `expo/fetch` returns a real Web ReadableStream. RN's TextDecoder is
  // globally available in the Hermes runtime.
  const responseBody = res.body as ReadableStream<Uint8Array> | null;
  if (!responseBody) {
    throw new Error("Concierge response has no body.");
  }
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE event boundary: a blank line (`\n\n`). Process every complete
    // event currently sitting in the buffer.
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const eventText = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let eventName = "message";
      let dataLine = "";
      for (const line of eventText.split("\n")) {
        if (line.startsWith("event: ")) {
          eventName = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          // First (and only) data line — our server always emits
          // single-line JSON payloads.
          dataLine = line.slice(6);
        }
      }
      if (!dataLine) continue;

      try {
        const parsed = JSON.parse(dataLine);
        if (eventName === "delta") {
          onEvent({ event: "delta", data: parsed });
        } else if (eventName === "done") {
          onEvent({ event: "done", data: parsed });
        } else if (eventName === "error") {
          onEvent({ event: "error", data: parsed });
        }
        // Unknown event names are silently skipped — forward-compat.
      } catch {
        // Malformed JSON. Skip the event; we'd rather drop one update
        // than crash the chat. The `done` event is the only one that
        // actually matters for correctness; if it's malformed askStream
        // will throw at the "no done event received" check below.
      }
    }
  }

  // If a tail of buffered text remains without a trailing `\n\n`, it was
  // a partial event the server never finished writing. Drop it.
}

// ─── Concierge ──────────────────────────────────────────────────────────────

export class Concierge {
  private wineries: WineryDoc[] = [];
  private bySlug: Map<string, WineryDoc> = new Map();
  private history: ChatMessage[] = [];
  private userLocation: { latitude: number; longitude: number } | null = null;
  private initialized = false;

  /**
   * Load the winery corpus. Required ONLY so `getWinery(slug)` can answer
   * synchronous lookups from the chat UI when rendering winery cards.
   * No API keys are touched here — the wineries collection is public-read.
   * Idempotent.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    const { wineries } = await loadContext();
    this.wineries = wineries;
    const bySlug = new Map<string, WineryDoc>();
    for (const w of wineries) {
      bySlug.set(w.slug || w.id, w);
    }
    this.bySlug = bySlug;
    this.initialized = true;
  }

  /**
   * Stream a single concierge turn from the server.
   *
   * `onDelta` is invoked for every text fragment that arrives off the SSE
   * stream — the chat UI uses this to drive the typewriter effect in the
   * latest assistant bubble.
   *
   * Returns the full AskResult once the `done` event arrives. The server
   * has already parsed any `<<TRIP_PLAN>>` / `<<WINERY_CARD>>` blocks off
   * the tail; the streamed deltas exclude those markers.
   *
   * Throws if the SSE stream ends without a `done` event, on a server-side
   * error event, or on any HTTP / network failure. Callers should wrap in
   * try/catch and surface a friendly message to the user.
   */
  async askStream(
    userMessage: string,
    onDelta: (textDelta: string) => void
  ): Promise<AskResult> {
    if (!this.initialized) {
      // The chat UI auto-calls init() before askStream, but a stray
      // call path could land here cold. Init transparently rather than
      // throw — loadContext() is cheap (Firestore persistent cache).
      await this.init();
    }

    const requestBody = {
      message: userMessage,
      history: this.history,
      userLocation: this.userLocation,
    };

    let result: AskResult | null = null;
    let serverError: string | null = null;

    await streamSse(CONCIERGE_URL, requestBody, (e) => {
      if (e.event === "delta") {
        try {
          onDelta(e.data.text);
        } catch (err) {
          // The chat UI's setState shouldn't throw; if it does, swallow
          // so the stream keeps flowing. Log in DEV.
          if (__DEV__) {
            console.warn("[concierge] onDelta threw:", err);
          }
        }
      } else if (e.event === "done") {
        result = e.data;
      } else if (e.event === "error") {
        serverError = e.data.message || "Server error";
      }
    });

    if (serverError) {
      throw new Error(serverError);
    }
    if (!result) {
      throw new Error("Concierge stream ended without a `done` event.");
    }

    // The server returned the canonical (trimmed) history. Replace ours
    // wholesale — that way we never drift out of sync with what the
    // server will use as context on the next turn.
    this.history = (result as AskResult).history;

    return result;
  }

  /** Store the user's GPS coordinates so the concierge can prioritise nearby wineries. */
  setUserLocation(loc: { latitude: number; longitude: number } | null): void {
    this.userLocation = loc;
  }

  /** Clear the conversation; keep the loaded winery context. */
  reset(): void {
    this.history = [];
  }

  /** Snapshot of the current history — handy for the UI's message list. */
  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Look up a winery by its slug (== Firestore document id). Used by the
   * chat UI to hydrate `proposal.slugs` / `wineryCards.slugs` arrays into
   * full WineryDoc objects (name, coords, image) for the inline cards.
   * Returns `undefined` if the slug isn't in the loaded corpus.
   */
  getWinery(slug: string): WineryDoc | undefined {
    return this.bySlug.get(slug);
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────
// One instance per app process — the chat modal opens/closes frequently and
// we want history + the loaded corpus to survive opens.

let _singleton: Concierge | null = null;

export function getConcierge(): Concierge {
  if (!_singleton) _singleton = new Concierge();
  return _singleton;
}
