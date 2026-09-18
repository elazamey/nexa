/**
 * Hypotheses — a claim, its evidence, and what would falsify it.
 *
 * A hypothesis is the only way the learning layer is allowed to say "this is better":
 * measurable, bound to evidence, and *falsifiable*. `confidence_bp` is a posterior over
 * an outcome count — Beta(1,1) prior, so `(failures + 1) / (support + 2)`, in basis
 * points because NEXA data holds no floats — and it is deliberately documented as a
 * belief, never a fact. The system is allowed to be wrong; it is not allowed to be
 * unfalsifiable.
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';

export const OMEGA_HYPOTHESIS_DOMAIN = 'NEXA/omega1 hypothesis\u0000';

/** Targets a proposal may name. The kernel is not on this list, and never will be. */
export const PROPOSAL_TARGETS = Object.freeze([
  'strategy', // how a planner chooses between plans
  'plan', // the plan of a mission
  'policy', // a module's own policy block (never the deployment's)
  'tool-selection', // which tool to prefer for a task
  'memory-indexing', // how memory is indexed and recalled
  'recovery', // fallback order for failing tools
  'prompt', // an agent's instruction text
]);

/** @param {object} value @returns {string} */
export function hypothesisId(value) {
  const body = { ...value };
  delete body.id;
  return sha256Multihash(Buffer.concat([
    Buffer.from(OMEGA_HYPOTHESIS_DOMAIN, 'utf8'),
    canonicalBytes(body),
  ]));
}

/**
 * @param {number} failures @param {number} support
 * @returns {number} the Beta(1,1) posterior, in basis points
 */
export function posterior(failures, support) {
  return Math.round(((failures + 1) / (support + 2)) * 10_000);
}

/**
 * @param {object} pattern a pattern from `minePatterns`
 * @param {{claim?: string, baseline?: string, expected_change?: string, target?: string}} [input]
 * @returns {object} a hypothesis
 */
export function formHypothesis(pattern, { claim = null, baseline = null, expected_change = null, target = 'recovery' } = {}) {
  if (typeof pattern !== 'object' || pattern === null || pattern.kind !== 'Pattern') {
    throw new OmegaError('OMEGA_E_OBSERVATION', 'a hypothesis needs a pattern');
  }
  if (!PROPOSAL_TARGETS.includes(target)) {
    throw new OmegaError('OMEGA_E_HYPOTHESIS', `unknown proposal target: ${target}`, { known: [...PROPOSAL_TARGETS] });
  }
  if (pattern.failures === 0) {
    throw new OmegaError('OMEGA_E_HYPOTHESIS', 'a pattern with no failures supports no improvement');
  }
  const dominant = pattern.dominant_code;
  const text = claim ?? (
    dominant === 'OMEGA_E_CIRCUIT_OPEN'
      ? `${pattern.key} is being retried faster than it can recover`
      : dominant === 'NEXA_E_GATE'
        ? `${pattern.key} is requested on a gate that is closed, so the mission is written to fail`
        : dominant === 'NEXA_E_HANDLER' || dominant === 'NEXA_E_TIMEOUT'
          ? `${pattern.key} fails often enough that a fallback should carry the mission`
          : `${pattern.key} fails more often than the mission can absorb`
  );
  const body = {
    nexa: 'omega1',
    kind: 'Hypothesis',
    claim: text,
    target,
    subject: pattern.key,
    rationale: `${pattern.failures} of ${pattern.observations} calls to ${pattern.key} were denied${dominant === null ? '' : `, mostly with ${dominant}`}`,
    codes: pattern.codes,
    evidence: pattern.evidence,
    confidence_bp: posterior(pattern.failures, pattern.observations),
    baseline: baseline ?? `failure_rate(${pattern.key}) = ${pattern.failure_rate_bp}bp`,
    expected_change: expected_change ?? `failure_rate(${pattern.key}) < ${Math.max(0, pattern.failure_rate_bp - 2_500)}bp`,
    falsifiable_by: `a replayed window of the same size where ${pattern.key} fails less often than it does today`,
    status: 'HYPOTHESIZED',
    // Declared up front, and checked by the gate: an improvement that touches the kernel
    // is refused before it is measured, not after.
    forbidden: ['kernel', 'verifier', 'policy-engine', 'capability-authority', 'omega-kernel', 'evidence-ledger'],
  };
  return { ...body, id: hypothesisId(body) };
}

/**
 * @param {object} hypothesis
 * @returns {object} an improvement proposal — still data, still inert
 */
export function improvementProposal(hypothesis) {
  const body = {
    nexa: 'omega1',
    kind: 'ImprovementProposal',
    target: hypothesis.target,
    hypothesis: hypothesis.id,
    subject: hypothesis.subject,
    claim: hypothesis.claim,
    evidence: hypothesis.evidence,
    baseline: hypothesis.baseline,
    expected_change: hypothesis.expected_change,
    confidence_bp: hypothesis.confidence_bp,
    requires: ['replay', 'benchmark', 'adversarial', 'evolution-gate'],
    applies: 'only through the Evolution Gate: propose → verify → attack → measure → canary → activate',
  };
  return { ...body, id: hypothesisId({ ...body, kind: 'ImprovementProposal' }) };
}
