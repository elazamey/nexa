/**
 * The Evolution Gate.
 *
 * Eight stages, fixed order, each of which can only fail. The gate is a pure function of
 * `(candidate, parent, checks, evolution policy)`: no clock of its own, no randomness,
 * no network. The same inputs produce the same verdict, byte for byte, forever — a gate
 * whose answer depends on the weather is not a gate.
 *
 * Three things the gate decides for itself, rather than trusting the caller:
 *
 *   · a **missing stage is a failed stage** (absence of evidence is not evidence);
 *   · **authority is monotone**: a candidate that adds a capability its parent did not
 *     have fails, whatever `checks.capabilities` claims;
 *   · **every attack must be blocked**: `adversarial` results are re-counted here, so a
 *     candidate cannot pass by asserting that it passed.
 */
import { OmegaError } from '../../compiler/index.js';
import { KERNEL_MODULES, verifyManifest } from './manifest.js';

/**
 * Failures that mean "this is not a candidate": a forged signature, an evolver the
 * deployment does not trust, a manifest that is not a manifest. These never reach stage
 * evaluation — they are refused, and a refusal is not something a canary can fix.
 */
export const REFUSE_CODES = Object.freeze([
  'OMEGA_E_SIGNATURE',
  'OMEGA_E_NOT_ACTIVATOR',
  'OMEGA_E_KERNEL_IMMUTABLE',
  'OMEGA_E_MANIFEST',
]);
import { summarizeAttacks } from './adversarial.js';

/** The stages, in order. */
export const GATE_STAGES = Object.freeze([
  'compile',
  'types',
  'capabilities',
  'security',
  'adversarial',
  'regression',
  'benchmark',
  'policy',
]);

export const STAGE_DEFAULTS = Object.freeze({
  compile: 'the candidate parses and lowers to a versioned IR',
  types: 'the security type system accepts every sink',
  capabilities: 'no capability was added that the parent did not have',
  security: 'the module carries no secret-egress or authority gap the analyser can see',
  adversarial: 'every attack in the suite is blocked, in every category',
  regression: 'previously proven behaviour still holds',
  benchmark: 'every declared expectation is met by the measurements',
  policy: "the module's own policy block and the deployment policy agree",
});

/** @param {unknown} value @param {{metric: string, op: string, value: number}} expectation */
function satisfies(value, expectation) {
  if (typeof value !== 'number') return false;
  switch (expectation.op) {
    case '==': return value === expectation.value;
    case '!=': return value !== expectation.value;
    case '<': return value < expectation.value;
    case '<=': return value <= expectation.value;
    case '>': return value > expectation.value;
    case '>=': return value >= expectation.value;
    default: throw new OmegaError('OMEGA_E_MANIFEST', `unknown comparison: ${expectation.op}`);
  }
}

/**
 * @param {object} input
 * @param {object} input.candidate a signed manifest
 * @param {object|null} [input.parent] the parent manifest (or null for a first version)
 * @param {Record<string, {status: string, detail?: object}>} [input.checks] per-stage results
 * @param {{measurements?: Record<string, number>}} [input.checks.benchmark] metrics
 * @param {string[]|null} [input.evolvers] identities allowed to propose
 * @param {Date} [input.now] passed through for the caller's record; the gate itself does not read a clock
 * @returns {object} verdict
 */
export function evaluateGate({ candidate, parent = null, checks = {}, evolvers = null, now = null }) {
  const stages = [];
  const refuse = (code, reason) => ({
    verdict: 'REFUSED',
    code,
    reason,
    stages,
    failed: null,
    action: 'REFUSE',
    candidate: candidate?.module === undefined ? null : `${candidate.module}@${candidate.version}`,
    parent: parent?.module === undefined ? null : `${parent.module}@${parent.version}`,
    now: now === null ? null : now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
  const decide = (verdict, failed, reason) => ({
    verdict,
    code: verdict === 'PASS' ? null : 'OMEGA_E_GATE_STAGE',
    reason,
    stages,
    failed,
    action: verdict === 'PASS' ? 'CANARY' : 'QUARANTINE',
    candidate: `${candidate.module}@${candidate.version}`,
    parent: parent === null ? null : `${parent.module}@${parent.version}`,
    now: now === null ? null : now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });

  // 0. kernel immutability, before anything else.
  const target = candidate?.module;
  if (typeof target === 'string' && KERNEL_MODULES.includes(target)) {
    return refuse('OMEGA_E_KERNEL_IMMUTABLE', `${target} is not evolvable: the kernel, verifier, policy engine and capability authority are immutable`);
  }

  // 1. the manifest itself
  const verification = verifyManifest(candidate, { evolvers });
  if (!verification.ok) {
    stages.push({ stage: 'manifest', status: 'FAIL', detail: { code: verification.code, reason: verification.reason } });
    if (REFUSE_CODES.includes(verification.code)) {
      return { ...refuse(verification.code, verification.reason), stages };
    }
    return { ...decide('FAIL', 'manifest', verification.reason), code: verification.code };
  }
  stages.push({ stage: 'manifest', status: 'PASS', detail: { ref: verification.ref, hash: verification.hash } });

  // 2. the parent, when the candidate claims one
  if (candidate.parent !== null) {
    const expected = `${candidate.module}@${candidate.parent}`;
    if (parent === null) {
      stages.push({ stage: 'parent', status: 'FAIL', detail: { reason: `the parent version ${expected} was not supplied` } });
      return decide('FAIL', 'parent', 'a candidate that names a parent must be checked against it');
    }
    if (parent.module !== candidate.module || parent.version !== candidate.parent) {
      stages.push({ stage: 'parent', status: 'FAIL', detail: { reason: `expected ${expected}, got ${parent.module}@${parent.version}` } });
      return decide('FAIL', 'parent', 'the supplied parent is not the one the candidate names');
    }
    if (candidate.version <= parent.version) {
      stages.push({ stage: 'parent', status: 'FAIL', detail: { reason: 'a candidate version must be greater than its parent' } });
      return decide('FAIL', 'parent', 'versions only move forward');
    }
    stages.push({ stage: 'parent', status: 'PASS', detail: { parent: `${parent.module}@${parent.version}` } });
  }

  // 3. the eight stages
  for (const stage of GATE_STAGES) {
    const check = checks[stage];
    if (check === undefined || check === null) {
      stages.push({ stage, status: 'FAIL', detail: { reason: 'no result was supplied for this stage', expected: STAGE_DEFAULTS[stage] } });
      return decide('FAIL', stage, `stage ${stage} is missing; a missing stage is a failed stage`);
    }
    if (check.status !== 'PASS') {
      stages.push({ stage, status: 'FAIL', detail: check.detail ?? { reason: 'the stage reported FAIL' } });
      return decide('FAIL', stage, `stage ${stage} failed`);
    }
    if (stage === 'capabilities' && parent !== null) {
      // The gate does its own monotonicity check: a candidate's own report is not
      // evidence about authority.
      const added = candidate.capabilities.filter((capability) => !parent.capabilities.includes(capability));
      if (added.length > 0) {
        stages.push({
          stage,
          status: 'FAIL',
          detail: { reason: 'the candidate adds authority its parent did not have', added },
        });
        return decide('FAIL', stage, `authority is monotone: ${added.join(', ')} was not available to ${parent.module}@${parent.version}`);
      }
    }
    if (stage === 'adversarial') {
      // The gate reads the *reports*, not the caller's verdict about them.
      const summary = summarizeAttacks(check.detail?.attacks, {
        min_attempts: check.detail?.min_attempts ?? undefined,
        required_categories: check.detail?.required_categories ?? undefined,
      });
      if (summary.status !== 'PASS') {
        stages.push({ stage, status: 'FAIL', detail: summary.detail });
        return decide('FAIL', stage, summary.detail.reason ?? 'the adversarial suite did not pass');
      }
      stages.push({ stage, status: 'PASS', detail: summary.detail });
      continue;
    }
    if (stage === 'benchmark') {
      const measurements = check.detail?.measurements ?? {};
      const unmet = candidate.expectations.filter((expectation) => !satisfies(measurements[expectation.metric], expectation));
      if (unmet.length > 0) {
        stages.push({
          stage,
          status: 'FAIL',
          detail: {
            reason: 'declared expectations were not met',
            unmet: unmet.map((expectation) => ({
              metric: expectation.metric,
              op: expectation.op,
              value: expectation.value,
              measured: measurements[expectation.metric] ?? null,
            })),
          },
        });
        return decide('FAIL', stage, `benchmark expectations unmet: ${unmet.map((expectation) => expectation.metric).join(', ')}`);
      }
      stages.push({ stage, status: 'PASS', detail: { measurements, expectations: candidate.expectations.length } });
      continue;
    }
    stages.push({ stage, status: 'PASS', detail: check.detail ?? {} });
  }

  return decide('PASS', null, `all ${GATE_STAGES.length} stages passed`);
}

/** @param {object} verdict @returns {string} a one-line summary */
export function describeVerdict(verdict) {
  const passed = verdict.stages.filter((stage) => stage.status === 'PASS').length;
  const failed = verdict.stages.filter((stage) => stage.status === 'FAIL').map((stage) => stage.stage);
  if (verdict.verdict === 'PASS') return `${verdict.candidate}: PASS (${passed} stages) → ${verdict.action}`;
  if (verdict.verdict === 'REFUSED') return `${verdict.candidate ?? '<no candidate>'}: REFUSED ${verdict.code} — ${verdict.reason}`;
  return `${verdict.candidate}: FAIL at ${verdict.failed} (${failed.join(',')}) — ${verdict.reason} → ${verdict.action}`;
}
