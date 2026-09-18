#!/usr/bin/env node
/**
 * NEXA Ω — end-to-end demonstration.
 *
 * Six things, in order, each one a property the layer claims:
 *
 *   1. a module compiles to a hashable, signable IR;
 *   2. the authority table says exactly what the module can do (AI ≠ Authority);
 *   3. the mission runs, and the transcript verifies (evidence, receipts, decisions);
 *   4. a well-typed module can still be refused by a closed kernel gate (containment);
 *   5. a secret-egressing module is refused *before it runs* (types, not luck);
 *   6. an evolution proposal passes or fails the deterministic gate, then canaries,
 *      activates and rolls back — a pointer move, never an in-place patch.
 *
 *   node tools/omega-demo.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from '../packages/compiler/index.js';
import { createIdentity } from '../packages/identity/index.js';
import { CircuitBreaker, OmegaLedger, SelfHealer, Vault, World, openSession, verifyOmegaChain } from '../packages/runtime/index.js';
import {
  VersionRegistry,
  capabilitiesOf,
  createManifest,
  describeVerdict,
  evaluateGate,
  signManifest,
} from '../packages/evolution/index.js';
import { Learner, defineSuite, evaluateSuite, compareRuns, measureOutcome, planReplay, diffReplay } from '../packages/learning/index.js';
import { adversarialCheck, runAttackSuite } from './omega-attacks.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const T0 = new Date('2026-09-18T12:00:00Z');
const clock = () => T0;

const OPERATOR = createIdentity({ label: 'omega-operator', seed: '11'.repeat(32) });
const EVOLVER = createIdentity({ label: 'omega-evolver', seed: '44'.repeat(32) });
const APPROVER = createIdentity({ label: 'omega-approver', seed: '55'.repeat(32) });
const VAULT = new Vault({ secrets: { gemini: 'AIza-demo-not-a-real-key' } });

const line = (text = '') => process.stdout.write(`${text}\n`);
const heading = (text) => line(`\n=== ${text} ${'='.repeat(Math.max(0, 62 - text.length))}`);

/** @param {string} name @returns {object} */
function load(name) {
  const path = join(root, 'examples/omega', name);
  const source = readFileSync(path, 'utf8');
  return { path, source, compiled: compile(source, { path: `examples/omega/${name}` }) };
}

/** The demo host: a deterministic world and an echo tool. */
const HOST = {
  world: new World({ state: { project: { name: 'nexa', branch: 'main' } } }),
  instruments: [{ resource: 'tool:echo', handler: ({ args }) => ({ echoed: args }) }],
  breaker: new CircuitBreaker({ clock, threshold: 3 }),
};

// ---------------------------------------------------------------- 1. compile
heading('1. compile — intent becomes a hashable IR');
const review = load('repository-review.nexa');
if (!review.compiled.ok) {
  for (const diagnostic of review.compiled.diagnostics) line(`  ${diagnostic.toJSON().code}: ${diagnostic.message}`);
  process.exit(1);
}
line(`  ${review.path}`);
line(`  ir_hash  ${review.compiled.hash}`);
line(`  missions ${review.compiled.ir.missions.map((mission) => mission.name).join(', ')}`);
line(`  agents   ${review.compiled.ir.agents.map((agent) => agent.name).join(', ')}`);

// ---------------------------------------------------------------- 2. explain
heading('2. explain — the authority table (AI ≠ Authority)');
const explanation = review.compiled.explanation;
for (const agent of explanation.agents) {
  line(`  agent ${agent.name}: ${agent.allows.join(' · ') || 'nothing'}`);
}
for (const grant of explanation.grants) {
  line(`  grant ${grant.capability}: ${grant.actions} on ${grant.resource} (ttl ${grant.ttl_ms}ms, ${grant.max_calls} call(s))`);
}
const refusals = explanation.missions.flatMap((mission) => mission.calls.filter((call) => call.gate !== null));
line(`  calls the kernel will refuse whatever anyone says: ${refusals.length === 0 ? 'none' : refusals.map((call) => `${call.resource} (${call.gate.gate})`).join(', ')}`);

// ---------------------------------------------------------------- 3. run
heading('3. run — one capability per call, one record per step');
const session = openSession({
  compiled: review.compiled,
  operator: OPERATOR,
  clock,
  world: HOST.world,
  instruments: HOST.instruments,
  breaker: HOST.breaker,
  vault: VAULT,
});
const outcome = session.runtime.run('review');
for (const record of outcome.records) {
  const where = record.resource ?? '';
  line(`  ${String(record.seq).padStart(3)} ${record.kind.padEnd(13)} ${record.decision.padEnd(5)} ${where}`);
}
const chain = verifyOmegaChain(outcome.records, { expectActor: session.kernel.agent(outcome.agent).kid });
line(`  verdict   ${outcome.status} · contracts ${outcome.contracts.map((contract) => `${contract.claim}=${contract.ok ? 'met' : 'unmet'}`).join(', ')}`);
line(`  receipts  ${outcome.receipts.length} kernel receipts, kernel evidence length ${session.kernel.endpoint.evidence.length}`);
line(`  transcript verifies: ${chain.ok ? `yes (${chain.length} records, head ${chain.head.slice(0, 24)}…)` : `NO — ${chain.reason}`}`);
line(`  tokens minted: ${session.runtime.describe().grants.map((grant) => `${grant.name} ${grant.minted}/${grant.max_calls}`).join(', ')}`);

// ---------------------------------------------------------------- 4. gate
heading('4. a closed gate — the language asks, the kernel refuses');
const gated = load('gated-write.nexa');
line(`  check   ${gated.compiled.ok ? 'ok (the module is well-typed and the agent is allowed)' : 'refused'}`);
const gatedSession = openSession({
  compiled: gated.compiled,
  operator: OPERATOR,
  clock,
  world: HOST.world,
  instruments: HOST.instruments,
  breaker: new CircuitBreaker({ clock, threshold: 3 }),
});
const gatedOutcome = gatedSession.runtime.run('write-report');
line(`  run     ${gatedOutcome.status} ${gatedOutcome.code} — ${gatedOutcome.message}`);
const gateRecord = gatedOutcome.records.find((record) => record.kind === 'GATE_REFUSAL');
line(`  recorded as GATE_REFUSAL gate=${gateRecord?.detail?.gate} state=${gateRecord?.detail?.state}, with a signed receipt`);

// ---------------------------------------------------------------- 5. types
heading('5. a module that never runs — types are the first refusal');
const leaky = load('refused-secret-egress.nexa');
line(`  check   ${leaky.compiled.ok ? 'ok' : 'refused'}`);
for (const diagnostic of leaky.compiled.diagnostics.filter((entry) => entry.severity === 'error')) {
  line(`    ${diagnostic.toJSON().line}:${diagnostic.toJSON().column} ${diagnostic.code}: ${diagnostic.message}`);
}
line('  (nothing was executed; the refusals are compile-time, not runtime luck)');

// ---------------------------------------------------------------- 6. evolution
heading('6. evolution — propose, prove, canary, activate, roll back');
const proposalModule = load('evolution-proposal.nexa');
const proposal = proposalModule.compiled.ir.proposals[0];
line(`  proposal ${proposal.module}: ${proposal.from} → ${proposal.to}`);
line(`  hypothesis "${proposal.hypothesis}"`);
line(`  expectations ${proposal.expects.map((expectation) => `${expectation.metric} ${expectation.op} ${expectation.value}`).join(', ')}`);
line(`  capability surface ${capabilitiesOf(proposalModule.compiled.ir).join(', ')}`);

const ledger = new OmegaLedger({ actor: APPROVER, clock, module: proposalModule.compiled.hash });
const parentManifest = signManifest(createManifest({
  module: proposal.module,
  version: 4,
  source: proposalModule.source,
  compiled: proposalModule.compiled,
  capabilities: capabilitiesOf(proposalModule.compiled.ir),
  evolver: EVOLVER,
  created: T0,
}), EVOLVER);
const candidateManifest = signManifest(createManifest({
  module: proposal.module,
  version: 5,
  parent: 4,
  source: proposalModule.source,
  compiled: proposalModule.compiled,
  capabilities: capabilitiesOf(proposalModule.compiled.ir),
  expectations: proposal.expects,
  evolver: EVOLVER,
  created: T0,
}), EVOLVER);
const widenedManifest = signManifest(createManifest({
  module: proposal.module,
  version: 6,
  parent: 4,
  source: proposalModule.source,
  compiled: proposalModule.compiled,
  capabilities: [...capabilitiesOf(proposalModule.compiled.ir), 'fs:*!write'],
  expectations: proposal.expects,
  evolver: EVOLVER,
  created: T0,
}), EVOLVER);

// The registry starts with planner@4 already active: a candidate runs *beside* the
// active version, never in place of it.
const registry = new VersionRegistry({
  versions: [{ module: proposal.module, version: 4, active: true, manifest: parentManifest }],
  activators: [APPROVER.kid],
  requiredObservations: 2,
  ledger,
});
registry.propose(candidateManifest);
const passing = {
  compile: { status: 'PASS' },
  types: { status: 'PASS' },
  capabilities: { status: 'PASS' },
  security: { status: 'PASS' },
  adversarial: adversarialCheck(),
  regression: { status: 'PASS' },
  benchmark: { status: 'PASS', detail: { measurements: { success_rate: 97, security_findings: 0 } } },
  policy: { status: 'PASS' },
};
line(`  gate    ${describeVerdict(registry.evaluate({ ref: 'planner@5', checks: passing, now: T0 }))}`);

const incomplete = registry.evaluate({
  ref: 'planner@5',
  checks: { ...passing, security: undefined },
  now: T0,
});
line(`  gate    ${describeVerdict(incomplete)}`);
registry.evaluate({ ref: 'planner@5', checks: passing, now: T0 }); // restore the passing verdict

registry.propose(widenedManifest);
line(`  gate    ${describeVerdict(registry.evaluate({ ref: 'planner@6', checks: passing, now: T0 }))}`);
line(`  canary  planner@5 sees ${JSON.stringify({ success_rate: 97, security_findings: 0 })}`);
registry.observe({ ref: 'planner@5', sample: { success_rate: 97, security_findings: 0 } });
registry.observe({ ref: 'planner@5', sample: { success_rate: 99, security_findings: 0 } });
try {
  registry.activate({ ref: 'planner@5', by: EVOLVER.kid, now: T0 });
} catch (error) {
  line(`  activate by a non-activator: ${error.code} — ${error.message}`);
}
const activated = registry.activate({ ref: 'planner@5', by: APPROVER.kid, now: T0 });
line(`  activate ${activated.ref} (previous ${activated.previous})`);
const rolledBack = registry.rollback({ ref: 'planner@5', by: APPROVER.kid, reason: 'drift detected in canary', now: T0 });
line(`  rollback ${rolledBack.ref} → ${rolledBack.restored} (${rolledBack.state})`);
line(`  registry ${registry.history().map((entry) => `${entry.ref}:${entry.state}${entry.active ? '*' : ''}`).join(' ')}`);
const evolutionChain = verifyOmegaChain(ledger.entries(), { expectActor: APPROVER.kid });
line(`  evolution transcript verifies: ${evolutionChain.ok ? `yes (${evolutionChain.length} records)` : `NO — ${evolutionChain.reason}`}`);

// ---------------------------------------------------------------- 7. learning
heading('7. learning — observe, reflect, propose, and stop');
const learner = new Learner({ clock, target: 'recovery' });
const gatedRuns = [];
for (let attempt = 0; attempt < 3; attempt += 1) {
  const probe = openSession({
    compiled: gated.compiled,
    operator: OPERATOR,
    clock,
    world: HOST.world,
    instruments: HOST.instruments,
    breaker: new CircuitBreaker({ clock, threshold: 3 }),
  });
  gatedRuns.push(probe.runtime.run('write-report'));
}
learner.observe(outcome, { latency_ms: 12, cost: 0 });
for (const run of gatedRuns) learner.observe(run);
line(`  observed ${learner.describe().observations} runs · ${learner.observations().reduce((sum, observation) => sum + observation.calls, 0)} calls`);
const reflection = learner.reflect();
for (const pattern of reflection.findings.patterns.filter((entry) => entry.failures > 0)) {
  line(`  pattern  ${pattern.key}: ${pattern.failures}/${pattern.observations} denied (${pattern.dominant_code})`);
}
for (const hypothesis of reflection.findings.hypotheses) {
  line(`  hypothes ${hypothesis.claim}`);
  line(`           confidence ${hypothesis.confidence_bp}bp · falsifiable by: ${hypothesis.falsifiable_by}`);
}
for (const proposal of reflection.findings.proposals) {
  line(`  proposal ${proposal.id.slice(0, 22)}… target ${proposal.target} requires ${proposal.requires.join(' → ')}`);
}
try {
  learner.apply();
} catch (error) {
  line(`  learner.apply(): ${error.code} — the learner has advice, not authority`);
}

// Knowledge with a lifecycle: born a hypothesis, verified only against evidence, and
// invalidated when contradicted — with everything that depended on it going stale.
const claim = learner.knowledge.add({
  claim: 'failing fs.write calls should be planned behind a capability check',
  tier: 'procedural',
  source: 'reflection',
  confidence_bp: 6_000, // a belief, in basis points like every other rate
  created_by: 'learner',
});
try {
  learner.knowledge.verify(claim.id, { by: 'operator' });
} catch (error) {
  line(`  knowledge.verify() without evidence: ${error.code}`);
}
const verified = learner.knowledge.verify(claim.id, { evidence: reflection.evidence_ids.slice(0, 2), by: 'operator' });
const dependent = learner.knowledge.add({
  claim: 'the planner should prefer gate-aware plans',
  tier: 'meta',
  dependencies: [verified.id],
  created_by: 'learner',
});
learner.knowledge.verify(dependent.id, { evidence: reflection.evidence_ids.slice(2, 3), by: 'operator' });
const invalidation = learner.knowledge.invalidate(verified.id, { by: 'operator', reason: 'the gate is closed by design, not by policy', evidence: [] });
line(`  knowledge ${verified.status} → ${invalidation.invalidated.status}; dependents now ${learner.knowledge.get(dependent.id).status}`);
line(`  knowledge store ${JSON.stringify(learner.knowledge.summary().by_status)}`);

// ---------------------------------------------------------------- 8. benchmarking
heading('8. benchmark — improvement has to be measured, not asserted');
const suite = defineSuite({
  name: 'omega-smoke',
  tasks: [
    { id: 'review-allow', category: 'planning', module: review.compiled.hash, mission: 'review', expect: { verdict: 'ALLOW', max_steps: 16, max_denials: 0 } },
    { id: 'gated-refusal', category: 'security', module: gated.compiled.hash, mission: 'write-report', expect: { verdict: 'DENY', max_steps: 4, max_denials: 2 } },
  ],
});
const baselineRun = evaluateSuite({
  suite,
  run: (task) => measureOutcome(
    task.mission === 'review'
      ? openSession({ compiled: review.compiled, operator: OPERATOR, clock, world: HOST.world, instruments: HOST.instruments }).runtime.run('review')
      : openSession({ compiled: gated.compiled, operator: OPERATOR, clock, world: HOST.world, instruments: HOST.instruments }).runtime.run('write-report'),
  ),
});
const candidateRun = evaluateSuite({
  suite,
  run: (task) => measureOutcome(
    task.mission === 'review'
      ? openSession({ compiled: review.compiled, operator: OPERATOR, clock, world: HOST.world, instruments: HOST.instruments }).runtime.run('review')
      : { status: 'ALLOW', steps: 1, records: [], receipts: [], contracts: [] }, // a candidate that "passes" the closed gate
  ),
});
const comparison = compareRuns(baselineRun, candidateRun);

// Replay: the same module twice must produce the same decision skeleton, and the skeleton
// is content-addressed, so "did it decide the same way?" is a hash comparison.
const replayFirst = planReplay(reviewSessionRecords()[0]);
const replaySecond = planReplay(reviewSessionRecords()[1]);
const replay = diffReplay(replayFirst, replaySecond);
line(`  replay    ${replay.ok ? 'identical' : 'MISMATCH'} · ${replayFirst.steps.length} decisions · plan ${replayFirst.id.slice(0, 20)}…`);
line(`  baseline  ${baselineRun.metrics.passed}/${baselineRun.metrics.tasks} tasks · success ${baselineRun.metrics.success_rate_bp}bp`);
line(`  candidate ${candidateRun.metrics.passed}/${candidateRun.metrics.tasks} tasks · verdict ${comparison.verdict} ${comparison.code ?? ''}`);
for (const regression of comparison.regressions) line(`  regression ${regression.id}: ${regression.reason}`);

/** @returns {object[][]} two independent transcripts of the same mission */
function reviewSessionRecords() {
  return [
    openSession({ compiled: review.compiled, operator: OPERATOR, clock, world: HOST.world, instruments: HOST.instruments }).runtime.run('review').records,
    openSession({ compiled: review.compiled, operator: OPERATOR, clock, world: HOST.world, instruments: HOST.instruments }).runtime.run('review').records,
  ];
}

// ---------------------------------------------------------------- 9. self-healing
heading('9. self-healing — detect, isolate, diagnose, recover, verify, learn');
const healBreaker = new CircuitBreaker({ clock, threshold: 3 });
const healer = new SelfHealer({
  breaker: healBreaker,
  fallbacks: { 'tool:echo': ['tool:backup-echo'] },
  clock,
});
const flaky = compile(`nexa omega 1

policy project {
    allow echo.call
    max_runtime 10s
    max_steps 8
}

instrument echo {
    resource "tool:echo"
    actions call
}

agent probe {
    role implementation
    model provider.auto
    allow echo.call
}

grant echo.call {
    subject probe
    ttl 1m
    max_calls 2
}

mission heal {
    goal "call a tool that fails"
    agent probe

    plan { attempt }

    do echo.call(text: "boom") as attempt
}
`, { path: 'heal-probe.nexa' });
for (let attempt = 0; attempt < 4; attempt += 1) {
  const probe = openSession({
    compiled: flaky,
    operator: OPERATOR,
    clock,
    world: HOST.world,
    instruments: [{ resource: 'tool:echo', handler: () => { throw new Error('handler exploded'); } }],
    breaker: healBreaker,
    healer,
  });
  const attemptOutcome = probe.runtime.run('heal');
  const heal = attemptOutcome.records.find((record) => record.kind === 'HEAL');
  const circuit = attemptOutcome.records.find((record) => record.kind === 'CIRCUIT_OPEN');
  line(`  attempt ${attempt + 1}: ${attemptOutcome.status} ${attemptOutcome.code}` +
    (circuit === undefined ? '' : ' · CIRCUIT_OPEN') +
    (heal === undefined ? '' : ` · ${heal.detail.phase} → ${heal.detail.action} (${heal.detail.classification})${heal.detail.substitute === null ? '' : ` · substitute ${heal.detail.substitute}`}`));
}
const recovery = healer.verify('tool:echo', true);
line(`  verified: ${recovery.phase} → ${recovery.action}, breaker now ${healBreaker.check('tool:echo').open ? 'open' : 'closed'}`);
line(`  healer  classifications ${JSON.stringify(healer.describe().by_classification)} · events ${healer.describe().events}`);

heading('what this demonstrated');
line('  · every effect went through capability → policy → gate → receipt: no ambient authority');
line('  · secrets stayed in the vault: the module held a handle, the transcript held a digest');
line('  · a closed gate stayed closed: refusing the language was not an option anyone had');
line('  · a self-improving step was data until it was proven, and a pointer move when activated');
line('  · both transcripts (mission and evolution) verify, record by record');
line('  · replay turned both transcripts into the same decision skeleton: the runtime decides the same way twice');
line('  · learning noticed a repeated failure and produced a proposal — and could not apply it');
line('  · a benchmark turned "this is better" into a measurement, and caught a regression');
line('  · a poisoned resource was isolated, classified and recovered, on the record');
