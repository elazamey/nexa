#!/usr/bin/env node
/** No HTTP, daemon, shell execution, automatic patching or model promotion. */
import { initializeCollection, loadCollection, readBounded, recordResult, registerPlan, reviewResult } from './celia-learning-store.mjs';
import { rankPlans, trainCandidate } from '../packages/cells/celia/learning/index.js';
import { fetchResearch } from './celia-learning-research.mjs';

const usage = `Celia learning — advisory-only, local operator CLI
  init     --state <existing-empty-0700-directory-outside-repository>
  plan     --state <directory> --input <plan.json>
  result   --state <directory> --input <result.json>
  review   --state <directory> --input <review.json>
  status   --state <directory>
  train    --state <directory> --family <ml|dl>   (candidate JSON to stdout)
  rank     --model <candidate.json> --input <plans.json>
  research --query "software repair"           (arXiv metadata to stdout)
No examples are fabricated; unreviewed results never enter training.
See docs/celia-adaptive-learning.ar.md for schemas, assumptions and limitations.`;
const definitions = { init: ['state'], plan: ['state', 'input'], result: ['state', 'input'], review: ['state', 'input'], status: ['state'], train: ['state', 'family'], rank: ['model', 'input'], research: ['query'] };
try {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === '--help') { console.log(usage); }
  else {
    if (!definitions[command] || argv.length !== definitions[command].length * 2) throw new Error('INVALID_COMMAND_ARGUMENTS');
    const args = {};
    for (let i = 0; i < argv.length; i += 2) {
      const key = argv[i].replace(/^--/, '');
      if (!argv[i].startsWith('--') || !definitions[command].includes(key) || Object.hasOwn(args, key) || !argv[i + 1]) throw new Error('INVALID_COMMAND_ARGUMENTS');
      args[key] = argv[i + 1];
    }
    const input = args.input ? JSON.parse(readBounded(args.input)) : undefined;
    let result;
    if (command === 'init') result = initializeCollection(args.state);
    if (command === 'plan') result = registerPlan(args.state, input);
    if (command === 'result') result = recordResult(args.state, input);
    if (command === 'review') result = reviewResult(args.state, input);
    if (command === 'status') result = loadCollection(args.state).status;
    if (command === 'train') result = trainCandidate(loadCollection(args.state).rows, { family: args.family });
    if (command === 'rank') result = rankPlans(JSON.parse(readBounded(args.model, 256 * 1024)), input);
    if (command === 'research') result = await fetchResearch(args.query);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, executionAllowed: false }));
  process.exitCode = 1;
}
