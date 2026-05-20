// functions/src/concierge/resolveCoreference.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side port of services/concierge/resolveCoreference.ts.
//
// CHANGES FROM THE CLIENT VERSION:
//   • Env: EXPO_PUBLIC_OPENAI_RESOLVER_MODEL → OPENAI_RESOLVER_MODEL
//   • Diagnostics: React Native's `__DEV__` global → NODE_ENV check
//   • All prompt content + the resolution rules + the example transcripts
//     are unchanged. Same model id, same max-tokens cap, same fail-soft
//     behaviour on error.
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from "openai";
import type { RawUsage } from "./costTracker";

// Cloud Functions sets NODE_ENV=production at runtime. This stays false in
// production so the diagnostic log lines below are no-ops in real traffic,
// but flips true when running locally via the emulator / unit tests.
const IS_DEV = process.env.NODE_ENV !== "production";

export interface ResolveMessage {
  role: "user" | "assistant";
  content: string;
}

const RESOLVER_MODEL =
  process.env.OPENAI_RESOLVER_MODEL || "gpt-5.4-nano";

const RESOLVER_MAX_TOKENS = 200;
const RESOLVER_CONTEXT_MESSAGES = 4;

const RESOLVER_SYSTEM_PROMPT = `You rewrite follow-up messages for a Tasmanian wine concierge so each one stands on its own.

You are given the recent conversation and a NEW user message. Output ONE line containing a self-contained version of that new message that preserves all referential context.

Rules:
- If the new message is already self-contained, output it VERBATIM. Do not paraphrase, expand, or "improve" it.
- If the new message refers back to something the assistant just said ("yes do that", "compare them", "the second one", "what about Saturday instead", "actually I want sparkling"), resolve the references inline so the rewritten message stands alone.
- Stay close to the user's wording and preserve their intent. Do NOT add details, recommendations, or preferences the user didn't express.
- Output ONLY the rewritten message text. No quotes, no preamble, no "Rewritten:" or "OUTPUT:" label, no explanation.

Examples:

Conversation:
ASSISTANT: For sparkling, Bellebonne is the marquee pick. If you want, I can compare it with House of Arras and Jansz as benchmarks.
USER: yes do that
OUTPUT: Compare Bellebonne with House of Arras and Jansz as sparkling benchmarks.

Conversation:
ASSISTANT: Pooley and Frogmore Creek both have proper kitchens — Frogmore leans more casual, Pooley more refined.
USER: which one's better for a date?
OUTPUT: Which is better for a date — Pooley or Frogmore Creek?

Conversation:
ASSISTANT: I'd start at Tolpuddle, then head to Pooley for lunch.
USER: what about Saturday instead?
OUTPUT: Would the Tolpuddle then Pooley plan still work on Saturday?

Conversation:
ASSISTANT: A classic pinot day in Coal River: Tolpuddle, Pooley, Frogmore Creek.
USER: actually I want sparkling
OUTPUT: Plan a sparkling-focused Coal River day instead of pinot.

Conversation:
ASSISTANT: Stoney is a great Coal River pick.
USER: tell me more
OUTPUT: Tell me more about Stoney.

Conversation:
ASSISTANT: Three options near Hobart: Stefano Lubiana, Frogmore Creek, or Pooley.
USER: the first
OUTPUT: Tell me more about Stefano Lubiana.

Conversation:
ASSISTANT: Tamar Valley pairs well with Pipers River for one day.
USER: which wineries in Tamar Valley have a restaurant?
OUTPUT: Which wineries in Tamar Valley have a restaurant?

Now rewrite the next message.`;

export interface ResolveResult {
  rewritten: string;
  wasRewritten: boolean;
  usage: RawUsage | null;
  model: string;
}

export interface ResolveOptions {
  client: OpenAI;
  history: ResolveMessage[];
  model?: string;
}

export async function resolveCoreference(
  userMessage: string,
  opts: ResolveOptions
): Promise<ResolveResult> {
  const model = opts.model || RESOLVER_MODEL;

  if (!opts.history || opts.history.length === 0) {
    return { rewritten: userMessage, wasRewritten: false, usage: null, model };
  }

  const recent = opts.history.slice(-RESOLVER_CONTEXT_MESSAGES);
  const conversationText = recent
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const userTurnContent =
    `Conversation:\n${conversationText}\nUSER: ${userMessage}\nOUTPUT:`;

  try {
    const response = await opts.client.chat.completions.create({
      model,
      max_completion_tokens: RESOLVER_MAX_TOKENS,
      messages: [
        { role: "system", content: RESOLVER_SYSTEM_PROMPT },
        { role: "user", content: userTurnContent },
      ],
    });

    const raw = (response.choices[0]?.message?.content ?? "").trim();
    const usage = extractUsage(response.usage);

    if (!raw) {
      return { rewritten: userMessage, wasRewritten: false, usage, model };
    }

    const cleaned = stripLabelAndQuotes(raw);
    const wasRewritten = cleaned.trim() !== userMessage.trim();

    if (IS_DEV && wasRewritten) {
      console.log("[concierge:resolve] rewrote follow-up", {
        original: userMessage,
        rewritten: cleaned,
      });
    }

    return { rewritten: cleaned, wasRewritten, usage, model };
  } catch (err) {
    if (IS_DEV) {
      console.warn(
        "[concierge:resolve] resolver failed, using original message:",
        err
      );
    }
    return { rewritten: userMessage, wasRewritten: false, usage: null, model };
  }
}

function stripLabelAndQuotes(text: string): string {
  let s = text.trim();
  s = s.replace(/^(output|rewritten)\s*:\s*/i, "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("“") && s.endsWith("”")) ||
    (s.startsWith("‘") && s.endsWith("’"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function extractUsage(
  rawUsage: OpenAI.Completions.CompletionUsage | undefined
): RawUsage | null {
  if (!rawUsage) return null;
  return {
    prompt_tokens: rawUsage.prompt_tokens,
    completion_tokens: rawUsage.completion_tokens,
    prompt_tokens_details: {
      cached_tokens:
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rawUsage as any).prompt_tokens_details?.cached_tokens,
    },
  };
}
