/**
 * The learning layer: observe → reflect → propose, and never apply.
 *
 * The tests here are as much about what the layer *cannot* do as what it can: a
 * hypothesis needs evidence, a verification needs evidence, a learner has no authority,
 * a benchmark that moves is not a measurement, and a replay that decides differently is
 * a finding rather than a detail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BENCHMARK_CATEGORIES,
  EPISTEMIC_STATES,
  KnowledgeStore,
  Learner,
  PROPOSAL_TARGETS,
  assertReproducible,
  compareRuns,
  defineSuite,
  diffReplay,
  evaluateSuite,
  isActionable,
  measureOutcome,
  minePatterns,
  observeRun,
  patternKey,
  planReplay,
  posterior,
  promoteClaim,
  reflect,
  replayOutcome,
} from '../packages/learning/index.js';
import { classify, HEAL_PHASES } from '../packages/runtime/index.js';
import { runExample, sessionFor, compileExample, T0 } from './omega-helpers.mjs';

const review = () => runExample('repository-review.nexa', 'review').outcome;
const refusal = () => runExample('gated-write.nexa', 'write-report').outcome;

test('Ω/L1: an observation counts calls, not records, and carries its evidence', () => {
  const outcome = review();
  const observation = observeRun(outcome, { latency_ms: 4, cost: 0 });
  assert.equal(observation.kind, 'RunObservation');
  assert.equal(observation.verdict, 'ALLOW');
  assert.equal(observation.calls, 5);
  assert.equal(observation.failures.length, 0);
  assert.equal(observation.measured, true);
  assert.equal(observation.evidence.length, outcome.records.length);
  assert.match(observation.id, /^sha256:[A-Za-z0-9_-]{43}$/);

  // A gate refusal writes both a TOOL_RESULT and a GATE_REFUSAL: one call, one count.
  const denied = observeRun(refusal());
  assert.equal(denied.calls, 1);
  assert.equal(denied.failure_count, 1);
  assert.deepEqual(denied.failures, ['NEXA_E_GATE']);
});

test('Ω/L2: measurements are the host\'s, and unknown ones are refused', () => {
  assert.throws(() => observeRun(review(), { seconds: 1 }), (error) => error.code === 'OMEGA_E_OBSERVATION');
  assert.throws(() => observeRun(review(), { latency_ms: -1 }), (error) => error.code === 'OMEGA_E_OBSERVATION');
  assert.equal(observeRun(review()).measured, false, 'an unmeasured run says so instead of inventing numbers');
});

test('Ω/L3: patterns are mined deterministically, in basis points', () => {
  const calls = [
    ...observeRun(review()).calls_detail,
    ...observeRun(refusal()).calls_detail,
    ...observeRun(refusal()).calls_detail,
  ];
  const patterns = minePatterns(calls, { min_support: 2 });
  assert.equal(patterns.every((pattern) => Number.isSafeInteger(pattern.failure_rate_bp)), true, 'rates are integers');
  const failing = patterns.find((pattern) => pattern.key === 'fs:/build/report.json!write');
  assert.equal(failing.failures, 2);
  assert.equal(failing.observations, 2);
  assert.equal(failing.failure_rate_bp, 10_000);
  assert.equal(failing.dominant_code, 'NEXA_E_GATE');
  assert.equal(failing.evidence.length, 2);
  assert.deepEqual(minePatterns(calls, { min_support: 2 }).map((pattern) => pattern.id), patterns.map((pattern) => pattern.id));
  assert.equal(minePatterns(calls, { failures_only: true }).every((pattern) => pattern.failures > 0), true);
  assert.equal(isActionable(failing), true);
  assert.equal(isActionable({ failures: 1, failure_rate_bp: 10_000 }), false, 'one failure is noise');
  assert.equal(patternKey({ resource: 'tool:echo', action: 'call' }), 'tool:echo!call');
});

test('Ω/L4: hypotheses are falsifiable, evidence-bound, and never point at the kernel', () => {
  const reflection = reflect({ observations: [observeRun(refusal()), observeRun(refusal())], target: 'recovery' });
  assert.equal(reflection.hypotheses.length > 0, true);
  const hypothesis = reflection.findings.hypotheses[0];
  assert.equal(hypothesis.status, 'HYPOTHESIZED');
  assert.equal(Number.isSafeInteger(hypothesis.confidence_bp), true, 'confidence is basis points');
  assert.equal(hypothesis.confidence_bp, posterior(2, 2));
  assert.ok(hypothesis.falsifiable_by.length > 0, 'a claim without a falsifier is not a hypothesis');
  assert.deepEqual(hypothesis.forbidden, ['kernel', 'verifier', 'policy-engine', 'capability-authority', 'omega-kernel', 'evidence-ledger']);
  assert.throws(() => reflect({ observations: [observeRun(refusal())], target: 'kernel' }), (error) => error.code === 'OMEGA_E_HYPOTHESIS');
  assert.equal(PROPOSAL_TARGETS.includes('strategy'), true);
  assert.equal(PROPOSAL_TARGETS.includes('kernel'), false);
});

test('Ω/L5: a proposal is data, and says what it must pass before it means anything', () => {
  const reflection = reflect({ observations: [observeRun(refusal()), observeRun(refusal())] });
  const proposal = reflection.findings.proposals[0];
  assert.equal(proposal.kind, 'ImprovementProposal');
  assert.deepEqual(proposal.requires, ['replay', 'benchmark', 'adversarial', 'evolution-gate']);
  assert.ok(proposal.evidence.length >= 2);
  assert.match(proposal.applies, /Evolution Gate/);
  assert.equal(reflection.authority, 'none');
  assert.equal(reflection.scope, 'self');
});

test('Ω/L6: the learner observes, reflects, proposes — and cannot apply', () => {
  const learner = new Learner({ clock: () => T0 });
  learner.observe(review(), { latency_ms: 3 });
  learner.observe(refusal());
  learner.observe(refusal());
  const reflection = learner.reflect();
  assert.equal(reflection.window.runs, 3);
  assert.equal(reflection.findings.proposals.length > 0, true);
  assert.equal(learner.proposals().length, reflection.findings.proposals.length);
  assert.deepEqual(learner.journal().map((entry) => entry.kind), ['OBSERVATION', 'OBSERVATION', 'OBSERVATION', 'REFLECTION', 'PROPOSAL']);
  assert.throws(() => learner.apply(), (error) => error.code === 'OMEGA_E_LEARNER_AUTHORITY');
  assert.equal(learner.describe().proposals, learner.proposals().length);
});

test('Ω/L7: knowledge is born a hypothesis, verified only with evidence, invalidated when contradicted', () => {
  const store = new KnowledgeStore({ clock: () => T0 });
  const claim = store.add({ claim: 'gate-aware plans fail less often', tier: 'procedural', created_by: 'learner' });
  assert.equal(claim.status, 'HYPOTHESIZED');
  assert.throws(() => store.verify(claim.id, { by: 'operator' }), (error) => error.code === 'OMEGA_E_UNPROVEN');

  const verified = store.verify(claim.id, { evidence: [`sha256:${'A'.repeat(43)}`], by: 'operator' });
  assert.equal(verified.status, 'VERIFIED');
  assert.equal(verified.state, 'VERIFIED');
  assert.equal(verified.last_verified, T0.toISOString());

  const dependent = store.add({ claim: 'prefer gate-aware planners', tier: 'meta', dependencies: [verified.id] });
  store.verify(dependent.id, { evidence: [`sha256:${'B'.repeat(43)}`] });
  const invalidation = store.invalidate(verified.id, { by: 'operator', reason: 'the gate is closed by design' });
  assert.equal(invalidation.invalidated.status, 'INVALIDATED');
  assert.deepEqual(invalidation.stale, [dependent.id]);
  assert.equal(store.get(dependent.id).status, 'STALE');
  assert.throws(() => store.verify(verified.id, { evidence: [`sha256:${'C'.repeat(43)}`] }), (error) => error.code === 'OMEGA_E_KNOWLEDGE_INVALIDATED');
  assert.equal(store.summary().by_status.INVALIDATED, 1);
});

test('Ω/L8: knowledge refuses secrets, ghosts and impossible promotions', () => {
  const store = new KnowledgeStore({ clock: () => T0 });
  assert.throws(() => store.add({ claim: 'the key is AIzaSyD-1234567890abcdefghijklmnop' }), (error) => error.code === 'OMEGA_E_SECRET_LITERAL');
  assert.throws(() => store.add({ claim: 'rests on nothing', dependencies: [`sha256:${'D'.repeat(43)}`] }), (error) => error.code === 'OMEGA_E_KNOWLEDGE_UNKNOWN');
  assert.throws(() => store.add({ claim: 'bad tier', tier: 'nowhere' }), (error) => error.code === 'OMEGA_E_SCHEMA');

  const observed = { state: 'OBSERVED', evidence: [] };
  assert.throws(() => promoteClaim(observed, { to: 'VERIFIED', evidence: [`sha256:${'E'.repeat(43)}`] }), (error) => error.code === 'OMEGA_E_EPISTEMIC', 'OBSERVED does not jump to VERIFIED');
  assert.throws(() => promoteClaim(observed, { to: 'INFERRED' }), (error) => error.code === 'OMEGA_E_UNPROVEN');
  const inferred = promoteClaim(observed, { to: 'INFERRED', evidence: [`sha256:${'F'.repeat(43)}`] });
  assert.equal(inferred.state, 'INFERRED');
  assert.equal(inferred.history.length, 1);
  assert.deepEqual([...EPISTEMIC_STATES].length, 5);
});

test('Ω/L9: a benchmark is a measurement, and one that moves is refused', () => {
  const suite = defineSuite({
    name: 'learning-suite',
    tasks: [
      { id: 'review-allows', category: 'planning', mission: 'review', expect: { verdict: 'ALLOW', max_steps: 16 } },
      { id: 'write-refused', category: 'security', mission: 'write-report', expect: { verdict: 'DENY', max_steps: 4, max_denials: 2 } },
    ],
  });
  assert.deepEqual([...BENCHMARK_CATEGORIES].length, 9);
  assert.throws(() => defineSuite({ name: 'x', tasks: [{ id: 'a', category: 'nowhere', mission: 'm' }] }), (error) => error.code === 'OMEGA_E_BENCHMARK');
  assert.throws(() => defineSuite({ name: 'x', tasks: [{ id: 'a', category: 'planning', mission: 'm' }, { id: 'a', category: 'planning', mission: 'm' }] }), (error) => error.code === 'OMEGA_E_BENCHMARK');

  const run = (task) => measureOutcome(task.mission === 'review' ? review() : refusal());
  const first = assertReproducible({ suite, run });
  assert.equal(first.metrics.success_rate_bp, 10_000);
  assert.equal(first.metrics.passed, 2);

  let round = 0;
  assert.throws(
    () => assertReproducible({ suite, run: (task) => (round++ === 2 ? { verdict: 'DENY' } : run(task)) }),
    (error) => error.code === 'OMEGA_E_BENCHMARK_NONDETERMINISTIC',
  );

  const regressed = evaluateSuite({ suite, run: (task) => (task.mission === 'review' ? { verdict: 'DENY', steps: 1, denials: 9 } : run(task)) });
  const comparison = compareRuns(first, regressed);
  assert.equal(comparison.verdict, 'FAIL');
  assert.equal(comparison.code, 'OMEGA_E_BENCHMARK_REGRESSION');
  assert.deepEqual(comparison.regressions.map((regression) => regression.id), ['review-allows']);
  assert.equal(comparison.deltas.success_rate_bp, -5000);

  const other = defineSuite({ name: 'other', tasks: [{ id: 'review-allows', category: 'planning', mission: 'review' }] });
  assert.throws(() => compareRuns(first, evaluateSuite({ suite: other, run })), (error) => error.code === 'OMEGA_E_BENCHMARK');
});

test('Ω/L10: replay proves the runtime decides the same thing twice', () => {
  const first = planReplay(review().records);
  const second = planReplay(review().records);
  assert.equal(first.kind, 'ReplayPlan');
  assert.equal(first.steps.length, 5);
  assert.equal(first.id, second.id, 'a replay plan is content-addressed, so determinism is inspectable');
  assert.deepEqual(diffReplay(first, second), { ok: true, mismatches: [] });

  const other = planReplay(refusal().records);
  const diff = diffReplay(first, other);
  assert.equal(diff.ok, false);
  assert.equal(diff.mismatches.length > 0, true);
  assert.equal(replayOutcome(review()).id, first.id);

  const changed = { ...second, steps: second.steps.map((step, index) => (index === 0 ? { ...step, decision: 'DENY' } : step)) };
  assert.equal(diffReplay(first, changed).mismatches[0].field, 'decision');
  assert.throws(() => assertReplayish(first, changed), (error) => error.code === 'OMEGA_E_REPLAY_MISMATCH');
});

/** `assertReplay` throws; this keeps the throw visible in the test body above. */
function assertReplayish(expected, actual) {
  const { ok, mismatches } = diffReplay(expected, actual);
  if (!ok) {
    const error = new Error('a replay must decide the same thing');
    error.code = 'OMEGA_E_REPLAY_MISMATCH';
    error.details = mismatches;
    throw error;
  }
}

test('Ω/L11: the healer classifies, and fails closed on the unknown', () => {
  assert.deepEqual([...HEAL_PHASES], ['detect', 'isolate', 'diagnose', 'recover', 'verify', 'learn']);
  assert.equal(classify('NEXA_E_GATE'), 'permanent');
  assert.equal(classify('OMEGA_E_SECRET_EGRESS'), 'permanent');
  assert.equal(classify('NEXA_E_HANDLER'), 'transient');
  assert.equal(classify('OMEGA_E_BUDGET'), 'structural');
  assert.equal(classify('OMEGA_E_SOMETHING_NEW'), 'unknown');
  assert.equal(classify(null), 'unknown');
});

test('Ω/L12: every learning output is canonical data — no floats, no omissions', () => {
  const observations = [observeRun(review()), observeRun(refusal()), observeRun(refusal())];
  const reflection = reflect({ observations });
  const knowledge = new KnowledgeStore({ clock: () => T0 });
  const entry = knowledge.add({ claim: 'a claim', created_by: 'test' });
  const suite = defineSuite({ name: 'canonical', tasks: [{ id: 't', category: 'planning', mission: 'review' }] });
  const run = evaluateSuite({ suite, run: () => measureOutcome(review()) });
  const plan = planReplay(review().records);
  for (const value of [observations[0], reflection, reflection.findings.patterns[0], reflection.findings.hypotheses[0], reflection.findings.proposals[0], entry, run, plan]) {
    assert.match(value.id, /^sha256:[A-Za-z0-9_-]{43}$/, `${value.kind} has no content address`);
  }
  // The one thing that would break every id: a float in committed data. Walking the
  // values is exact; pattern-matching JSON text is not (timestamps contain dots too).
  const assertIntegerTree = (value, where) => {
    if (typeof value === 'number') {
      assert.equal(Number.isSafeInteger(value), true, `${where} holds a non-integer: ${value}`);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) assertIntegerTree(item, `${where}.${key}`);
  };
  assertIntegerTree([observations, reflection, entry, run, plan], 'learning');
});

test('Ω/L13: reflection reads only what it was given, and cites it', () => {
  const observation = observeRun(refusal());
  const reflection = reflect({ observations: [observation, observation] });
  assert.deepEqual(reflection.evidence_ids, [observation.id, observation.id]);
  assert.equal(reflection.call_evidence_ids.length, 2);
  assert.deepEqual(reflection.window.missions, ['write-report']);
  const empty = reflect({ observations: [] });
  assert.equal(empty.findings.hypotheses.length, 0);
  assert.deepEqual(empty.window, { runs: 0, calls: 0, denials: 0, missions: [] });
});

test('Ω/L14: a refusal is never routed around — the healer says stop', () => {
  const compiled = compileExample('gated-write.nexa');
  const session = sessionFor(compiled);
  const outcome = session.runtime.run('write-report');
  const heal = outcome.records.find((record) => record.kind === 'HEAL');
  assert.equal(heal.detail.classification, 'permanent');
  assert.equal(heal.detail.action, 'stop');
  assert.equal(heal.detail.substitute, null);
});
