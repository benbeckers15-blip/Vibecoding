/**
 * cli.js — Interactive REPL for the concierge.
 *
 *   npm run chat
 *
 * Type a question, hit Enter, read the reply. Multi-turn — history is kept
 * for the session. Commands:
 *   /reset   clear conversation history
 *   /usage   show last-turn token usage
 *   /quit    exit
 *
 * Input is blocked while a request is in flight so commands like /usage
 * can't fire before the previous reply lands.
 */

const readline = require('readline');
const { Concierge } = require('./concierge');
const { shutdown } = require('./firestore');

const PROMPT = '\nYou › ';

function fmtUsage(u) {
  if (!u) return '(no usage)';
  return [
    `input=${u.input_tokens}`,
    `output=${u.output_tokens}`,
    u.cache_creation_input_tokens ? `cache_write=${u.cache_creation_input_tokens}` : null,
    u.cache_read_input_tokens ? `cache_read=${u.cache_read_input_tokens}` : null,
  ].filter(Boolean).join(' ');
}

// Tiny spinner — gives visual feedback that we're waiting on Claude.
function startSpinner(label) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  process.stdout.write('\n');
  const id = setInterval(() => {
    process.stdout.write(`\r${frames[i = (i + 1) % frames.length]} ${label}   `);
  }, 80);
  return () => {
    clearInterval(id);
    // wipe the spinner line
    process.stdout.write('\r' + ' '.repeat(label.length + 6) + '\r');
  };
}

async function main() {
  const c = new Concierge();
  console.log('Loading Tasmanian winery dataset…');
  try {
    await c.init();
  } catch (err) {
    console.error('Failed to start concierge:', err.message);
    process.exit(1);
  }
  console.log(`Ready. ${c.wineries.length} wineries loaded. Model: ${c.model}`);
  console.log('Type /quit to exit, /reset to clear history, /usage for token info.\n');

  let lastUsage = null;
  let busy = false;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt(PROMPT);
  rl.prompt();

  rl.on('line', async (line) => {
    const q = line.trim();

    // Drop input while a request is in flight rather than queueing it up.
    if (busy) {
      console.log('(still thinking — wait for the reply before sending the next message)');
      return;
    }

    if (!q) { rl.prompt(); return; }

    if (q === '/quit' || q === '/exit') { rl.close(); return; }
    if (q === '/reset') { c.reset(); console.log('(history cleared)'); rl.prompt(); return; }
    if (q === '/usage') { console.log('[usage]', fmtUsage(lastUsage)); rl.prompt(); return; }

    busy = true;
    rl.pause();
    const stopSpinner = startSpinner('thinking');
    try {
      const { reply, usage } = await c.ask(q);
      stopSpinner();
      lastUsage = usage;
      console.log('Sommelier › ' + reply);
      console.error(`[usage] ${fmtUsage(usage)}`);
    } catch (err) {
      stopSpinner();
      console.error('\nError: ' + err.message);
      if (err.status) console.error('  status: ' + err.status);
      if (err.error && err.error.error && err.error.error.message) {
        console.error('  detail: ' + err.error.error.message);
      }
    } finally {
      busy = false;
      rl.resume();
      rl.prompt();
    }
  });

  rl.on('close', async () => {
    console.log('\nGoodbye.');
    await shutdown();
    process.exit(0);
  });
}

main();
