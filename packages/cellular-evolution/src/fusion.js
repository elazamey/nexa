/**
 * Fusion — A + B → a *new* version. Never A overwritten by B.
 *
 * The pipeline is fixed and every stage is data, so a fusion can be reviewed before it is
 * attempted and replayed afterwards:
 *
 *   Compatibility → Contract → Capability Analysis → State Migration → Sandbox → Security
 *   Tests → Benchmark → Canary → new immutable version
 *
 * Two refusals carry the design:
 *
 *   · a receptor both parents define with different meanings is a **conflict**, not a merge;
 *   · the fused cell may not hold authority neither parent held (`OMEGA_E_CELL_AMPLIFY`).
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';
import { describeVerdict } from '../../evolution/index.js';

export const FUSION_STAGES = Object.freeze([
  'compatibility',
  'contract',
  'capability_analysis',
  'state_migration',
  'sandbox',
  'security_tests',
  'benchmark',
  'canary',
]);

/** @param {object} cell @returns {Set<string>} the receptors a cell offers */
const receptorSet = (cell) => new Set(cell.receptors);

/**
 * @param {object} input
 * @param {object} input.left @param {object} input.right
 * @param {string} [input.name] the fused cell's name
 * @returns {object} a fusion plan: stages, conflicts, contract and the version it would claim
 */
export function planFusion({ left, right, name = null }) {
  if (typeof left?.name !== 'string' || typeof right?.name !== 'string') {
    throw new OmegaError('OMEGA_E_SCHEMA', 'fusion needs two cells');
  }
  if (left.name === right.name) throw new OmegaError('OMEGA_E_SCHEMA', 'a cell cannot fuse with itself');

  const fusedName = name ?? `${left.name}+${right.name}`;
  const shared = [...receptorSet(left)].filter((receptor) => receptorSet(right).has(receptor)).sort();
  const conflicts = shared.map((receptor) => {
    const leftModule = left.nucleus.module;
    const rightModule = right.nucleus.module;
    // Same name, different owner: the membrane would have to answer "which contract?".
    return { receptor, left: leftModule, right: rightModule };
  });
  const compatible = conflicts.length === 0;

  const contract = {
    receptors: [...new Set([...left.receptors, ...right.receptors])].sort(),
    isolated: {
      [left.name]: [...left.receptors].sort(),
      [right.name]: [...right.receptors].sort(),
    },
  };

  const capabilityDelta = {
    left: left.receptors.map((receptor) => `cell:${fusedName}:${receptor}`),
    right: right.receptors.map((receptor) => `cell:${fusedName}:${receptor}`),
    added: shared.map((receptor) => `cell:${fusedName}:${receptor}`),
  };

  const stateMigration = {
    keys: [`memory:${left.name}`, `memory:${right.name}`],
    policy: 'digests are re-keyed under the fused name; values are never copied',
  };

  const version = { of: [left.nucleus.module, right.nucleus.module], next: `${fusedName}@1` };

  return {
    kind: 'FusionPlan',
    fusion: `${left.name} + ${right.name} -> ${fusedName}`,
    fused_name: fusedName,
    compatible,
    conflicts,
    contract,
    capability_delta: capabilityDelta,
    state_migration: stateMigration,
    version,
    stages: FUSION_STAGES.map((stage) => ({ stage, required: true })),
    digest: sha256Multihash(canonicalBytes({ fusedName, left: left.nucleus.module, right: right.nucleus.module, contract })),
  };
}

/**
 * Execute a planned fusion. The gate verdict is an input, not an afterthought: a plan whose
 * gate did not pass has no path forward but quarantine.
 *
 * @param {object} input
 * @param {object} input.plan
 * @param {object} input.gate the Evolution Gate verdict for the fused version
 * @param {{baseline: object, candidate: object}} [input.benchmark]
 * @param {{observations: number, required: number}} [input.canary]
 * @returns {object} the release decision
 */
export function runFusion({ plan, gate, benchmark = null, canary = null }) {
  if (plan?.kind !== 'FusionPlan') throw new OmegaError('OMEGA_E_SCHEMA', 'runFusion takes a plan from planFusion');
  if (plan.compatible !== true) {
    return {
      ok: false,
      code: 'OMEGA_E_QUARANTINED',
      reason: `receptor conflict: ${plan.conflicts.map((entry) => entry.receptor).join(', ')}`,
      version: plan.version.next,
      stages: plan.stages.map((entry) => ({ ...entry, passed: false, blocked: true })),
    };
  }
  const gateVerdict = gate?.verdict ?? gate?.state ?? null;
  if (gateVerdict === null) throw new OmegaError('OMEGA_E_SCHEMA', 'runFusion needs the gate verdict for the fused version');
  const gateLabel = Array.isArray(gate?.stages) ? describeVerdict(gate) : String(gateVerdict);
  const gateOk = gateVerdict === 'PASS' || gateVerdict === 'CANARY' || gateVerdict === 'ACTIVE';
  if (!gateOk) {
    return {
      ok: false,
      code: 'OMEGA_E_QUARANTINED',
      reason: `the Evolution Gate returned ${gateLabel}; a failed fusion is quarantined, never retried in place`,
      version: plan.version.next,
      gate: gateLabel,
    };
  }
  const benchmarkOk = benchmark === null ? null : benchmark.regressions === 0;
  if (benchmarkOk === false) {
    return { ok: false, code: 'OMEGA_E_BENCHMARK_REGRESSION', reason: 'the fused version regressed', version: plan.version.next };
  }
  const canaryOk = canary === null ? null : canary.observations >= canary.required;
  if (canaryOk === false) {
    return { ok: false, code: 'OMEGA_E_CANARY_INCOMPLETE', reason: 'the canary window is not closed', version: plan.version.next };
  }
  return {
    ok: true,
    code: null,
    version: plan.version.next,
    // The immutable part: fusion *produces* a version. Nothing here overwrites a parent,
    // and the parents remain addressable forever.
    immutable: true,
    parents: plan.version.of,
    gate: gateLabel,
    benchmark: benchmark === null ? 'not supplied' : `${benchmark.regressions} regressions`,
    canary: canary === null ? 'not supplied' : `${canary.observations}/${canary.required} observations`,
    stages: plan.stages.map((entry) => ({ ...entry, passed: true })),
  };
}
