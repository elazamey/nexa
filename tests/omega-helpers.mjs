/**
 * Ω test scaffolding.
 *
 * Deterministic like the v0.1 helpers: fixed seeds, fixed clock (`T0`), no network, no
 * filesystem beyond reading the examples. A run is reproducible, so a test needs nothing
 * but the module it compiles.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from '../packages/compiler/index.js';
import { createIdentity } from '../packages/identity/index.js';
import { CircuitBreaker, SelfHealer, Vault, World, openSession } from '../packages/runtime/index.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const T0 = new Date('2026-09-18T12:00:00Z');
export const clock = () => T0;

export const SEEDS = {
  operator: '11'.repeat(32),
  other: '22'.repeat(32),
  evolver: '44'.repeat(32),
  approver: '55'.repeat(32),
  outsider: '66'.repeat(32),
};

/** The demo vault: material lives in the host, never in a module. */
export const DEMO_SECRET = 'AIza-demo-not-a-real-key';
export const vault = () => new Vault({ secrets: { gemini: DEMO_SECRET } });

/** @param {string} name @returns {string} the source of `examples/omega/<name>` */
export function example(name) {
  return readFileSync(join(ROOT, 'examples/omega', name), 'utf8');
}

/** @param {string} name @returns {object} */
export function compileExample(name) {
  return compile(example(name), { path: `examples/omega/${name}` });
}

/** @param {string} source @param {string} [path] @returns {object} */
export function compileSource(source, path = 'tests/inline.nexa') {
  return compile(source, { path });
}

/** @returns {object} an operator identity, rebuilt per call so tests cannot share state */
export function operator() {
  return createIdentity({ label: 'omega-test-operator', seed: SEEDS.operator });
}

/** @returns {object} the demo host: a world with one project and an echoing tool */
export function host() {
  return {
    world: new World({ state: { project: { name: 'nexa', branch: 'main' } } }),
    instruments: [{ resource: 'tool:echo', handler: ({ args }) => ({ echoed: args }) }],
  };
}

/**
 * @param {object} compiled
 * @param {{world?: object, instruments?: object[], breaker?: object, healer?: object,
 *          operator?: object, vault?: object, approvals?: object, clock?: () => Date}} [overrides]
 * @returns {object} a session
 */
export function sessionFor(compiled, overrides = {}) {
  const {
    world = host().world,
    instruments = host().instruments,
    breaker = null,
    healer = null,
    operator: signer = operator(),
    vault: secrets = vault(),
    approvals = {},
    clock: now = clock,
  } = overrides;
  return openSession({
    compiled,
    operator: signer,
    clock: now,
    world,
    instruments,
    breaker: breaker ?? new CircuitBreaker({ clock: now, threshold: 3 }),
    ...(healer === null ? {} : { healer }),
    vault: secrets,
    approvals,
  });
}

/**
 * @param {string} name an example module
 * @param {string} mission
 * @param {object} [overrides]
 * @returns {{compiled: object, session: object, outcome: object}}
 */
export function runExample(name, mission, overrides = {}) {
  const compiled = compileExample(name);
  const session = sessionFor(compiled, overrides);
  return { compiled, session, outcome: session.runtime.run(mission) };
}
