# SipLocal AI Concierge — Tasmania

The conversational sommelier for SipLocal, running headless. No UI — just a
module you can call from anywhere, plus two CLI entrypoints for testing.

## What's here

```
Artificial intelligence asset/
├── package.json
├── .env.example          ← copy to .env and fill in
├── .gitignore
├── README.md
└── src/
    ├── concierge.js      ← the main class. Import this from anywhere.
    ├── system-prompt.js  ← brand voice, rules, guardrails (edit me)
    ├── build-context.js  ← compacts the Firestore winery docs into a token-efficient block
    ├── firestore.js      ← thin firebase-admin wrapper
    ├── ask.js            ← one-shot CLI: `npm run ask -- "question"`
    └── cli.js            ← interactive REPL: `npm run chat`
```

## Setup (one-time)

From inside this folder:

```bash
npm install
cp .env.example .env
# then open .env and paste in your Anthropic API key
```

The Firebase service account at `../service-account-tasmania.json`
(the one your scripts/ folder already uses) is picked up automatically.

## Run

Interactive chat:

```bash
npm run chat
```

One-shot question:

```bash
npm run ask -- "I have one day from Hobart and love pinot. Plan it."
```

Inspect the compacted winery context (sanity-check what the model sees):

```bash
npm run build-context           # prints the cached block
npm run build-context -- --json # full JSON of every winery
```

## Use it from your own code

```js
const { Concierge } = require('./src/concierge');

const c = new Concierge();
await c.init();                                  // pulls Firestore once

const { reply, usage } = await c.ask('Saturday from Launceston, sparkling-focused day for two.');
console.log(reply);

await c.ask('Make it more low-key.');            // history is remembered
c.reset();                                       // clear history when a session ends
```

## Cost

With prompt caching enabled (which it is, by default):

- **First query in a session** — pays full input rate on the dataset (~73
  wineries × ~150 tokens = ~11K tokens). About **4-5 cents** with Sonnet
  4.6.
- **Subsequent queries within one hour** — pays the cached read rate (90%
  off). About **1 cent per query** with Sonnet 4.6.

Switch to Haiku 4.5 by setting `CLAUDE_MODEL=claude-haiku-4-5` in `.env`
to roughly third those costs.

## What it doesn't do (yet)

- No bookings, no inquiries, no outbound writes. Recommend-only.
- No streaming. Responses arrive as one block.
- No persistence — history lives in memory on the Concierge instance.
  Spin up one per session in whatever calls this.
- No translation, no voice. Plain text in, plain text out.

## Editing the personality

`src/system-prompt.js` is the single source of truth for tone, rules, and
style. The few-shot example near the bottom is the biggest lever — change
it to change the model's output cadence and shape.
