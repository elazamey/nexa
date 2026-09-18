/**
 * The Evolution Gate and the version registry.
 *
 * Self-modifying is not self-authorizing: these tests pin the properties that make that
 * sentence true — a missing stage is a failure, authority is monotone, the kernel is not
 * evolvable, a forged manifest never reaches stage evaluation, and a version becomes
 * active only by an explicit call from an identity the registry was told to trust.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTACK_CATEGORIES,
  GATE_STAGES,
  KERNEL_MODULES,
  STAGE_DEFAULTS,
  VersionRegistry,
  capabilitiesOf,
  createManifest,
  describeVerdict,
  evaluateGate,
  signManifest,
} from '../packages/evolution/index.js';
import { createIdentity } from '../packages/identity/index.js';
import { OmegaLedger } from '../packages/runtime/index.js';
import { compileExample, SEEDS, T0 } from './omega-helpers.mjs';
import { runAttackSuite } from '../tools/omega-attacks.mjs';

const EVOLVER = createIdentity({ label: 'omega-test-evolver', seed: SEEDS.evolver });
const APPROVER = createIdentity({ label: 'omega-test-approver', seed: SEEDS.approver });
const OUTSIDER = createIdentity({ label: 'omega-test-outsider', seed: SEEDS.outsider });

const compiled = compileExample('evolution-proposal.nexa');
const source = 'nexa omega 1\n';
const attacks = runAttackSuite();

/** @param {object} [overrides] @returns {object} a signed manifest for planner@5 */
function manifest(overrides = {}) {
  const evolver = overrides.evolver ?? EVOLVER;
  return signManifest(createManifest({
    module: 'planner',
    version: 5,
    parent: 4,
    source,
    compiled,
    capabilities: capabilitiesOf(compiled.ir),
    expectations: compiled.ir.proposals[0].expects,
    evolver,
    created: T0,
    ...overrides,
  }), evolver);
}

/** @param {object} [overrides] @returns {object} planner@4, the parent */
function parentManifest(overrides = {}) {
  const evolver = overrides.evolver ?? EVOLVER;
  return signManifest(createManifest({
    module: 'planner',
    version: 4,
    source,
    compiled,
    capabilities: capabilitiesOf(compiled.ir),
    evolver,
    created: T0,
    ...overrides,
  }), evolver);
}

/** @param {object} [overrides] @returns {Record<string, object>} all stages passing */
function checks(overrides = {}) {
  return {
    compile: { status: 'PASS' },
    types: { status: 'PASS' },
    capabilities: { status: 'PASS' },
    security: { status: 'PASS' },
    adversarial: { status: 'PASS', detail: { attacks } },
    regression: { status: 'PASS' },
    benchmark: { status: 'PASS', detail: { measurements: { success_rate: 97, security_findings: 0 } } },
    policy: { status: 'PASS' },
    ...overrides,
  };
}

test('Ω/E1: the gate names eight stages and documents every one of them', () => {
  assert.deepEqual([...GATE_STAGES], ['compile', 'types', 'capabilities', 'security', 'adversarial', 'regression', 'benchmark', 'policy']);
  for (const stage of GATE_STAGES) {
    assert.equal(typeof STAGE_DEFAULTS[stage], 'string', `${stage} has no documented meaning`);
  }
  assert.equal(KERNEL_MODULES.length >= 6, true);
  for (const module of ['kernel', 'verifier', 'policy-engine', 'capability-authority']) {
    assert.ok(KERNEL_MODULES.includes(module), `${module} must be immutable`);
  }
});

test('Ω/E2: a complete candidate passes and goes to canary', () => {
  const verdict = evaluateGate({ candidate: manifest(), parent: parentManifest(), checks: checks(), evolvers: [EVOLVER.kid], now: T0 });
  assert.equal(verdict.verdict, 'PASS');
  assert.equal(verdict.action, 'CANARY');
  assert.equal(verdict.failed, null);
  assert.equal(verdict.stages.filter((stage) => stage.status === 'PASS').length, GATE_STAGES.length + 2, 'eight stages plus manifest and parent');
  assert.match(describeVerdict(verdict), /PASS \(10 stages\) → CANARY/);
});

test('Ω/E3: a missing stage is a failed stage', () => {
  for (const stage of GATE_STAGES) {
    const incomplete = checks();
    delete incomplete[stage];
    const verdict = evaluateGate({ candidate: manifest(), parent: parentManifest(), checks: incomplete, evolvers: [EVOLVER.kid], now: T0 });
    assert.equal(verdict.verdict, 'FAIL', `${stage} must be required`);
    assert.equal(verdict.failed, stage);
    assert.equal(verdict.action, 'QUARANTINE');
    assert.match(verdict.reason, /missing/);
  }
});

test('Ω/E4: authority is monotone — the gate checks it, and does not trust the report', () => {
  const widened = manifest({ capabilities: [...capabilitiesOf(compiled.ir), 'fs:*!write'] });
  const verdict = evaluateGate({ candidate: widened, parent: parentManifest(), checks: checks(), evolvers: [EVOLVER.kid], now: T0 });
  assert.equal(verdict.verdict, 'FAIL');
  assert.equal(verdict.failed, 'capabilities');
  assert.match(verdict.reason, /authority is monotone/);
  assert.deepEqual(verdict.stages.find((stage) => stage.stage === 'capabilities').detail.added, ['fs:*!write']);
});

test('Ω/E5: the kernel is refused before any stage is consulted', () => {
  // A kernel module cannot even be signed into a manifest.
  assert.throws(
    () => createManifest({ module: 'verifier', version: 5, source, compiled, capabilities: [], evolver: EVOLVER, created: T0 }),
    (error) => error.code === 'OMEGA_E_KERNEL_IMMUTABLE',
  );
  assert.throws(
    () => createManifest({ module: 'omega-kernel', version: 2, source, compiled, capabilities: [], evolver: EVOLVER, created: T0 }),
    (error) => error.code === 'OMEGA_E_KERNEL_IMMUTABLE',
  );

  // And a hand-built candidate object is refused before any stage is read.
  const forged = { ...manifest(), module: 'capability-authority' };
  const verdict = evaluateGate({ candidate: forged, parent: null, checks: checks(), evolvers: [EVOLVER.kid], now: T0 });
  assert.equal(verdict.verdict, 'REFUSED');
  assert.equal(verdict.code, 'OMEGA_E_KERNEL_IMMUTABLE');
  assert.equal(verdict.stages.length, 0, 'nothing is even evaluated');
  assert.equal(verdict.action, 'REFUSE');
});

test('Ω/E6: a forged or unauthorized manifest is refused, not quarantined', () => {
  const outsider = evaluateGate({ candidate: manifest({ evolver: OUTSIDER }), parent: null, checks: checks(), evolvers: [EVOLVER.kid], now: T0 });
  assert.equal(outsider.verdict, 'REFUSED');
  assert.equal(outsider.code, 'OMEGA_E_NOT_ACTIVATOR');
  assert.equal(outsider.action, 'REFUSE');

  const edited = evaluateGate({ candidate: { ...manifest(), version: 6 }, parent: null, checks: checks(), evolvers: [EVOLVER.kid], now: T0 });
  assert.equal(edited.verdict, 'REFUSED');
  assert.equal(edited.code, 'OMEGA_E_SIGNATURE');

  const unsigned = evaluateGate({ candidate: { ...manifest(), signature: null }, parent: null, checks: checks(), evolvers: [EVOLVER.kid], now: T0 });
  assert.equal(unsigned.verdict, 'REFUSED');
  assert.equal(unsigned.code, 'OMEGA_E_SIGNATURE');
});

test('Ω/E7: a candidate that names a parent is checked against that parent', () => {
  const missing = evaluateGate({ candidate: manifest(), parent: null, checks: checks(), evolvers: [EVOLVER.kid], now: T0 });
  assert.equal(missing.verdict, 'FAIL');
  assert.equal(missing.failed, 'parent');

  const wrongVersion = evaluateGate({ candidate: manifest(), parent: parentManifest({ version: 3 }), checks: checks(), now: T0 });
  assert.equal(wrongVersion.failed, 'parent');
  assert.match(wrongVersion.reason, /not the one the candidate names/);

  const backwards = evaluateGate({ candidate: manifest({ version: 4, parent: 4 }), parent: parentManifest(), checks: checks(), now: T0 });
  assert.equal(backwards.failed, 'parent');
  assert.match(backwards.reason, /versions only move forward/);
});

test('Ω/E8: declared expectations are checked against the measurements', () => {
  const unmet = evaluateGate({
    candidate: manifest(),
    parent: parentManifest(),
    checks: checks({ benchmark: { status: 'PASS', detail: { measurements: { success_rate: 91, security_findings: 0 } } } }),
    evolvers: [EVOLVER.kid],
    now: T0,
  });
  assert.equal(unmet.verdict, 'FAIL');
  assert.equal(unmet.failed, 'benchmark');
  assert.deepEqual(unmet.stages.find((stage) => stage.stage === 'benchmark').detail.unmet.map((entry) => entry.metric), ['success_rate']);
});

test('Ω/E9: the adversarial category list is complete, so a stage cannot skip an attack type', () => {
  // 11 since the cellular layer: making a cell out of a kernel module is its own attack class.
  assert.equal(ATTACK_CATEGORIES.length, 11);
  assert.equal([...new Set(attacks.map((attack) => attack.category))].sort().join(','), [...ATTACK_CATEGORIES].sort().join(','));
});

test('Ω/E10: the registry is immutable, attributed and reversible', () => {
  const registry = new VersionRegistry({
    versions: [{ module: 'planner', version: 4, active: true, manifest: parentManifest() }],
    activators: [APPROVER.kid],
    requiredObservations: 2,
  });
  registry.propose(manifest());
  assert.throws(() => registry.propose(manifest()), (error) => error.code === 'OMEGA_E_VERSION_DUPLICATE', 'versions are immutable');
  assert.equal(registry.state('planner@5').state, 'proposed');
  assert.equal(registry.history().find((entry) => entry.ref === 'planner@5').active, false);

  const verdict = registry.evaluate({ ref: 'planner@5', checks: checks(), now: T0 });
  assert.equal(verdict.verdict, 'PASS');
  assert.equal(registry.state('planner@5').state, 'canary');

  assert.throws(
    () => registry.activate({ ref: 'planner@5', by: APPROVER.kid, now: T0 }),
    (error) => error.code === 'OMEGA_E_CANARY_INCOMPLETE',
    'a canary window is not a formality',
  );
  assert.throws(() => registry.activate({ ref: 'planner@5', by: EVOLVER.kid, now: T0 }), (error) => error.code === 'OMEGA_E_NOT_ACTIVATOR');

  registry.observe({ ref: 'planner@5', sample: { success_rate: 97, security_findings: 0 } });
  registry.observe({ ref: 'planner@5', sample: { success_rate: 98, security_findings: 0 } });
  const activated = registry.activate({ ref: 'planner@5', by: APPROVER.kid, now: T0 });
  assert.equal(activated.previous, 'planner@4');
  assert.equal(registry.active('planner'), 'planner@5');
  assert.equal(registry.history().find((entry) => entry.ref === 'planner@4').active, false);
  assert.equal(registry.history().find((entry) => entry.ref === 'planner@5').active, true);

  const rolledBack = registry.rollback({ ref: 'planner@5', by: APPROVER.kid, reason: 'drift in canary', now: T0 });
  assert.equal(rolledBack.restored, 'planner@4');
  assert.equal(registry.active('planner'), 'planner@4');
  assert.equal(registry.state('planner@5').state, 'quarantined');
  assert.deepEqual(registry.history().map((entry) => entry.state), ['active', 'quarantined']);
});

test('Ω/E11: a canary observation that violates an expectation quarantines the candidate', () => {
  const registry = new VersionRegistry({
    versions: [{ module: 'planner', version: 4, active: true, manifest: parentManifest() }],
    activators: [APPROVER.kid],
    requiredObservations: 1,
  });
  registry.propose(manifest());
  registry.evaluate({ ref: 'planner@5', checks: checks(), now: T0 });
  const observation = registry.observe({ ref: 'planner@5', sample: { success_rate: 12, security_findings: 3 } });
  assert.equal(observation.clean, false);
  assert.equal(observation.state, 'quarantined');
  assert.equal(registry.state('planner@5').state, 'quarantined');
  assert.equal(registry.active('planner'), 'planner@4');
  assert.throws(
    () => registry.activate({ ref: 'planner@5', by: APPROVER.kid, now: T0 }),
    (error) => error.code === 'OMEGA_E_QUARANTINED',
    'a candidate that violated its own expectations may not be activated',
  );
});

test('Ω/E12: an unknown version is refused, and the registry never guesses', () => {
  const registry = new VersionRegistry({ activators: [APPROVER.kid] });
  assert.throws(() => registry.state('planner@9'), (error) => error.code === 'OMEGA_E_VERSION_UNKNOWN');
  assert.throws(() => registry.evaluate({ ref: 'planner@9', checks: checks(), now: T0 }), (error) => error.code === 'OMEGA_E_VERSION_UNKNOWN');
  assert.equal(registry.active('planner'), null);
  assert.deepEqual(registry.history(), []);
});

test('Ω/E13: an Evolution Gate verdict is data, and can be committed to a ledger', () => {
  const ledger = new OmegaLedger({ actor: APPROVER, clock: () => T0, module: compiled.hash });
  const registry = new VersionRegistry({
    versions: [{ module: 'planner', version: 4, active: true, manifest: parentManifest() }],
    activators: [APPROVER.kid],
    ledger,
  });
  registry.propose(manifest());
  registry.evaluate({ ref: 'planner@5', checks: checks(), now: T0 });
  const kinds = ledger.entries().map((record) => record.kind);
  assert.ok(kinds.includes('PROPOSAL'));
  assert.ok(kinds.includes('GATE'));
  assert.equal(ledger.entries().every((record) => record.sig.kid === APPROVER.kid), true);
});
