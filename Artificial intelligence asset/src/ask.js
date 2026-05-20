/**
 * ask.js — One-shot CLI. Pass a question on the command line, get one reply.
 *
 *   npm run ask -- "I'm in Hobart for one day. Where should I go?"
 *
 * Useful for quick sanity checks and for piping into other tools.
 */

const { Concierge } = require('./concierge');
const { shutdown } = require('./firestore');

async function main() {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    console.error('Usage: npm run ask -- "your question here"');
    process.exit(1);
  }

  const c = new Concierge();
  try {
    await c.init();
    const { reply, usage } = await c.ask(question);
    console.log('\n' + reply + '\n');
    if (usage) {
      const { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } = usage;
      console.error(
        `[usage] input=${input_tokens} output=${output_tokens}` +
        (cache_creation_input_tokens ? ` cache_write=${cache_creation_input_tokens}` : '') +
        (cache_read_input_tokens ? ` cache_read=${cache_read_input_tokens}` : '')
      );
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

main();
