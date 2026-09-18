#!/usr/bin/env node
/**
 * Pinned cellular vectors.
 *
 * Regenerates `spec/vectors/cellular.json`. It pins what must never drift silently in the
 * cellular layer: the membrane's step order, the lifecycle table, the sample organism's
 * identities and contracts, the decision skeleton of a real mission, the codes of its
 * refusals, what the learning layer concludes from that evidence, the division/fusion
 * plans, and the cellular attack reports (id, category, blocked, code).
 *
 * What is deliberately **not** pinned: capability ids and anything hashed from them. A
 * capability is minted fresh per call — that is a property, not noise — so the vectors pin
 * the decision (resource, action, receptor, step, digest), not the token.
 *
 *   node tools/cellular-vectors.mjs
 *   node tools/cellular-vectors.mjs --check   (compare, do not write)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createIdentity } from '../packages/identity/index.js';
import { OmegaLedger, verifyOmegaChain } from '../packages/runtime/index.js';
import { Learner } from '../packages/learning/index.js';
import {
  CELL_STATES,
  DIAGNOSTIC_STATES,
  LIFE_SUPPORT,
  MEMBRANE_STEPS,
  SERVING_STATES,
  TRANSITIONS,
  buildCodingOrganism,
  createHomeostat,
  seedFor,
} from '../packages/cell/index.js';
import { planFusion, runFusion, specialize, Quarantine } from '../packages/cellular-evolution/index.js';
import { runAttackSuite } from './omega-attacks.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const T0 = new Date('2026-09-18T12:00:00Z');
const clock = () => T0;

const operator = createIdentity({ label: 'nexa.operator', kind: 'agent', seed: seedFor('nexa.operator@demo') });
const ledger = new OmegaLedger({ actor: operator, clock });
const system = buildCodingOrganism({ clock, ledger });
const { tissues, organs, organism, cells, guarantor } = system;

// --- the mission: what was decided, not which token decided it ---------------------
const mission = system.mission({ request: 'make the kernel immutable' });
const decisionSkeleton = (record) => ({
  seq: record.seq,
  kind: record.kind,
  decision: record.decision,
  mission: record.mission,
  step: record.step,
  resource: record.resource,
  action: record.action,
  code: record.detail?.code ?? null,
  membrane_step: record.detail?.step ?? null,
  payload_digest: record.detail?.payload_digest ?? null,
});

const transcript = mission.transcript.map((hop) => ({
  hop: hop.hop,
  decision: typeof hop.result === 'string' ? 'REFUSED' : 'ALLOWED',
}));

// --- refusals: five ways across a membrane, each with its code ---------------------
const refusals = [];
const refuse = (label, verdict) => refusals.push({ probe: label, ok: verdict.ok, code: verdict.code, step: verdict.step });
refuse('undeclared route', tissues.coding.send({ from: 'coder', to: 'planner', receptor: 'plan', payload: { request: 'x' } }));
refuse('no capability', tissues.coding.cell('tester').receive({
  from: 'coder',
  from_kid: tissues.coding.cell('coder').kid,
  receptor: 'run',
  payload: { patch: 'p' },
}));
const coder = tissues.coding.cell('coder');
const issued = guarantor.issue({ from: 'coder', fromKid: coder.kid, to: 'tester', receptor: 'run', args: {} });
const replays = { from: 'coder', from_kid: coder.kid, receptor: 'run', payload: { patch: 'p' }, capability: issued.token };
tissues.coding.cell('tester').receive(replays);
refuse('replayed capability', tissues.coding.cell('tester').receive(replays));
refuse('payload key smuggled', tissues.coding.send({ from: 'planner', to: 'coder', receptor: 'implement', payload: { steps: ['x'], admin: true } }));
coder.isolate();
refuse('isolated cell', tissues.coding.send({ from: 'planner', to: 'coder', receptor: 'implement', payload: { steps: ['x'] } }));
coder.recover({ check: () => true });

// --- learning: what the refusals teach, in integers --------------------------------
const learner = new Learner({ clock, min_support: 2, min_failures: 2, min_rate_bp: 5000, target: 'tool-selection' });
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
  });
}
const reflection = learner.reflect();
const learning = {
  window: reflection.window,
  patterns: reflection.findings.patterns.map((pattern) => ({
    key: pattern.key,
    observations: pattern.observations,
    failures: pattern.failures,
    failure_rate_bp: pattern.failure_rate_bp,
    dominant_code: pattern.dominant_code,
  })),
  hypotheses: reflection.findings.hypotheses.map((hypothesis) => ({
    claim: hypothesis.claim,
    target: hypothesis.target,
    evidence: hypothesis.evidence.length,
  })),
  proposals: learner.proposals().map((proposal) => ({
    target: proposal.target,
    baseline: proposal.baseline,
    expected_change: proposal.expected_change,
    confidence_bp: proposal.confidence_bp,
    requires: proposal.requires,
  })),
};

// --- evolution: division, fusion, quarantine --------------------------------------
const division = specialize({
  parent: cells.planner,
  children: [
    { name: 'plan.architect', capabilities: ['cell:planner:plan'], justify: 'long-horizon planning' },
    { name: 'plan.verifier', capabilities: ['cell:planner:plan'], justify: 'independent review of plans' },
  ],
});
const fused = planFusion({ left: cells.planner, right: cells.watcher });
const fusion = {
  compatible: fused.compatible,
  stages: fused.stages.map((stage) => stage.stage),
  version: fused.version.next,
  release: runFusion({
    plan: fused,
    gate: { verdict: 'PASS' },
    benchmark: { regressions: 0 },
    canary: { observations: 2, required: 2 },
  }),
};
const conflicted = planFusion({
  left: cells.coder,
  right: { ...cells.coder, name: 'coder.copy', nucleus: { module: 'coder.copy@1', invariants: [] } },
});
const quarantine = new Quarantine();
quarantine.add({ candidate: 'plan.architect@2', reason: 'receptor conflict', evidence: ['OMEGA_E_QUARANTINED'] });
let releaseCode = null;
try {
  quarantine.release('plan.architect@2');
} catch (error) {
  releaseCode = error.code;
}
const superseded = quarantine.supersede('plan.architect@2', { by: 'plan.architect@3' });
const evolutionProbe = {
  division: { name: division.division, children: division.children.map((child) => child.name) },
  fusion: {
    compatible: fusion.compatible,
    stages: fusion.stages,
    version: fusion.version,
    released: fusion.release.ok,
    immutable: fusion.release.immutable,
    parents: fusion.release.parents,
  },
  conflicting_fusion: { compatible: conflicted.compatible, code: runFusion({ plan: conflicted, gate: { verdict: 'PASS' } }).code },
  quarantine: { release: releaseCode, state: superseded.state, superseded_by: superseded.superseded_by },
};

const homeostat = createHomeostat({ organ: organs.software });

const cellularAttackIds = new Set([
  'message-without-a-capability', 'call-across-an-undeclared-route', 'replay-a-spent-capability',
  'present-another-cells-capability', 'forge-a-cell-capability', 'smuggle-a-payload-key',
  'widen-authority-by-dividing', 'fuse-into-a-conflict', 'wrap-the-kernel-in-a-cell',
  'keep-serving-while-isolated',
]);
const attacks = runAttackSuite()
  .filter((attack) => cellularAttackIds.has(attack.id))
  .map((attack) => ({ id: attack.id, category: attack.category, blocked: attack.blocked, code: attack.code }));

const payload = {
  nexa: 'omega1',
  layer: 'cellular',
  generated_by: 'node tools/cellular-vectors.mjs',
  membrane: {
    steps: [...MEMBRANE_STEPS],
    serving_states: [...SERVING_STATES],
    diagnostic_states: [...DIAGNOSTIC_STATES],
    life_support: [...LIFE_SUPPORT],
    states: [...CELL_STATES],
    transitions: Object.fromEntries(Object.entries(TRANSITIONS).map(([state, next]) => [state, [...next]])),
  },
  organism: {
    name: organism.name,
    state: organism.sample().state,
    policy: homeostat.policy,
    cells: Object.values(cells).map((cell) => ({ name: cell.name, kid: cell.kid, nucleus: cell.describe().nucleus, receptors: cell.receptors })),
    tissues: Object.values(tissues).map((tissue) => ({
      name: tissue.name,
      cells: [...tissue.cells.keys()],
      contract: tissue.contract().map((route) => `${route.from}->${route.to}.${route.receptor}`),
    })),
    organs: Object.values(organs).map((organ) => ({ name: organ.name, tissues: [...organ.tissues.keys()], contract: organ.contract() })),
    cross_organ_contract: organism.contract(),
  },
  mission: {
    transcript,
    decisions: ledger.entries().map(decisionSkeleton),
    // The chain head is *not* pinned: it hashes the capability ids, and a capability is
    // minted fresh per call. The decision skeleton above is the reproducible part.
    evidence: { records: ledger.length, chain_ok: verifyOmegaChain(ledger.entries()).ok, head_pinned: false },
  },
  refusals,
  learning,
  evolution: evolutionProbe,
  attacks,
};

const target = join(root, 'spec/vectors/cellular.json');
const text = `${JSON.stringify(payload, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== text) {
    process.stderr.write('cellular vectors are out of date: run `node tools/cellular-vectors.mjs`\n');
    process.exit(1);
  }
  process.stdout.write('cellular vectors are in sync\n');
} else {
  writeFileSync(target, text);
  process.stdout.write(`wrote spec/vectors/cellular.json (${text.length} bytes, ${payload.organism.cells.length} cells, ${refusals.length} refusals, ${attacks.length} attacks)\n`);
}
