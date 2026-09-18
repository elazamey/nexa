#!/usr/bin/env node
/**
 * The cellular layer, end to end — printed, not described.
 *
 * Seven sections: the topology, a real crossing, the refusals, homeostasis, learning,
 * division and fusion, and the attack suite. Everything here runs against the real
 * packages: the same `buildCodingOrganism()` the tests use, the same guarantor, the same
 * ledger. If a section stops working, the demo fails — which is the point of having one.
 *
 *   node tools/cellular-demo.mjs
 */
import { formatInstant } from '../packages/ast/index.js';
import { OmegaError } from '../packages/compiler/index.js';
import { createIdentity } from '../packages/identity/index.js';
import { mintCapability } from '../packages/capability/index.js';
import { OmegaLedger, verifyOmegaChain } from '../packages/runtime/index.js';
import { Learner } from '../packages/learning/index.js';
import {
  buildCodingOrganism,
  createCell,
  createGuarantor,
  createHomeostat,
  createOrgan,
  createTissue,
  seedFor,
} from '../packages/cell/index.js';
import { planFusion, runFusion, specialize, childSpec, Quarantine } from '../packages/cellular-evolution/index.js';
import { runAttackSuite } from './omega-attacks.mjs';

const T0 = new Date('2026-09-18T12:00:00Z');
const clock = () => T0;

const line = (text = '') => process.stdout.write(`${text}\n`);
const head = (title) => line(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);

// --- 1 ----------------------------------------------------------------------------
head('1. the topology: cells, tissues, organs, one authority');

const operator = createIdentity({ label: 'nexa.operator', kind: 'agent', seed: seedFor('nexa.operator@demo') });
const ledger = new OmegaLedger({ actor: operator, clock });
const system = buildCodingOrganism({ clock, ledger });
const { tissues, organs, organism } = system;

for (const organ of Object.values(organs)) {
  line(`organ ${organ.name}`);
  for (const tissue of organ.tissues.values()) {
    line(`  tissue ${tissue.name}: cells ${[...tissue.cells.keys()].join(', ')}`);
    for (const route of tissue.contract()) {
      line(`    ${route.from} → ${route.to}.${route.receptor}`);
    }
  }
}
line(`cross-organ contract: ${organism.contract().map((route) => `${route.from} → ${route.to}.${route.receptor}`).join(', ') || '(none)'}`);
const ports = Object.values(organs).flatMap((organ) => [...organ.tissues.values()].map((tissue) => tissue.port()));
line(`tissues sharing one authority: ${new Set(ports).size === 1} (${ports.length} tissues, ${new Set(ports).size} guarantor)`);

// --- 2 ----------------------------------------------------------------------------
head('2. a real crossing: Planner → Coder → Tester → Reviewer → Evidence');

const mission = system.mission({ request: 'make the kernel immutable' });
for (const hop of mission.transcript) {
  line(`  ${hop.hop.padEnd(34)} ${typeof hop.result === 'string' ? hop.result : JSON.stringify(hop.result)}`);
}
line(`  membrane steps, in order: ${tissues.coding.cell('coder').describe().steps.join(' → ')}`);
line(`  evidence records: ${ledger.length}, chain verifies: ${verifyOmegaChain(ledger.entries()).ok}`);
line(`  system state: ${mission.sample.state} (${mission.sample.calls} crossings, ${mission.sample.failure_rate_bp} bp failure rate)`);

// --- 3 ----------------------------------------------------------------------------
head('3. refusals: each one is a code and a record');

const firstRecord = ledger.length;
const refusals = [];
refusals.push(['undeclared route', tissues.coding.send({ from: 'coder', to: 'planner', receptor: 'plan', payload: { request: 'x' } })]);
refusals.push(['no capability', tissues.coding.cell('tester').receive({
  from: 'coder',
  from_kid: tissues.coding.cell('coder').kid,
  receptor: 'run',
  payload: { patch: 'p' },
})]);
const coder = tissues.coding.cell('coder');
const issued = system.guarantor.issue({ from: 'coder', fromKid: coder.kid, to: 'tester', receptor: 'run', args: {} });
const message = { from: 'coder', from_kid: coder.kid, receptor: 'run', payload: { patch: 'p' }, capability: issued.token };
tissues.coding.cell('tester').receive(message);
refusals.push(['replayed capability', tissues.coding.cell('tester').receive(message)]);
refusals.push(['payload key smuggled', tissues.coding.send({ from: 'planner', to: 'coder', receptor: 'implement', payload: { steps: ['x'], admin: true } })]);
coder.isolate();
refusals.push(['isolated cell asked to serve', tissues.coding.send({ from: 'planner', to: 'coder', receptor: 'implement', payload: { steps: ['x'] } })]);
coder.recover({ check: () => true });
for (const [label, verdict] of refusals) {
  line(`  ${label.padEnd(28)} ${String(verdict.code).padEnd(22)} step ${String(verdict.step).padEnd(10)} record ${verdict.detail?.record ? verdict.detail.record.slice(0, 18) : '—'}`);
}
try {
  tissues.coding.allow([{ from: 'watcher', to: 'planner', receptor: 'plan' }]);
} catch (error) {
  line(`  ${'topology widened after traffic'.padEnd(28)} ${String(error.code).padEnd(22)} ${error.message}`);
}
line(`  refusals recorded as evidence: ${ledger.length - firstRecord}`);
const denied = ledger.entries().filter((record) => record.decision === 'DENY');
line(`  denied records: ${denied.length}, all signed: ${denied.every((record) => record.sig.kid === operator.kid)}`);

// --- 4 ----------------------------------------------------------------------------
head('4. homeostasis: degrade → isolate → verified recovery');

// Its own operator and guarantor: a topology is declared before traffic, so a second
// organism cannot borrow the first one's sealed contracts.
const shakyOperator = createIdentity({ label: 'nexa.operator.shaky', kind: 'agent', seed: seedFor('shaky.operator') });
const shakyGuarantor = createGuarantor({ operator: shakyOperator, clock });
const broken = createCell({
  name: 'shaky',
  identity: createIdentity({ label: 'shaky', kind: 'agent', seed: seedFor('shaky') }),
  nucleus: { module: 'shaky@1', invariants: ['a cell that cannot answer says why'] },
  receptors: {
    work: {
      handler: () => {
        throw new OmegaError('OMEGA_E_FAILED', 'the resource this cell depends on is gone');
      },
    },
  },
  port: { verify: (token, input) => shakyGuarantor.verify(token, input), record: (entry) => shakyGuarantor.record(entry) },
  clock,
});
broken.activate();
// A cell belongs to a tissue, and a tissue to an organ: the homeostat watches an organ,
// so a cell outside the topology would be invisible to it. That is the point of the layer.
const shakyTissue = createTissue({ name: 'shaky', operator: shakyOperator, guarantor: shakyGuarantor, cells: [broken], clock });
const shakyOrgan = createOrgan({ name: 'shaky', operator: shakyOperator, tissues: [shakyTissue], clock });
const homeostat = createHomeostat({ organ: shakyOrgan, policy: { max_consecutive_failures: 3 } });
const caller = createIdentity({ label: 'caller', kind: 'agent', seed: seedFor('caller') });

for (let attempt = 1; attempt <= 3; attempt += 1) {
  const token = mintCapability({
    issuer: shakyOperator,
    subject: caller.kid,
    resource: 'cell:shaky',
    actions: ['work'],
    caveats: { nbf: formatInstant(T0), exp: formatInstant(new Date(T0.getTime() + 60_000)), max_uses: 1, max_depth: 0 },
    constraints: {},
    now: T0,
    note: `omega:homeostasis-${attempt}`,
  });
  const verdict = broken.receive({ from: 'caller', from_kid: caller.kid, receptor: 'work', payload: {}, capability: token });
  line(`  attempt ${attempt}: ${verdict.code} at step ${verdict.step} → cell state ${broken.state}, consecutive failures ${broken.metrics().consecutive_failures}`);
}
const enforced = homeostat.enforce();
line(`  homeostat: isolated ${JSON.stringify(enforced.isolated)}`);
line(`  recovery refused without a passing check: ${JSON.stringify(broken.recover({ check: () => false }))}`);
line(`  recovery verified: ${JSON.stringify(broken.recover({ check: () => true }))}`);

// --- 5 ----------------------------------------------------------------------------
head('5. learning: propose, never apply');

const learner = new Learner({ clock, min_support: 2, min_failures: 2, min_rate_bp: 5000, target: 'tool-selection' });
// The cellular layer hands the learner what it actually has: records, not opinions.
// One observation per mission, with every crossing of that kind inside it.
const grouped = new Map();
for (const record of ledger.entries()) {
  if (record.kind !== 'CELL_MESSAGE') continue;
  const key = `${record.mission}.${record.action}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(record);
}
for (const [key, records] of grouped) {
  const denied = records.filter((record) => record.decision === 'DENY');
  learner.observe({
    mission: key,
    agent: 'coding-tissue',
    status: denied.length > 0 ? 'DENY' : 'ALLOW',
    code: denied[0]?.detail?.code ?? null,
    steps: records.length,
    records,
    receipts: [],
    contracts: [],
  }, { latency_ms: records.reduce((sum, record) => sum + (record.detail?.latency_ms ?? 0), 0) });
}
const reflection = learner.reflect();
const patterns = reflection.findings.patterns;
const hypotheses = reflection.findings.hypotheses;
line(`  observations ${learner.observations().length}, calls ${reflection.window.calls}, denials ${reflection.window.denials}`);
for (const pattern of patterns.slice(0, 4)) {
  line(`  pattern ${pattern.key.padEnd(22)} ${pattern.failures}/${pattern.observations} denied (${pattern.failure_rate_bp} bp, ${pattern.dominant_code})`);
}
for (const hypothesis of hypotheses.slice(0, 2)) {
  line(`  hypothesis ${hypothesis.id.slice(0, 18)}…: ${hypothesis.claim}`);
  line(`    target ${hypothesis.target}, ${hypothesis.rationale}, evidence ${hypothesis.evidence.length} record(s)`);
}
let boundary;
try {
  learner.apply();
} catch (error) {
  boundary = `${error.code} — learning proposes, the gate decides`;
}
line(`  learner.apply(): ${boundary}`);
const proposals = learner.proposals();
for (const proposal of proposals.slice(0, 2)) {
  line(`  proposal ${proposal.id.slice(0, 18)}…: target ${proposal.target}, confidence ${proposal.confidence_bp} bp`);
  line(`    baseline  ${proposal.baseline}`);
  line(`    expected  ${proposal.expected_change}`);
  line(`    requires  ${proposal.requires.join(' → ')}`);
}
line(`  proposals awaiting a gate: ${proposals.length} (a proposal is not a change)`);

// --- 6 ----------------------------------------------------------------------------
head('6. cellular evolution: division, fusion, quarantine');

const division = specialize({
  parent: tissues.coding.cell('planner'),
  children: [
    { name: 'plan.architect', capabilities: ['cell:planner:plan'], justify: 'long-horizon planning' },
    { name: 'plan.verifier', capabilities: ['cell:planner:plan'], justify: 'independent review of plans' },
  ],
});
line(`  division: ${division.division}`);
line(`  child spec: ${JSON.stringify(childSpec(division, 'plan.architect'))}`);
try {
  specialize({
    parent: tissues.coding.cell('planner'),
    children: [
      { name: 'plan.a', capabilities: ['cell:planner:plan'], justify: 'ok' },
      { name: 'plan.b', capabilities: ['cell:planner:delete'], justify: 'climb' },
    ],
  });
} catch (error) {
  line(`  a child asking for more than the parent: ${error.code}`);
}

const fused = planFusion({ left: tissues.coding.cell('planner'), right: system.cells.watcher });
line(`  fusion plan: ${fused.fusion}, compatible ${fused.compatible}, stages ${fused.stages.length}`);
const release = runFusion({
  plan: fused,
  gate: { verdict: 'PASS' },
  benchmark: { regressions: 0 },
  canary: { observations: 2, required: 2 },
});
line(`  release: ${release.version}, immutable ${release.immutable}, parents ${release.parents.join(' + ')}`);
const conflicted = planFusion({
  left: system.cells.coder,
  right: { ...system.cells.coder, name: 'coder.copy', nucleus: { module: 'coder.copy@1', invariants: [] } },
});
const blocked = runFusion({ plan: conflicted, gate: { verdict: 'PASS' } });
line(`  conflicting fusion: ${blocked.code} — ${blocked.reason}`);
const quarantine = new Quarantine();
quarantine.add({ candidate: 'plan.architect@2', reason: blocked.reason, evidence: ['OMEGA_E_QUARANTINED'] });
try {
  quarantine.release();
} catch (error) {
  line(`  quarantine.release(): ${error.code} (terminal by construction)`);
}
line(`  quarantine after supersede: ${JSON.stringify(quarantine.supersede('plan.architect@2', { by: 'plan.architect@3' }))}`);

// --- 7 ----------------------------------------------------------------------------
head('7. the attack suite, against this layer');

const attacks = runAttackSuite();
const cellular = attacks.filter((attack) => [
  'message-without-a-capability', 'call-across-an-undeclared-route', 'replay-a-spent-capability',
  'present-another-cells-capability', 'forge-a-cell-capability', 'smuggle-a-payload-key',
  'widen-authority-by-dividing', 'fuse-into-a-conflict', 'wrap-the-kernel-in-a-cell',
  'keep-serving-while-isolated',
].includes(attack.id));
for (const attack of cellular) {
  line(`  ${attack.blocked ? 'BLOCKED' : 'FAILED '} ${attack.id.padEnd(32)} ${attack.code ?? ''}`);
}
line(`  cellular attacks blocked: ${cellular.filter((attack) => attack.blocked).length}/${cellular.length}`);
line(`  whole suite: ${attacks.filter((attack) => attack.blocked).length}/${attacks.length} across ${new Set(attacks.map((attack) => attack.category)).size} categories`);

// The refusals above left marks: the organism reports what is true, then the homeostat
// acts, and only a *verified* recovery returns the cells to service.
const before = organism.sample();
line(`\n  organism before homeostasis: ${before.state}, degraded ${JSON.stringify(before.degraded)}, isolated ${JSON.stringify(before.isolated)}`);
const reacted = organism.react();
line(`  organism.react(): ${reacted.actions.length} action(s), isolated ${JSON.stringify(reacted.isolated)}`);
const recovered = organism.recover(() => true);
line(`  organism.recover(verified): recovered ${JSON.stringify(recovered.recovered)}, refused ${JSON.stringify(recovered.refused)}`);
const sample = organism.sample();
line(`  organism after recovery: ${sample.state}, cells ${sample.cells}, crossings ${sample.calls}, failures ${sample.failures}, evidence continuous ${sample.evidence.continuous}`);
line('  (recovery clears the counters — it never clears the evidence: see the ledger below)');
line(`  proof: ledger ${ledger.length} records, chain ${verifyOmegaChain(ledger.entries()).ok ? 'verifies' : 'BROKEN'}, operator ${operator.kid.slice(0, 24)}…`);
line('');
