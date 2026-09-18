#!/usr/bin/env node
/**
 * `nexa` — the NEXA Ω command-line shell.
 *
 * This file is the *only* part of Ω that touches a filesystem or a terminal. Everything
 * it does is: read a file, call a pure package, print the result, set an exit code. The
 * authority stays where it belongs — with the operator identity, the grants and the
 * kernel.
 *
 *   node tools/nexa.mjs check    examples/omega/repository-review.nexa
 *   node tools/nexa.mjs explain  examples/omega/repository-review.nexa
 *   node tools/nexa.mjs run      examples/omega/repository-review.nexa --mission review
 *   node tools/nexa.mjs gate     candidate.json --parent parent.json --checks checks.json
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile, OMEGA_IR_VERSION } from '../packages/compiler/index.js';
import { NEXA_VERSION } from '../packages/ast/index.js';
import { GATE_NAMES } from '../packages/policy/index.js';
import { createIdentity } from '../packages/identity/index.js';
import { Vault, World, openSession, verifyOmegaChain } from '../packages/runtime/index.js';
import { CircuitBreaker } from '../packages/runtime/index.js';
import { evaluateGate, describeVerdict } from '../packages/evolution/index.js';
import { plan } from '../packages/cli/index.js';
import { renderCheck, renderCompile, renderExplain, renderRun, renderGate, renderVersion } from '../packages/cli/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The shell's operator identity is fixed so that a printed transcript is reproducible. */
const OPERATOR = createIdentity({ label: 'omega-operator', seed: '11'.repeat(32) });
const CLOCK = () => new Date('2026-09-18T12:00:00Z');

/** @param {string} path @returns {string} */
function read(path) {
  return readFileSync(path, 'utf8');
}

/**
 * The demo vault. The material below is a *test fixture* in the host, never in a module:
 * a `.nexa` file can only name a handle, and the CLI is the thing that supplies the
 * value, exactly as a real deployment's secret manager would.
 */
const DEMO_VAULT = new Vault({ secrets: { gemini: 'AIza-demo-not-a-real-key' } });

/** The host a `run` gets: a small, deterministic world and an echo handler for `tool:*`. */
function hostFor(ir) {
  const worldKeys = new Set();
  for (const mission of ir.missions) {
    for (const statement of mission.statements) {
      if (statement.kind === 'Observe') worldKeys.add(statement.key);
    }
  }
  const state = {};
  for (const key of worldKeys) state[key] = { key, host: basename(root), mode: 'demo' };
  const instruments = [];
  for (const instrument of ir.instruments) {
    if (!instrument.resource.startsWith('tool:')) continue;
    instruments.push({
      resource: instrument.resource,
      actions: instrument.actions,
      handler: ({ args }) => ({ ok: true, echoed: args }),
    });
  }
  return {
    world: new World({ state }),
    instruments,
    breaker: new CircuitBreaker({ clock: CLOCK, threshold: 3 }),
  };
}

/** @param {string} path @returns {{ok: boolean, compiled: object}} */
function compileFile(path) {
  const compiled = compile(read(path), { path });
  return { compiled, ok: compiled.ok };
}

function fail(message, usage) {
  process.stderr.write(`nexa: ${message}\n`);
  if (usage !== undefined) for (const line of usage) process.stderr.write(`  ${line}\n`);
  process.exitCode = 2;
}

function main() {
  const planned = plan(process.argv.slice(2));
  if (!planned.ok) return fail(planned.message, planned.usage);
  const { command, file, options } = planned;
  const json = options.json === true;

  if (command === 'version') {
    process.stdout.write(`${renderVersion({ omega: 1, ir: OMEGA_IR_VERSION, protocol: NEXA_VERSION, gates: `${GATE_NAMES.length} CLOSED` }, { json })}\n`);
    return undefined;
  }

  if (command === 'gate') {
    const candidate = JSON.parse(read(file));
    const parent = options.parent === undefined ? null : JSON.parse(read(options.parent));
    const checks = options.checks === undefined ? {} : JSON.parse(read(options.checks));
    const verdict = evaluateGate({ candidate, parent, checks });
    process.stdout.write(`${json ? renderGate(verdict, { json }) : `${renderGate(verdict, { json })}\n  summary: ${describeVerdict(verdict)}`}\n`);
    process.exitCode = verdict.verdict === 'PASS' ? 0 : 1;
    return undefined;
  }

  const { compiled, ok } = compileFile(file);
  if (command === 'check') {
    process.stdout.write(`${renderCheck(compiled, { path: file, json })}\n`);
    if (!ok) process.exitCode = 1;
    return undefined;
  }
  if (!ok) {
    process.stdout.write(`${renderCheck(compiled, { path: file })}\n`);
    process.exitCode = 1;
    return undefined;
  }
  if (command === 'compile') {
    process.stdout.write(`${renderCompile(compiled, { path: file, json })}\n`);
    return undefined;
  }
  if (command === 'explain') {
    process.stdout.write(`${renderExplain(compiled.explanation, { path: file, json })}\n`);
    return undefined;
  }
  if (command === 'run') {
    const host = hostFor(compiled.ir);
    const session = openSession({
      compiled,
      operator: OPERATOR,
      clock: CLOCK,
      world: host.world,
      instruments: host.instruments,
      breaker: host.breaker,
      vault: DEMO_VAULT,
      approvals: options.approve === true ? { '*': true } : {},
    });
    const outcome = session.runtime.run(options.mission);
    const chain = verifyOmegaChain(outcome.records, { expectActor: session.kernel.agent(outcome.agent).kid });
    process.stdout.write(`${renderRun(outcome, { json })}\n`);
    if (!chain.ok) {
      process.stderr.write(`nexa: the Ω transcript does not verify: ${chain.reason}\n`);
      process.exitCode = 1;
      return undefined;
    }
    if (outcome.status !== 'ALLOW') process.exitCode = 1;
    return undefined;
  }
  return fail(`command ${command} is planned but not implemented here`);
}

main();
