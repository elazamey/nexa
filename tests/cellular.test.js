/**
 * Ω∞ cellular suite.
 *
 * The cellular layer is the newest and least proven surface in NEXA, so most of these tests
 * are attacks: undeclared routes, replayed capabilities, impersonated senders, widened
 * authority through refactoring, payloads that were never accepted, cells that keep
 * answering after they should have stopped. A layer that composes authority has to be
 * tested where authority could leak.
 *
 * Run alone: `node --test tests/cellular.test.js`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { formatInstant } from '../packages/ast/index.js';
import { mintCapability } from '../packages/capability/index.js';
import { createIdentity } from '../packages/identity/index.js';
import { OmegaLedger, verifyOmegaChain } from '../packages/runtime/index.js';
import { buildCodingOrganism, createCell, createGuarantor, createTissue, seedFor, SYSTEM_STATES } from '../packages/cell/index.js';
import { planFusion, runFusion, specialize, childSpec, Quarantine } from '../packages/cellular-evolution/index.js';
import { T0, SEEDS } from './omega-helpers.mjs';

const clock = () => T0;

/** A fresh organism per test: state must never leak between attacks. */
function organism() {
  return buildCodingOrganism({ clock });
}

/** The operator identity the cells trust, from the sample organism. */
const OPERATOR = () => createIdentity({ label: 'nexa.operator', kind: 'agent', seed: seedFor('nexa.operator@demo') });

// --- Ω/C1: the membrane is the only door -----------------------------------

test('Ω/C1: a message without a capability is refused at the membrane, and recorded', () => {
  const { tissues } = organism();
  const coder = tissues.coding.cell('coder');
  const verdict = coder.receive({ from: 'planner', from_kid: tissues.coding.cell('planner').kid, receptor: 'implement', payload: { steps: ['x'] } });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'OMEGA_E_CAP_MISSING');
  assert.equal(verdict.step, 'capability');
  assert.equal(coder.metrics().calls, 1, 'the refusal is counted against the cell, not hidden');
});

test('Ω/C2: a route the contract never declared is refused, and nothing is minted', () => {
  const { tissues } = organism();
  const usageBefore = tissues.coding.usage();
  const verdict = tissues.coding.send({ from: 'coder', to: 'planner', receptor: 'plan', payload: { request: 'climb' } });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'OMEGA_E_ROUTE');
  assert.deepEqual(tissues.coding.usage(), usageBefore, 'a refused route must not spend a capability');
  assert.ok(verdict.detail.contract.length >= 3, 'the refusal names the contract that was in force');
});

test('Ω/C3: a capability minted for one cell cannot be presented by another', () => {
  const { tissues, guarantor } = organism();
  const coder = tissues.coding.cell('coder');
  const tester = tissues.coding.cell('tester');
  const issued = guarantor.issue({ from: 'coder', fromKid: coder.kid, to: 'tester', receptor: 'run', args: {} });
  const verdict = tissues.coding.cell('tester').receive({
    from: 'coder',
    from_kid: tissues.coding.cell('planner').kid, // a different key
    receptor: 'run',
    payload: { patch: 'p' },
    capability: issued.token,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'NEXA_E_CAP_AUDIENCE');
});

test('Ω/C4: a capability is single-use: presenting it twice is a replay', () => {
  const { tissues, guarantor } = organism();
  const coder = tissues.coding.cell('coder');
  const issued = guarantor.issue({ from: 'coder', fromKid: coder.kid, to: 'tester', receptor: 'run', args: {} });
  const message = { from: 'coder', from_kid: coder.kid, receptor: 'run', payload: { patch: 'p' }, capability: issued.token };
  assert.equal(tissues.coding.cell('tester').receive(message).ok, true);
  const replay = tissues.coding.cell('tester').receive(message);
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'NEXA_E_REPLAY');
});

test('Ω/C5: a tampered capability is refused by signature, not by luck', () => {
  const { tissues, guarantor } = organism();
  const coder = tissues.coding.cell('coder');
  const issued = guarantor.issue({ from: 'coder', fromKid: coder.kid, to: 'tester', receptor: 'run', args: {} });
  const forged = { ...issued.token, actions: ['run', 'delete'] };
  const verdict = tissues.coding.cell('tester').receive({ from: 'coder', from_kid: coder.kid, receptor: 'run', payload: { patch: 'p' }, capability: forged });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'NEXA_E_SIG');
});

test('Ω/C6: a token from an unrecognised authority is refused (fail closed)', () => {
  const { tissues } = organism();
  const outsider = createIdentity({ label: 'outsider', kind: 'agent', seed: SEEDS.outsider });
  const subject = createIdentity({ label: 'coder', kind: 'agent', seed: seedFor('coder') });
  const token = mintCapability({
    issuer: outsider,
    subject: subject.kid,
    resource: 'cell:tester',
    actions: ['run'],
    caveats: { nbf: formatInstant(T0), exp: formatInstant(new Date(T0.getTime() + 60_000)), max_uses: 1, max_depth: 0 },
    constraints: {},
    now: T0,
    note: 'omega:forged',
  });
  const verdict = tissues.coding.cell('tester').receive({ from: 'coder', from_kid: subject.kid, receptor: 'run', payload: { patch: 'p' }, capability: token });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'NEXA_E_UNTRUSTED');
});

// --- Ω/C7–C10: type, policy, budget, unmodelled failure ---------------------

test('Ω/C7: a payload key the receptor never accepted is refused before any work happens', () => {
  let ran = 0;
  const operator = OPERATOR();
  const guarantor = createGuarantor({ operator, clock });
  const ears = createCell({
    name: 'ears',
    identity: createIdentity({ label: 'ears', kind: 'agent', seed: seedFor('ears') }),
    nucleus: { module: 'ears@1', invariants: [] },
    receptors: {
      listen: {
        accepts: ['note'],
        handler: () => {
          ran += 1;
          return { heard: true };
        },
      },
    },
    port: { verify: guarantor.verify, record: guarantor.record },
    clock,
  });
  ears.activate();
  const sent = createIdentity({ label: 'mouth', kind: 'agent', seed: seedFor('mouth') });
  const token = mintCapability({
    issuer: operator,
    subject: sent.kid,
    resource: 'cell:ears',
    actions: ['listen'],
    caveats: { nbf: formatInstant(T0), exp: formatInstant(new Date(T0.getTime() + 60_000)), max_uses: 1, max_depth: 0 },
    constraints: {},
    now: T0,
    note: 'omega:extra',
  });
  const verdict = ears.receive({ from: 'mouth', from_kid: sent.kid, receptor: 'listen', payload: { note: 'hi', extra: 'smuggled' }, capability: token });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'OMEGA_E_SCHEMA');
  assert.equal(verdict.step, 'type');
  assert.equal(ran, 0, 'the handler must not run on a payload the receptor did not accept');
});

test('Ω/C8: a receptor that requires an audience refuses a message without it', () => {
  const { cells } = organism();
  const verdict = cells.archivist.receive({
    from: 'coding.reviewer',
    from_kid: cells.reviewer.kid,
    receptor: 'recall',
    payload: { key: 'plan' },
    capability: { id: 'urn:nexa:cap:none' },
  });
  assert.equal(verdict.ok, false);
  assert.ok(['OMEGA_E_CAP_MISSING', 'OMEGA_E_POLICY', 'NEXA_E_CAP_INVALID'].includes(verdict.code), verdict.code);
});

test('Ω/C9: the cell budget is a ceiling, not a suggestion', () => {
  const { tissues } = organism();
  const coder = tissues.coding.cell('coder');
  assert.equal(coder.describe().budget.max_calls > 0, true);
  const big = 'x'.repeat(coder.describe().budget.max_payload_bytes + 1);
  const verdict = tissues.coding.send({ from: 'planner', to: 'coder', receptor: 'implement', payload: { steps: [big] } });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'OMEGA_E_BUDGET');
  assert.equal(verdict.step, 'budget');
});

test('Ω/C10: a receptor that throws an unmodelled error is a refusal, not a crash', () => {
  const operator = OPERATOR();
  const guarantor = createGuarantor({ operator, clock });
  const broken = createCell({
    name: 'broken',
    identity: createIdentity({ label: 'broken', kind: 'agent', seed: seedFor('broken') }),
    nucleus: { module: 'broken@1', invariants: [] },
    receptors: { work: { handler: () => { throw new TypeError('undefined is not a function'); } } },
    port: { verify: guarantor.verify, record: guarantor.record },
    clock,
  });
  broken.activate();
  const caller = createIdentity({ label: 'caller', kind: 'agent', seed: seedFor('caller') });
  const token = mintCapability({
    issuer: operator,
    subject: caller.kid,
    resource: 'cell:broken',
    actions: ['work'],
    caveats: { nbf: formatInstant(T0), exp: formatInstant(new Date(T0.getTime() + 60_000)), max_uses: 1, max_depth: 0 },
    constraints: {},
    now: T0,
    note: 'omega:work',
  });
  const verdict = broken.receive({ from: 'caller', from_kid: caller.kid, receptor: 'work', payload: {}, capability: token });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'OMEGA_E_HANDLER');
  assert.equal(verdict.step, 'execution');
  assert.equal(broken.state, 'DEGRADED', 'a throwing receptor degrades its own cell');
});

// --- Ω/C11–C13: lifecycle, nucleus, authority -------------------------------

test('Ω/C11: an isolated cell serves nothing but life support, and recovery must pass a check', () => {
  const { cells, tissues } = organism();
  const coder = cells.coder;
  coder.isolate();
  const refused = tissues.coding.send({ from: 'planner', to: 'coder', receptor: 'implement', payload: { steps: ['x'] } });
  assert.equal(refused.code, 'OMEGA_E_ISOLATED');
  assert.equal(refused.step, 'identity');

  assert.equal(coder.recover({ check: () => false }).recovered, false);
  assert.equal(coder.state, 'ISOLATED', 'a failed check leaves the cell isolated');
  assert.equal(coder.recover({ check: () => true }).recovered, true);
  assert.equal(coder.state, 'ACTIVE');
  const allowed = tissues.coding.send({ from: 'planner', to: 'coder', receptor: 'implement', payload: { steps: ['x'] } });
  assert.equal(allowed.ok, true);
});

test('Ω/C11b: retired is terminal', () => {
  const { cells } = organism();
  const watcher = cells.watcher;
  watcher.retire();
  assert.equal(watcher.state, 'RETIRED');
  assert.throws(() => watcher.activate(), (error) => error.code === 'OMEGA_E_LIFECYCLE');
  assert.throws(() => watcher.isolate(), (error) => error.code === 'OMEGA_E_LIFECYCLE');
  watcher.degrade('OMEGA_E_HANDLER');
  assert.equal(watcher.state, 'RETIRED', 'degrade() does not resurrect a retired cell');
  assert.equal(watcher.recover({ check: () => true }).recovered, false);
  assert.equal(watcher.state, 'RETIRED', 'recovery does not resurrect a retired cell either');
});

test('Ω/C12: the nucleus is immutable, and a kernel nucleus is not a cell at all', () => {
  const { cells } = organism();
  assert.equal(Object.isFrozen(cells.planner.nucleus), true);
  assert.throws(() => { cells.planner.nucleus.module = 'planner@9'; }, TypeError);
  assert.throws(
    () => createCell({
      name: 'sneaky',
      identity: createIdentity({ label: 'sneaky', kind: 'agent', seed: seedFor('sneaky') }),
      nucleus: { module: 'capability-authority@1', invariants: [] },
      receptors: {},
      port: { verify: () => ({ ok: false }), record: () => ({ hash: null }) },
    }),
    (error) => error.code === 'OMEGA_E_KERNEL_IMMUTABLE',
  );
});

test('Ω/C13: a cell cannot mint — it can only propose, and the proposal is inert', () => {
  const { cells, guarantor } = organism();
  const planner = cells.planner;
  assert.equal(planner.issue, undefined);
  assert.equal(planner.mint, undefined);
  assert.equal(planner.authority, undefined);
  const proposal = planner.propose({ to: 'coder', receptor: 'implement', payload: { steps: ['x'] } });
  assert.equal(proposal.kind, 'CellProposal');
  assert.equal(typeof proposal.token, 'undefined');
  // ...and the proposal buys nothing at the membrane.
  const verdict = cells.coder.receive({ from: 'planner', from_kid: planner.kid, receptor: 'implement', payload: { steps: ['x'] }, capability: proposal });
  assert.equal(verdict.ok, false);
  assert.ok(['OMEGA_E_CAP_MISSING', 'NEXA_E_CAP_INVALID'].includes(verdict.code), verdict.code);
  assert.equal(typeof guarantor.issue, 'function', 'the authority lives in the tissue, not in the cell');
});

// --- Ω/C14–C16: homeostasis, recursion, evidence ----------------------------

test('Ω/C14: homeostasis isolates what keeps failing, and only a verified recovery revives it', async () => {
  const { createHomeostat } = await import('../packages/cell/index.js');
  const { tissues, organs } = organism();
  const coder = tissues.coding.cell('coder');
  const homeostat = createHomeostat({ organ: organs.software });

  // Three real refusals at the membrane — the same counter the runtime's breaker watches.
  const planner = tissues.coding.cell('planner');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const verdict = coder.receive({ from: 'planner', from_kid: planner.kid, receptor: 'implement', payload: { steps: ['x'] } });
    assert.equal(verdict.code, 'OMEGA_E_CAP_MISSING');
  }
  assert.equal(coder.metrics().consecutive_failures, 3);
  const { isolated, reading } = homeostat.enforce();
  assert.equal(isolated.length >= 1, true, `expected an isolation, reading was ${JSON.stringify(reading.sick)}`);
  assert.equal(coder.state, 'ISOLATED');
  const report = homeostat.report();
  assert.equal(report.isolation.includes('coder'), true);

  const recovered = organs.software.health();
  assert.equal(recovered.isolated.includes('coder'), true);
});

test('Ω/C15: a tissue with no entry points cannot pretend to be a cell', () => {
  const operator = OPERATOR();
  const guarantor = createGuarantor({ operator, clock });
  const quiet = createCell({
    name: 'quiet',
    identity: createIdentity({ label: 'quiet', kind: 'agent', seed: seedFor('quiet') }),
    nucleus: { module: 'quiet@1', invariants: [] },
    receptors: { listen: { handler: () => ({ heard: true }) } },
    port: { verify: guarantor.verify, record: guarantor.record },
    clock,
  });
  const tissue = createTissue({ name: 'hollow', operator, guarantor, cells: [quiet], clock });
  assert.throws(() => tissue.asCell(), (error) => error.code === 'OMEGA_E_ROUTE');
});

test('Ω/C15b: a tissue with an entry point is a cell, and its call re-crosses a membrane', () => {
  const { organs } = organism();
  const composite = organs.software.asCell();
  assert.equal(composite.kind, 'composite');
  assert.deepEqual(composite.receptors, ['plan']);
  assert.equal(composite.state, 'DEFINED');
  // A cell that was never activated serves nothing: the recursion does not grant immunity.
  const defined = composite.receive({ from: 'outside', from_kid: organs.memory.asCell().kid, receptor: 'plan', payload: { request: 'x' } });
  assert.equal(defined.code, 'OMEGA_E_ISOLATED');
  composite.activate();
  // ...and once active it is a real cell: without a capability it is refused like any other.
  const verdict = composite.receive({ from: 'outside', from_kid: organs.memory.asCell().kid, receptor: 'plan', payload: { request: 'x' } });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'OMEGA_E_CAP_MISSING');
});

test('Ω/C16: every membrane decision is evidence, and the chain verifies', () => {
  const operator = OPERATOR();
  const ledger = new OmegaLedger({ actor: operator, clock });
  const { mission, organism: system } = buildCodingOrganism({ clock, ledger });
  const result = mission({ request: 'add a cell layer' });
  assert.equal(result.ok, true);
  const records = ledger.entries();
  assert.equal(records.length, 4, 'four crossings, four records');
  for (const record of records) {
    assert.equal(record.kind, 'CELL_MESSAGE');
    assert.equal(record.decision, 'ALLOW');
    assert.equal(record.sig.kid, operator.kid);
    assert.match(record.hash, /^sha256:/);
  }
  const chain = verifyOmegaChain(records);
  assert.equal(chain.ok, true, JSON.stringify(chain));
  const sample = system.sample();
  assert.equal(sample.evidence.continuous, true);
  assert.equal(sample.state, SYSTEM_STATES[0]);
});

test('Ω/C16b: a denied crossing is evidence too', () => {
  const operator = OPERATOR();
  const ledger = new OmegaLedger({ actor: operator, clock });
  const { tissues } = buildCodingOrganism({ clock, ledger });
  const verdict = tissues.coding.send({ from: 'coder', to: 'planner', receptor: 'plan', payload: { request: 'x' } });
  assert.equal(verdict.code, 'OMEGA_E_ROUTE');
  const records = ledger.entries();
  assert.equal(records.length, 1);
  assert.equal(records[0].decision, 'DENY');
  assert.equal(records[0].detail.code, 'OMEGA_E_ROUTE');
});

// --- Ω/C17–C18: cellular evolution ------------------------------------------

test('Ω/C17: division gives a child only what the parent had; anything else is amplification', () => {
  const { cells } = organism();
  const plan = specialize({
    parent: cells.planner,
    children: [
      { name: 'plan.a', capabilities: ['cell:planner:plan'], justify: 'planning only' },
      { name: 'plan.b', capabilities: ['cell:planner:plan'], justify: 'planning too' },
    ],
  });
  assert.equal(plan.children.length, 2);
  assert.throws(
    () => specialize({
      parent: cells.planner,
      children: [
        { name: 'plan.c', capabilities: ['cell:planner:plan'], justify: 'ok' },
        { name: 'plan.d', capabilities: ['cell:planner:delete'], justify: 'climb' },
      ],
    }),
    (error) => error.code === 'OMEGA_E_CELL_AMPLIFY',
  );
  const spec = childSpec(plan, 'plan.a');
  assert.equal(spec.nucleus.module, 'plan.a@2');
  assert.equal(spec.capabilities.length, 1);
});

test('Ω/C18: fusion never overwrites, and a conflict goes straight to quarantine', () => {
  const { cells } = organism();
  // Same receptor name from two different modules: the membrane would have to answer
  // "which contract?", so the fusion is a conflict, not a merge.
  const twin = { ...cells.coder, name: 'coder.copy', nucleus: { module: 'coder.copy@1', invariants: [] } };
  const conflicted = planFusion({ left: cells.coder, right: twin });
  assert.equal(conflicted.compatible, false);
  assert.deepEqual(conflicted.conflicts.map((entry) => entry.receptor), ['implement']);
  const conflictFree = planFusion({ left: cells.planner, right: cells.watcher });
  assert.equal(conflictFree.compatible, true);
  const ok = runFusion({ plan: conflictFree, gate: { verdict: 'PASS' }, benchmark: { regressions: 0 }, canary: { observations: 2, required: 2 } });
  assert.equal(ok.ok, true);
  assert.equal(ok.immutable, true);
  assert.deepEqual(ok.parents, ['planner@1', 'watcher@1'], 'the parents are named, not replaced');

  const quarantined = runFusion({ plan: conflictFree, gate: { verdict: 'FAIL' } });
  assert.equal(quarantined.code, 'OMEGA_E_QUARANTINED');
});

test('Ω/C18b: quarantine is terminal — a candidate can be superseded, never released', () => {
  const quarantine = new Quarantine();
  const entry = quarantine.add({ candidate: 'planner@6', reason: 'the adversarial stage caught a scope widening', evidence: ['OMEGA_E_GATE_STAGE'] });
  assert.equal(entry.state, 'QUARANTINED');
  assert.equal(quarantine.has('planner@6'), true);
  assert.throws(() => quarantine.release('planner@6'), (error) => error.code === 'OMEGA_E_QUARANTINED');
  const superseded = quarantine.supersede('planner@6', { by: 'planner@7' });
  assert.equal(superseded.state, 'SUPERSEDED');
  assert.equal(superseded.superseded_by, 'planner@7');
  assert.throws(() => quarantine.release('planner@6'), (error) => error.code === 'OMEGA_E_QUARANTINED');
});

test('Ω/C19: the organism reports what is true, not what is comfortable', () => {
  const { organism: system, organs, cells, tissues } = organism();
  const healthy = system.sample();
  assert.equal(healthy.state, 'SYSTEM_ACTIVE');
  assert.equal(healthy.failure_rate_bp, 0);

  // One real refusal, then a degrade and an isolation: the sample has to reflect all three.
  const refused = tissues.coding.cell('coder').receive({
    from: 'planner',
    from_kid: tissues.coding.cell('planner').kid,
    receptor: 'implement',
    payload: { steps: ['x'] },
  });
  assert.equal(refused.code, 'OMEGA_E_CAP_MISSING');
  cells.tester.isolate();
  assert.equal(cells.coder.state, 'DEGRADED');
  const sick = system.sample();
  assert.equal(sick.state, 'SYSTEM_DEGRADED');
  assert.equal(sick.degraded.includes('software/coding/coder'), true);
  assert.equal(sick.isolated.includes('software/coding/tester'), true);
  assert.equal(sick.failure_rate_bp > healthy.failure_rate_bp, true);
  assert.equal(organs.software.health().isolated.length, 1);
});

test('Ω/C21: the topology is sealed — a route added after traffic is refused', () => {
  const { tissues, organs } = organism();
  const coder = tissues.coding.cell('coder');
  assert.equal(coder.state, 'ACTIVE');
  // One real crossing: the guarantor is now sealed.
  const first = tissues.coding.send({ from: 'planner', to: 'coder', receptor: 'implement', payload: { steps: ['x'] } });
  assert.equal(first.ok, true);
  assert.throws(
    () => tissues.coding.allow([{ from: 'watcher', to: 'planner', receptor: 'plan' }]),
    (error) => error.code === 'OMEGA_E_ROUTE',
  );
  void organs;
});

test('Ω/C22: a cell refusal is observable evidence for the learning layer', async () => {
  const { Learner } = await import('../packages/learning/index.js');
  const { tissues } = organism();
  const coder = tissues.coding.cell('coder');
  const plannerKid = tissues.coding.cell('planner').kid;
  // Three identical refusals at the same receptor: a pattern the tissue can act on.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    tissues.coding.cell('coder').receive({ from: 'planner', from_kid: plannerKid, receptor: 'implement', payload: { steps: ['x'] } });
  }
  const calls = tissues.coding.evidence();
  assert.equal(calls.length >= 3, true);
  const learner = new Learner({ clock, min_support: 2, min_failures: 2, min_rate_bp: 5000, target: 'tool-selection' });
  learner.observe({
    mission: 'coder.implement',
    agent: 'coding-tissue',
    status: 'DENY',
    code: 'OMEGA_E_CAP_MISSING',
    steps: calls.length,
    records: calls,
    receipts: [],
    contracts: [],
  });
  const reflection = learner.reflect();
  assert.equal(reflection.findings.patterns.some((pattern) => pattern.key === 'coder!implement'), true);
  const hypothesis = reflection.findings.hypotheses.find((entry) => entry.subject === 'coder!implement');
  assert.ok(hypothesis !== undefined);
  assert.equal(hypothesis.evidence.length >= 3, true, 'a hypothesis without evidence would be an opinion');
  const [proposal] = learner.proposals();
  assert.equal(proposal.baseline.startsWith('failure_rate('), true);
  assert.equal(proposal.requires.includes('evolution-gate'), true, 'a proposal is not a change');
  assert.throws(() => learner.apply(), (error) => error.code === 'OMEGA_E_LEARNER_AUTHORITY');
  assert.equal(coder.state, 'DEGRADED', 'the refusals left the cell degraded, as the membrane said');
});

test('Ω/C20: the sample organism is deterministic — same names, same keys, same digest', () => {
  const a = organism();
  const b = organism();
  assert.equal(a.cells.coder.kid, b.cells.coder.kid);
  const digest = (system) => JSON.stringify(system.sample());
  assert.equal(digest(a.organism), digest(b.organism));
});
