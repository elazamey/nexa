#!/usr/bin/env node
/** Trusted-local, bounded read-only IO. No child processes or writable collection ports. */
import { advise, verifyAdvisoryReport, systemStatus, componentCatalog, planFingerprint, SYSTEM_LIMITS, researchLibrary, skillLibrary } from '../packages/cells/celia/system/index.js';
import { trainCandidate } from '../packages/cells/celia/learning/index.js';
import { readBounded, loadCollection } from './celia-learning-store.mjs';
import { fetchResearch } from './celia-learning-research.mjs';

const usage = `Celia/NEXA — unified advisory-only system
  status      [--state <existing-collection>]
  catalog
  library     (curated references and advisory skill cards; offline)
  skills      [--id <SK01..SK10>]
  fingerprint --input <plan.json>
  advise      --input <request.json> [--state <existing-collection>] [--model <candidate.json>]
  verify      --input <report.json> --expect-reporter <independently-pinned-key-id>
  train       --state <existing-collection> --family <ml|dl>
  research    --query "software repair"
JSON to stdout. No writes, patches, COMMIT, model activation or automatic collection.
train is explicit offline computation; research is explicit read-only network access.
Signatures establish report integrity, not imported test execution or permission.
See docs/celia-system.ar.md for contracts, limitations and operator instructions.`;
const commands = {
  status: { required: [], optional: ['state'] }, catalog: { required: [], optional: [] },
  library: { required: [], optional: [] }, skills: { required: [], optional: ['id'] },
  fingerprint: { required: ['input'], optional: [] },
  advise: { required: ['input'], optional: ['state', 'model'] },
  verify: { required: ['input', 'expect-reporter'], optional: [] },
  train: { required: ['state', 'family'], optional: [] }, research: { required: ['query'], optional: [] },
};
try {
  const [command = '--help', ...argv] = process.argv.slice(2);
  if (command === '--help' && argv.length === 0) console.log(usage);
  else {
    const definition = Object.hasOwn(commands, command) ? commands[command] : null;
    if (!definition || argv.length % 2) throw new Error('INVALID_COMMAND_ARGUMENTS');
    const args = Object.create(null);
    for (let i = 0; i < argv.length; i += 2) {
      const key = argv[i].startsWith('--') ? argv[i].slice(2) : '';
      if (![...definition.required, ...definition.optional].includes(key) || Object.hasOwn(args, key) || !argv[i + 1]) throw new Error('INVALID_COMMAND_ARGUMENTS');
      args[key] = argv[i + 1];
    }
    if (definition.required.some(key => !Object.hasOwn(args, key))) throw new Error('INVALID_COMMAND_ARGUMENTS');
    const readJSON = (path, limit) => JSON.parse(readBounded(path, limit));
    let result;
    if (command === 'status') result = { ...systemStatus(), learning: args.state ? loadCollection(args.state).status : { status: 'NOT_CONNECTED', samples: null, trained: false } };
    if (command === 'library') result = researchLibrary();
    if (command === 'skills') result = skillLibrary(args.id ?? null);
    if (command === 'catalog') result = { ...systemStatus(), entries: componentCatalog() };
    if (command === 'fingerprint') result = { planHash: planFingerprint(readJSON(args.input, 32768)), algorithm: 'sha256-canonical-celia-advisory-plan-v1' };
    if (command === 'advise') {
      const candidate = args.model ? readJSON(args.model, SYSTEM_LIMITS.modelBytes) : null;
      if (args.model && candidate === null) throw new Error('INVALID_CANDIDATE');
      result = advise(readJSON(args.input, SYSTEM_LIMITS.inputBytes), {
        observations: args.state ? loadCollection(args.state).rows : null, candidate,
      });
    }
    if (command === 'verify') result = verifyAdvisoryReport(readJSON(args.input, SYSTEM_LIMITS.reportBytes), { expectedReporter: args['expect-reporter'] });
    if (command === 'train') result = trainCandidate(loadCollection(args.state).rows, { family: args.family });
    if (command === 'research') result = { advisoryOnly: true, executionAllowed: false, ...await fetchResearch(args.query), automaticIngestion: false };
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, executionAllowed: false, error: error.code ?? error.message }));
  process.exitCode = 1;
}
