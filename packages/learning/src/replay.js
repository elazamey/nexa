/**
 * Replay — the same inputs, the same decisions.
 *
 * Before a candidate can be trusted with different behaviour, the *current* version has
 * to be shown to behave identically on a repeated run. A `ReplayPlan` is the decision
 * skeleton of a transcript: one entry per gated call, with the resource, the action and
 * the decision — no payloads, no secrets, no values. Replaying a plan against a fresh
 * run must produce the same skeleton, byte for byte.
 *
 * A mismatch is not "slightly different": it is `OMEGA_E_REPLAY_MISMATCH`, and it means
 * the runtime decided differently on the same input. For the kernel that would be a
 * correctness failure; for a candidate under the gate it is evidence against promotion.
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';

export const OMEGA_REPLAY_DOMAIN = 'NEXA/omega1 replay\u0000';

const RESULT_KINDS = Object.freeze(['TOOL_RESULT', 'GATE_REFUSAL', 'CIRCUIT_OPEN']);

/** @param {object} value @returns {string} */
function digest(value) {
  return sha256Multihash(Buffer.concat([
    Buffer.from(OMEGA_REPLAY_DOMAIN, 'utf8'),
    canonicalBytes(value),
  ]));
}

/**
 * @param {object[]} records Ω ledger records from one run
 * @returns {object} a `ReplayPlan`: the run's decision skeleton
 */
export function planReplay(records) {
  if (!Array.isArray(records)) throw new OmegaError('OMEGA_E_REPLAY', 'records must be an array');
  const steps = [];
  let pending = null;
  for (const record of records) {
    if (record.kind === 'TOOL_CALL') {
      pending = { step: record.step, resource: record.resource, action: record.action ?? null, gate: record.detail?.gate ?? null };
      continue;
    }
    if (!RESULT_KINDS.includes(record.kind)) continue;
    steps.push({
      step: record.step,
      resource: record.resource,
      action: record.action ?? null,
      decision: record.decision,
      code: record.detail?.code ?? (record.kind === 'CIRCUIT_OPEN' ? 'OMEGA_E_CIRCUIT_OPEN' : 'OMEGA_E_NO_RESULT'),
      gate: record.detail?.gate ?? pending?.gate ?? null,
    });
    pending = null;
  }
  const body = {
    nexa: 'omega1',
    kind: 'ReplayPlan',
    module: records[0]?.module ?? null,
    mission: records.find((record) => record.mission !== undefined)?.mission ?? null,
    steps,
    records: records.length,
  };
  return { ...body, id: digest(body) };
}

/** @param {object} plan @returns {string} the plan's content address */
export function replayDigest(plan) {
  if (plan?.kind !== 'ReplayPlan') throw new OmegaError('OMEGA_E_REPLAY', 'a ReplayPlan is required');
  const { id, ...body } = plan; // eslint-disable-line no-unused-vars
  return digest(body);
}

/**
 * @param {object} expected
 * @param {object} actual
 * @returns {{ok: boolean, mismatches: object[]}}
 */
export function diffReplay(expected, actual) {
  if (expected?.kind !== 'ReplayPlan' || actual?.kind !== 'ReplayPlan') {
    throw new OmegaError('OMEGA_E_REPLAY', 'two ReplayPlans are required');
  }
  const mismatches = [];
  const length = Math.max(expected.steps.length, actual.steps.length);
  for (let index = 0; index < length; index += 1) {
    const before = expected.steps[index];
    const after = actual.steps[index];
    if (before === undefined || after === undefined) {
      mismatches.push({ index, field: 'step', expected: before ?? null, actual: after ?? null, reason: 'the runs made a different number of calls' });
      continue;
    }
    for (const field of ['step', 'resource', 'action', 'decision', 'code', 'gate']) {
      if (before[field] !== after[field]) {
        mismatches.push({ index, field, expected: before[field], actual: after[field], reason: 'a replay must decide the same thing' });
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * @param {object} expected
 * @param {object} actual
 * @returns {object} the actual plan, when it matches
 */
export function assertReplay(expected, actual) {
  const { ok, mismatches } = diffReplay(expected, actual);
  if (!ok) {
    throw new OmegaError('OMEGA_E_REPLAY_MISMATCH', `${mismatches.length} decision(s) changed between runs`, {
      mismatches: mismatches.slice(0, 8),
      expected: expected.id,
      actual: actual.id,
    });
  }
  return actual;
}

/** @param {object} outcome @returns {object} the plan for a mission outcome */
export function replayOutcome(outcome) {
  return planReplay(outcome?.records ?? []);
}
