#!/usr/bin/env node
/**
 * celia verify-run — run real tests and sign the outcome as COMMIT evidence.
 *
 *   node tools/celia-verify-run.mjs \
 *     --key ./verifier.seed            (32-byte hex seed; the verifier identity)
 *     --subject nexa:key:ed25519:z6Mk… (the principal that will send the COMMIT)
 *     --descriptor ./descriptor.json   (output of inspectWorkspaceCommit)
 *     --test tests/a.test.js [--test tests/b.test.js …]
 *     [--out ./evidence.json]          (default: stdout)
 *
 * Exit code: 0 when evidence was produced (ALLOW or DENY); 2 on usage error.
 * A failing test run is NOT an error of this tool — it is DENY evidence.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadVerifierKey, validateDescriptor, verifyRun } from './celia-verify-runner.mjs';

const usage = `usage: celia-verify-run --key <seedfile> --subject <kid> --descriptor <json> --test <file> [--test <file>…] [--out <file>]`;

function parse(argv) {
  const options = { test: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.startsWith('--') ? argv[i].slice(2) : null;
    const value = argv[i + 1];
    if (!key || value === undefined || !['key', 'subject', 'descriptor', 'test', 'out'].includes(key)) throw new Error(usage);
    if (key === 'test') options.test.push(value); else options[key] = value;
  }
  if (!options.key || !options.subject || !options.descriptor || options.test.length === 0) throw new Error(usage);
  return options;
}

let options;
try { options = parse(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }

const keys = loadVerifierKey(options.key);
const descriptor = validateDescriptor(JSON.parse(readFileSync(options.descriptor, 'utf8')));
const evidence = verifyRun({ verifier: { keys, kid: keys.kid }, subject: options.subject, descriptor, files: options.test });
const output = JSON.stringify({ source: evidence.source, records: evidence.records }, null, 2);
if (options.out) writeFileSync(options.out, output + '\n', { mode: 0o600 }); else process.stdout.write(output + '\n');
const { summary } = evidence.run;
console.error(`verify-run: ${evidence.verdict} by ${keys.kid} (${summary.files} files, ${summary.pass} pass / ${summary.fail} fail / ${summary.cancelled} cancelled)`);
for (const reason of evidence.records[1].detail.reasons ?? []) console.error(`  - ${reason}`);
