#!/usr/bin/env node
// scripts/rag/query.js
// Quick CLI to test the retrieval pipeline without spinning up the app.
//
// USAGE
//   node --env-file=.env scripts/rag/query.js "best pinot noir in tamar valley"
//   node --env-file=.env scripts/rag/query.js "things to do in autumn" --topK 3
//   node --env-file=.env scripts/rag/query.js "harvest events" \
//     --filter "regions CONTAINS 'tamar_valley'"
'use strict';

const { retrieveContext } = require('./retrieve');

(async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0].startsWith('--')) {
    console.error('Usage: node --env-file=.env scripts/rag/query.js "your question"');
    process.exit(1);
  }

  const query = argv[0];
  let topK = 6;
  let filter;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--topK') topK = parseInt(argv[++i], 10);
    else if (argv[i] === '--filter') filter = argv[++i];
  }

  console.log(`\nQuery: ${query}`);
  if (filter) console.log(`Filter: ${filter}`);
  console.log(`topK:  ${topK}\n`);

  const t0 = Date.now();
  const chunks = await retrieveContext({ query, topK, filter });
  const ms = Date.now() - t0;

  if (!chunks.length) {
    console.log(`(no hits in ${ms}ms)`);
    return;
  }

  console.log(`Got ${chunks.length} hit(s) in ${ms}ms:\n`);
  for (const c of chunks) {
    console.log(`─── ${c.score.toFixed(3)}  ${c.id}  type=${c.type}  regions=[${c.regions.join(',')}]`);
    console.log(`    ${c.sourcePath}${c.headingPath.length ? ' › ' + c.headingPath.join(' › ') : ''}`);
    console.log(`    ${c.text.replace(/\s+/g, ' ').slice(0, 220)}…\n`);
  }
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
