/**
 * concierge.js — The core function. Pure logic, no UI.
 *
 *   const { Concierge } = require('./concierge');
 *   const c = new Concierge();
 *   await c.init();                        // loads winery context once
 *   const { reply } = await c.ask('I have one day in Hobart, what do I do?');
 *   const reply2 = await c.ask('Make it less stuffy.');  // remembers history
 *
 * Notes:
 *   - History lives in memory on the instance. Spin up one Concierge per
 *     user session, or call `c.reset()` to start over.
 *   - Winery dataset is shipped as a cached system block, so the first
 *     query pays full input rate (~$0.04 with Sonnet 4.6 on ~73 wineries)
 *     and every subsequent query in the same hour pays the cached rate
 *     (~$0.02 including the response). Cache TTL is 1 hour.
 *   - Spatial reasoning (distance, drive time, direction, proximity) goes
 *     through Google Maps via tool calls — the model is forbidden from
 *     guessing. See src/tools.js and src/maps.js.
 */

// Load this asset's .env first, then fall back to the project-root .env so
// keys the rest of the app already uses (GOOGLE_MAPS_API_KEY, etc.) are
// picked up without duplication.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const Anthropic = require('@anthropic-ai/sdk');
const { loadContext } = require('./build-context');
const { buildSystemPrompt } = require('./system-prompt');
const { TOOLS, handleToolUse } = require('./tools');
const maps = require('./maps');

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 1200;       // ~enough for a 3-paragraph itinerary
const MAX_HISTORY_TURNS = 12;  // keep the rolling window manageable
const MAX_TOOL_ROUNDS = 6;     // hard cap on tool-use iterations per ask()

class Concierge {
  constructor(opts = {}) {
    this.model = opts.model || DEFAULT_MODEL;
    this.client = new Anthropic({ apiKey: opts.apiKey || process.env.ANTHROPIC_API_KEY });
    this.history = [];
    this.contextText = null;
    this.wineries = null;
    this._initialized = false;
  }

  /**
   * Fetch the winery dataset and prepare the cached system block.
   * Also hands the dataset to the maps module so spatial tools can resolve
   * winery slugs locally without a Firestore round-trip.
   */
  async init() {
    if (this._initialized) return;
    if (!this.client.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env.');
    }
    const { wineries, text } = await loadContext();
    this.wineries = wineries;
    this.contextText = text;
    maps.attachWineries(wineries);
    this._initialized = true;
  }

  /**
   * Send a user message. Returns the assistant's final reply text after any
   * intermediate tool-use rounds have completed.
   */
  async ask(userMessage) {
    if (!this._initialized) {
      throw new Error('Concierge not initialized — call await c.init() first.');
    }

    this.history.push({ role: 'user', content: userMessage });
    this._trimHistory();

    let aggregateUsage = null;
    let lastStopReason = null;
    let toolCallCount = 0;

    // Tool-use loop. The model may request one or more tool calls; we run
    // them, append a `user` message with the tool_results, and re-call.
    // We stop when the model returns a non-tool response or hits the cap.
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        tools: TOOLS,
        system: [
          // Block 1: brand voice + rules. Stable across requests, so cache it.
          {
            type: 'text',
            text: buildSystemPrompt(),
            cache_control: { type: 'ephemeral' },
          },
          // Block 2: winery dataset. Also stable (until you re-init). Cache it
          // separately so a system-prompt edit doesn't invalidate the dataset.
          {
            type: 'text',
            text: this.contextText,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: this.history,
      });

      aggregateUsage = mergeUsage(aggregateUsage, response.usage);
      lastStopReason = response.stop_reason;

      // Always append the assistant's response (text + tool_use blocks) to
      // history so subsequent tool_result messages reference valid IDs.
      this.history.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        // Final answer. Extract text and return.
        const reply = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim();
        return { reply, usage: aggregateUsage, stopReason: lastStopReason, toolCallCount };
      }

      // Run every tool_use block in this response in parallel.
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      toolCallCount += toolUseBlocks.length;
      const toolResults = await Promise.all(toolUseBlocks.map(handleToolUse));

      // Tool results come back as a single user-turn message containing one
      // tool_result block per tool_use block.
      this.history.push({ role: 'user', content: toolResults });
    }

    // Hit the tool-round cap — return whatever text we have plus a note.
    const lastAssistant = [...this.history].reverse().find(m => m.role === 'assistant');
    const reply = (Array.isArray(lastAssistant?.content) ? lastAssistant.content : [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim() || '(no reply — tool-use loop hit its iteration cap)';
    return { reply, usage: aggregateUsage, stopReason: lastStopReason, toolCallCount, capped: true };
  }

  /** Clear the conversation. Winery context stays loaded. */
  reset() {
    this.history = [];
  }

  /** Keep the last N turns to stop history from growing unbounded. */
  _trimHistory() {
    const max = MAX_HISTORY_TURNS * 2; // user + assistant per turn
    if (this.history.length > max) {
      this.history = this.history.slice(-max);
    }
  }
}

/** Sum Anthropic usage fields across multiple round-trips in one ask(). */
function mergeUsage(a, b) {
  if (!a) return { ...b };
  const out = { ...a };
  for (const k of Object.keys(b || {})) {
    if (typeof b[k] === 'number') out[k] = (out[k] || 0) + b[k];
  }
  return out;
}

module.exports = { Concierge };
