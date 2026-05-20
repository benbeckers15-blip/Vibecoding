# Task: Migrate SipLocal concierge from Anthropic SDK to OpenAI SDK

You are migrating the AI concierge service in the SipLocal app from
`@anthropic-ai/sdk` to the `openai` npm package. This is a TypeScript
React Native (Expo) project with strict mode ON. The concierge is a
wine-tourism chatbot for Tasmania.

---

## Scope — exactly these files change

| File | Change type |
|---|---|
| `package.json` | Swap dependency |
| `.env` | Swap env var names |
| `services/concierge/router.ts` | Rewrite SDK calls + tool-use parsing |
| `services/concierge/concierge.ts` | Rewrite SDK calls + streaming |
| `services/concierge/costTracker.ts` | Rewrite pricing table + usage types |

**Do NOT touch anything else.** These files are untouched:
- `services/concierge/retrieve.ts` (Voyage + Upstash — not Anthropic)
- `services/concierge/knowledgeRetrieve.ts` (same)
- `services/concierge/buildContext.ts` (pure data formatting)
- `services/concierge/systemPrompt.ts` (returns plain strings, no SDK)
- `components/ConciergeChat.tsx` (UI layer, SDK-agnostic)

---

## 1. package.json

Remove `@anthropic-ai/sdk`. Add `openai` (latest stable).

---

## 2. .env

```diff
- EXPO_PUBLIC_ANTHROPIC_API_KEY=sk-ant-...
- EXPO_PUBLIC_CLAUDE_MODEL=claude-haiku-4-5
- EXPO_PUBLIC_CLAUDE_ROUTER_MODEL=claude-haiku-4-5

+ EXPO_PUBLIC_OPENAI_API_KEY=sk-...
+ EXPO_PUBLIC_OPENAI_MODEL=gpt-5.4-mini
+ EXPO_PUBLIC_OPENAI_ROUTER_MODEL=gpt-5.4-mini
```

Leave the placeholder values as empty strings — the user will fill them in.

---

## 3. services/concierge/costTracker.ts

Completely rewrite this file. The OpenAI usage shape is different from
Anthropic's — no `cache_creation_input_tokens`, no `cache_read_input_tokens`.
Instead OpenAI returns `prompt_tokens_details.cached_tokens`.

**New `RawUsage` interface:**

```ts
export interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}
```

**New pricing table** — OpenAI has NO cache write cost. Cache write is
always $0. Prices are per 1M tokens:

```ts
const PRICING: Record<string, ModelPricing> = {
  "gpt-5.4-nano": {
    input: 0.20,
    cachedInput: 0.02,
    cacheWrite: 0,
    output: 1.25,
  },
  "gpt-5.4-mini": {
    input: 0.75,
    cachedInput: 0.075,
    cacheWrite: 0,
    output: 4.50,
  },
  "gpt-5.4": {
    input: 2.50,
    cachedInput: 0.25,
    cacheWrite: 0,
    output: 15.00,
  },
};
const FALLBACK_MODEL = "gpt-5.4-mini";
```

**New `priceUsage` logic:**

```ts
const promptTokens     = usage?.prompt_tokens ?? 0;
const completionTokens = usage?.completion_tokens ?? 0;
const cachedTokens     = usage?.prompt_tokens_details?.cached_tokens ?? 0;
const freshInputTokens = promptTokens - cachedTokens;

const freshInputUsd  = (freshInputTokens / 1_000_000) * pricing.input;
const cachedInputUsd = (cachedTokens     / 1_000_000) * pricing.cachedInput;
const outputUsd      = (completionTokens / 1_000_000) * pricing.output;
```

Keep `CostBreakdown`, `TurnCost`, `buildTurnCost`, `combineBreakdowns`,
`formatUsd`, and `formatTokens` — just update the field names to match
the new shape. Map `inputTokens → freshInputTokens`, `cacheWriteTokens → 0`,
`cacheReadTokens → cachedTokens`, `outputTokens → completionTokens`.

---

## 4. services/concierge/router.ts

### 4a. Imports and client type

```diff
- import Anthropic from "@anthropic-ai/sdk";
+ import OpenAI from "openai";
```

Change `RouteOptions.client` type from `Anthropic` to `OpenAI`.

Remove the `Anthropic.Messages.Tool` type annotation from `ROUTE_TOOL`.

### 4b. Tool definition shape

Anthropic uses `input_schema`. OpenAI wraps everything in a `function` object:

```diff
- const ROUTE_TOOL: Anthropic.Messages.Tool = {
-   name: "route_query",
-   description: "...",
-   input_schema: {
-     type: "object",
-     properties: { ... },
-     required: [...]
-   }
- }

+ const ROUTE_TOOL = {
+   type: "function" as const,
+   function: {
+     name: "route_query",
+     description: "...",  // keep same description text
+     parameters: {
+       type: "object" as const,
+       properties: { ... },  // keep same properties
+       required: [...]       // keep same required list
+     }
+   }
+ }
```

### 4c. API call

Replace `client.messages.create` with `client.chat.completions.create`.
Move the system prompt into the messages array. Remove all `cache_control`
blocks — OpenAI caches automatically with no explicit control needed.

```diff
- const response = await client.messages.create({
-   model,
-   max_tokens: ROUTER_MAX_TOKENS,
-   tool_choice: { type: "tool", name: ROUTE_TOOL.name },
-   tools: [ROUTE_TOOL],
-   system: [{
-     type: "text",
-     text: `${ROUTER_SYSTEM_PROMPT}\n\n${opts.worldIndex}`,
-     cache_control: { type: "ephemeral", ttl: "1h" },
-   }],
-   messages: [{ role: "user", content: userMessage }],
- });

+ const response = await client.chat.completions.create({
+   model,
+   max_tokens: ROUTER_MAX_TOKENS,
+   tool_choice: { type: "function", function: { name: "route_query" } },
+   tools: [ROUTE_TOOL],
+   messages: [
+     { role: "system", content: `${ROUTER_SYSTEM_PROMPT}\n\n${opts.worldIndex}` },
+     { role: "user",   content: userMessage },
+   ],
+ });
```

### 4d. Result parsing — CRITICAL GOTCHA

**Anthropic returns tool input as a pre-parsed object. OpenAI returns it
as a JSON string. You MUST call `JSON.parse()` on it.**

```diff
- const toolUse = response.content.find(
-   (block): block is Anthropic.Messages.ToolUseBlock =>
-     block.type === "tool_use" && block.name === ROUTE_TOOL.name
- );
- const args = (toolUse.input || {}) as Partial<{ ... }>;

+ const toolCall = response.choices[0]?.message?.tool_calls?.[0];
+ const args = toolCall
+   ? (JSON.parse(toolCall.function.arguments) as Partial<{ ... }>)
+   : {};
```

### 4e. Usage extraction

```diff
- const usage = (response.usage as unknown as RawUsage) || null;

+ const usage: RawUsage | null = response.usage
+   ? {
+       prompt_tokens: response.usage.prompt_tokens,
+       completion_tokens: response.usage.completion_tokens,
+       prompt_tokens_details: {
+         cached_tokens: (response.usage as any).prompt_tokens_details?.cached_tokens,
+       },
+     }
+   : null;
```

---

## 5. services/concierge/concierge.ts

### 5a. Imports and client type

```diff
- import Anthropic from "@anthropic-ai/sdk";
+ import OpenAI from "openai";
```

Change all `Anthropic` type references to `OpenAI` equivalents.
Update the env var names:

```diff
- const DEFAULT_MODEL = process.env.EXPO_PUBLIC_CLAUDE_MODEL || "claude-haiku-4-5";
+ const DEFAULT_MODEL = process.env.EXPO_PUBLIC_OPENAI_MODEL || "gpt-5.4-mini";
```

```diff
- const apiKey = opts.apiKey || process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
- this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, fetch: expoFetch as unknown as typeof fetch });
+ const apiKey = opts.apiKey || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
+ this.client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true, fetch: expoFetch as unknown as typeof fetch });
```

Update `RouteOptions` client type passed to `routeQuery`:

```diff
- const routeResult = await routeQuery(userMessage, { client: this.client, worldIndex: this.worldIndex });
+ const routeResult = await routeQuery(userMessage, { client: this.client as any, worldIndex: this.worldIndex });
```

### 5b. Message building — remove all cache_control

OpenAI does not use content block arrays or `cache_control`. Simplify
history messages to plain `{ role, content: string }` pairs.

Replace the history-building loop:

```diff
- for (let i = 0; i < priorHistory.length; i++) {
-   const m = priorHistory[i];
-   const isLastPrior = i === priorHistory.length - 1;
-   if (isLastPrior) {
-     messages.push({
-       role: m.role,
-       content: [{ type: "text", text: m.content, cache_control: CACHE_CONTROL }],
-     });
-   } else {
-     messages.push({ role: m.role, content: m.content });
-   }
- }

+ for (const m of priorHistory) {
+   messages.push({ role: m.role, content: m.content });
+ }
```

Remove the `CACHE_CONTROL` constant entirely.

### 5c. API call in `ask()`

```diff
- const response = await this.client.messages.create({
-   model: this.model,
-   max_tokens: MAX_TOKENS,
-   system: [{
-     type: "text",
-     text: buildSystemPrompt(this.worldIndex),
-     cache_control: CACHE_CONTROL,
-   }],
-   messages,
- });

+ const response = await this.client.chat.completions.create({
+   model: this.model,
+   max_tokens: MAX_TOKENS,
+   messages: [
+     { role: "system", content: buildSystemPrompt(this.worldIndex) },
+     ...messages,
+   ],
+ });
```

### 5d. Response parsing in `ask()`

```diff
- const rawReply = response.content
-   .filter((b) => b.type === "text")
-   .map((b) => (b as { type: "text"; text: string }).text)
-   .join("\n")
-   .trim();

+ const rawReply = (response.choices[0]?.message?.content ?? "").trim();
```

```diff
- const reply = response.stop_reason === "max_tokens"
+ const reply = response.choices[0]?.finish_reason === "length"
    ? trimToCompleteSentence(rawReply)
    : rawReply;
```

### 5e. Usage extraction in `ask()`

```diff
- { label: "Response (reply)", usage: response.usage as unknown as RawUsage, model: this.model }
+ { label: "Response (reply)", usage: {
+     prompt_tokens: response.usage?.prompt_tokens,
+     completion_tokens: response.usage?.completion_tokens,
+     prompt_tokens_details: { cached_tokens: (response.usage as any)?.prompt_tokens_details?.cached_tokens },
+   }, model: this.model }
```

### 5f. Streaming in `askStream()`

OpenAI's streaming API uses different method names and event types:

```diff
- const stream = this.client.messages.stream({
-   model: this.model,
-   max_tokens: MAX_TOKENS,
-   system: [{ type: "text", text: buildSystemPrompt(this.worldIndex), cache_control: CACHE_CONTROL }],
-   messages,
- });
- stream.on("text", (textDelta: string) => { ... });
- const finalMessage = await stream.finalMessage();

+ const stream = this.client.chat.completions.stream({
+   model: this.model,
+   max_tokens: MAX_TOKENS,
+   messages: [
+     { role: "system", content: buildSystemPrompt(this.worldIndex) },
+     ...messages,
+   ],
+ });
+ stream.on("content", (delta: string) => {
+   try { onDelta(delta); } catch (err) {
+     if (__DEV__) console.warn("[concierge] onDelta threw:", err);
+   }
+ });
+ const finalMessage = await stream.finalChatCompletion();
```

Parse the final streamed message:

```diff
- const rawReply = finalMessage.content
-   .filter((b) => b.type === "text")
-   .map((b) => (b as { type: "text"; text: string }).text)
-   .join("\n")
-   .trim();

+ const rawReply = (finalMessage.choices[0]?.message?.content ?? "").trim();
```

```diff
- finalMessage.stop_reason === "max_tokens"
+ finalMessage.choices[0]?.finish_reason === "length"
```

Apply the same usage extraction pattern as in `ask()` to the
`askStream()` cost block.

---

## Router model env var

In `router.ts`, update the default model env var:

```diff
- const ROUTER_MODEL = process.env.EXPO_PUBLIC_CLAUDE_ROUTER_MODEL || "claude-haiku-4-5";
+ const ROUTER_MODEL = process.env.EXPO_PUBLIC_OPENAI_ROUTER_MODEL || "gpt-5.4-mini";
```

---

## TypeScript strictness

- Avoid `any` where possible. Use OpenAI SDK types where they exist.
- The `prompt_tokens_details` field may not be in older SDK type
  definitions — cast `response.usage as any` only for that field.
- Keep all existing interfaces (`ChatMessage`, `AskResult`, `RouteDecision`,
  `TurnCost`, etc.) unchanged — the UI layer depends on these.
- `trimToCompleteSentence`, `isExplicitlyClosedOn`, `pickFallbackSampler`,
  and `getConcierge` are pure logic — do not touch them.

---

## Verification checklist

After making all changes:

1. Run `npx tsc --noEmit` — zero type errors expected.
2. Confirm `EXPO_PUBLIC_ANTHROPIC_API_KEY` no longer appears anywhere
   in `services/concierge/`.
3. Confirm `cache_control` no longer appears anywhere in
   `services/concierge/`.
4. Confirm `toolUse.input` no longer appears — should be replaced with
   `JSON.parse(toolCall.function.arguments)`.
5. Confirm `response.content` (Anthropic array shape) no longer appears
   — should be `response.choices[0].message.content`.
6. Confirm `stop_reason` no longer appears — should be `finish_reason`.
7. Confirm `input_schema` no longer appears in the tool definition —
   should be `parameters` inside a `function` wrapper.
