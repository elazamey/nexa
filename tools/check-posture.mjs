#!/usr/bin/env node
/**
 * CI gate: every hard gate must be CLOSED, and nothing behind one may be exposed.
 *
 * This is deliberately a Node program rather than shell one-liners: an earlier CI
 * step piped `npm run report:json` into a file, and npm's banner turned the file
 * into invalid JSON. A step that fails for its own reasons is worse than no step,
 * because it hides the real signal.
 *
 *   node tools/check-posture.mjs
 */
import { buildReport } from './gate-report.mjs';
import { GATED_ACTIONS, GATED_RESOURCES } from '../packages/policy/index.js';
import { MESSAGE_TYPES } from '../packages/ast/index.js';
import { EVIDENCE_KINDS } from '../packages/evidence/index.js';

// Piping into `head` closes stdout early; that is not an error worth a stack trace.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const report = buildReport();
const failures = [];

// 1. every gate closed
for (const gate of report.posture.gates) {
  if (gate.state !== 'CLOSED') failures.push(`gate ${gate.name} is ${gate.state}`);
}
if (report.posture.gates.length !== 6) {
  failures.push(`expected 6 gates, found ${report.posture.gates.length}`);
}

// 2. the gate tables are non-empty and cover the documented namespaces
if (Object.keys(GATED_RESOURCES).length < 10) failures.push('gated resource table looks incomplete');
if (Object.keys(GATED_ACTIONS).length < 10) failures.push('gated action table looks incomplete');

// 3. the protocol surface is the documented one
if (MESSAGE_TYPES.length !== 8) failures.push('envelope type list changed unexpectedly');
if (EVIDENCE_KINDS.length !== 10) failures.push('evidence kind list changed unexpectedly');

// 4. nothing in the protocol packages or adapters may import an execution or
//    filesystem API. The gate tables are allowed to *name* `spawn`/`exec`/`write`
//    — that is how they refuse them — so the check looks for real usage:
//    module imports and the synchronous `*Sync`/stream APIs, not bare words.
const FORBIDDEN = [
  /from\s+['"]node:child_process['"]/,
  /from\s+['"]child_process['"]/,
  /from\s+['"]node:fs['"]/,
  /from\s+['"]node:fs\/promises['"]/,
  /\b(spawnSync|execSync|execFileSync|exec)\s*\(/,
  /\b(writeFileSync|appendFileSync|unlinkSync|rmSync|mkdirSync|createWriteStream|createWriteStreamSync)\s*\(/,
  /\bprocess\.binding\b/,
];

const checks = [
  ['packages/policy/src/gates.js', /GATE_NAMES/, true],
  ['packages/policy/src/gates.js', /CLOSED/, true],
];

const { readFileSync, readdirSync, statSync } = await import('node:fs');
const { dirname, join, relative } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} directory @returns {string[]} every .js/.mjs file below it */
function walkSources(directory) {
  const out = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...walkSources(path));
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(path);
  }
  return out;
}

for (const [file, pattern, shouldMatch] of checks) {
  const source = readFileSync(join(root, file), 'utf8');
  const matched = pattern.test(source);
  if (!shouldMatch && matched) {
    failures.push(`${file} matches ${pattern} — a gate may have been opened`);
  }
  if (shouldMatch && !matched) {
    failures.push(`${file} no longer matches ${pattern}`);
  }
}

// Scan every protocol and adapter source file for forbidden API usage.
for (const area of ['packages', 'adapters']) {
  for (const file of walkSources(join(root, area))) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN) {
      if (pattern.test(source)) {
        failures.push(`${relative(root, file)} matches ${pattern} — ambient authority detected`);
      }
    }
  }
}

if (failures.length > 0) {
  process.stderr.write('posture check FAILED\n');
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`posture check OK: ${report.posture.gates.length} gates CLOSED, ` +
  `${Object.keys(GATED_RESOURCES).length} gated namespaces, ${Object.keys(GATED_ACTIONS).length} gated actions\n`);
