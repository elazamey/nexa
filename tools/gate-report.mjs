#!/usr/bin/env node
/**
 * Machine-readable posture report.
 *
 * Prints what is closed, what is exposed, and what the code contains — the things
 * a reviewer (or a CI job) should be able to check without reading prose. Text by
 * default, `--json` for machines.
 *
 *   node tools/gate-report.mjs [--json]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gatePosture, GATED_RESOURCES, GATED_ACTIONS } from '../packages/policy/index.js';
import { ERROR_CODES } from '../packages/ast/index.js';
import { MESSAGE_TYPES } from '../packages/ast/index.js';
import { EVIDENCE_KINDS, DECISIONS } from '../packages/evidence/index.js';
import { RPC_ERRORS } from '../adapters/mcp/index.js';
import { MAX_TTL_SECONDS, DEFAULT_TTL_SECONDS, MAX_BODY_BYTES } from '../packages/protocol/index.js';

// Piping into `head` closes stdout early; that is not an error worth a stack trace.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(directory) {
  const out = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) out.push(...walk(path));
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(path);
  }
  return out;
}

function moduleInventory() {
  const modules = {};
  for (const area of ['packages', 'adapters', 'tools', 'tests']) {
    const directory = join(root, area);
    let files = [];
    try {
      files = walk(directory);
    } catch {
      continue;
    }
    let lines = 0;
    for (const file of files) lines += readFileSync(file, 'utf8').split('\n').length;
    modules[area] = { files: files.length, lines };
  }
  return modules;
}

function vectorInventory() {
  const directory = join(root, 'spec', 'vectors');
  return readdirSync(directory).sort().map((name) => {
    const parsed = JSON.parse(readFileSync(join(directory, name), 'utf8'));
      return {
        file: `spec/vectors/${name}`,
        sections: Object.keys(parsed).filter((key) => !['nexa', 'generated_by', 'note'].includes(key)),
      };
    });
  }

  function testInventory() {
    const directory = join(root, 'tests');
    return readdirSync(directory)
      .filter((name) => name.endsWith('.test.js'))
      .sort()
      .map((name) => {
        const source = readFileSync(join(directory, name), 'utf8');
        const tests = source.match(/^test\(/gm) ?? [];
        return { file: relative(root, join(directory, name)), tests: tests.length };
      });
  }

  /**
   * @returns {object} the full posture report (pure function of the tree it reads)
   */
  export function buildReport() {
    const gates = gatePosture();
    return {
    nexa: '0.1',
    posture: {
      gates,
      all_closed: gates.every((gate) => gate.state === 'CLOSED'),
      gated_resource_namespaces: Object.keys(GATED_RESOURCES).sort(),
      gated_actions: Object.keys(GATED_ACTIONS).sort(),
      effective_authority: 'capability ∩ policy ∩ (everything not gated)',
    },
    protocol: {
      envelope_types: MESSAGE_TYPES,
      default_ttl_seconds: DEFAULT_TTL_SECONDS,
      max_ttl_seconds: MAX_TTL_SECONDS,
      max_body_bytes: MAX_BODY_BYTES,
      error_codes: Object.keys(ERROR_CODES).length,
      rpc_error_codes: RPC_ERRORS,
      evidence_kinds: EVIDENCE_KINDS,
      decisions: DECISIONS,
    },
      inventory: {
        modules: moduleInventory(),
        vectors: vectorInventory(),
        tests: testInventory(),
      },
  };
}

const report = buildReport();
const gates = report.posture.gates;

// Importing this module must not print anything: `check-posture.mjs` imports it.
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === `file://${process.argv[1]}`;

if (!invokedDirectly) {
  // no-op: the caller will use `buildReport()`
} else if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const write = (text = '') => process.stdout.write(`${text}\n`);
  write(`NEXA v${report.nexa} posture report`);
  write('='.repeat(30));
  write();
  write('Closed gates');
  for (const gate of gates) write(`  ${gate.state.padEnd(6)} ${gate.name}`);
  write(`  decision: ${report.posture.all_closed ? 'ALL SIX CLOSED' : 'OPEN (regression!)'}`);
  write();
  write('Gated namespaces');
  write(`  resources: ${report.posture.gated_resource_namespaces.join(', ')}`);
  write(`  actions:   ${report.posture.gated_actions.join(', ')}`);
  write();
  write('Protocol surface');
  write(`  envelope types:    ${MESSAGE_TYPES.join(', ')}`);
  write(`  error codes:       ${report.protocol.error_codes}`);
  write(`  evidence kinds:    ${EVIDENCE_KINDS.length}`);
  write(`  envelope TTL:      default ${DEFAULT_TTL_SECONDS}s / max ${MAX_TTL_SECONDS}s`);
  write(`  max body size:     ${MAX_BODY_BYTES} bytes`);
  write();
  write('Inventory');
  for (const [area, stats] of Object.entries(report.inventory.modules)) {
    write(`  ${area.padEnd(10)} ${String(stats.files).padStart(3)} files / ${String(stats.lines).padStart(5)} lines`);
  }
  write(`  vectors    ${report.inventory.vectors.length} files: ${report.inventory.vectors.map((item) => item.file.replace('spec/vectors/', '')).join(', ')}`);
  const tests = report.inventory.tests.reduce((sum, item) => sum + item.tests, 0);
  write(`  tests      ${tests} tests in ${report.inventory.tests.length} files`);
  for (const item of report.inventory.tests) write(`               ${item.file.padEnd(30)} ${item.tests}`);
  write();
  write('Run `npm test` for the suite and `npm run demo` for the end-to-end flow.');
}
