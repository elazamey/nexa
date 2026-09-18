/**
 * Reflection — the system asking itself what keeps going wrong.
 *
 * Reflection is deliberately a *pure function of observations*. It cannot see the
 * source of a running module, cannot edit anything, and cannot make a change; all it
 * produces is a `Reflection` record: the evidence it read, the patterns it found, the
 * hypotheses it formed and the improvement proposals that followed. Every number in it
 * can be recomputed from the ledger by anyone who has the ledger.
 *
 *   reflect mission {
 *       inspect failures
 *       identify repeated patterns
 *       generate hypotheses
 *       compare strategies
 *       produce proposals
 *   }
 *
 * — that block, as data, is what this function returns.
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';
import { flattenCalls } from './observation.js';
import { isActionable, minePatterns } from './pattern.js';
import { PROPOSAL_TARGETS, formHypothesis, improvementProposal } from './hypothesis.js';

export const OMEGA_REFLECTION_DOMAIN = 'NEXA/omega1 reflection\u0000';

/** @param {object} value @returns {string} */
export function reflectionId(value) {
  const body = { ...value };
  delete body.id;
  return sha256Multihash(Buffer.concat([
    Buffer.from(OMEGA_REFLECTION_DOMAIN, 'utf8'),
    canonicalBytes(body),
  ]));
}

/**
 * @param {object} input
 * @param {object[]} input.observations run observations from `observeRun`
 * @param {number} [input.min_support] calls a pattern needs before it is named
 * @param {number} [input.min_failures] failures a pattern needs before it is acted on
 * @param {number} [input.min_rate] failure rate a pattern needs before it is acted on
 * @param {string} [input.target] proposal target for every hypothesis formed here
 * @param {{get: (id: string) => object}} [input.knowledge] when present, prior beliefs are consulted
 * @returns {object} a `Reflection` record
 */
export function reflect({
  observations,
  min_support = 2,
  min_failures = 2,
  min_rate = 0.5,
  target = 'recovery',
  knowledge = null,
} = {}) {
  if (!Array.isArray(observations)) throw new OmegaError('OMEGA_E_OBSERVATION', 'observations must be an array');
  // Checked before the data is read: "may this ever be a target?" is a question about the
  // request, not about how many failures happened to be observed this time.
  if (!PROPOSAL_TARGETS.includes(target)) {
    throw new OmegaError('OMEGA_E_HYPOTHESIS', `unknown proposal target: ${target}`, { known: [...PROPOSAL_TARGETS] });
  }
  const calls = flattenCalls(observations);
  const patterns = minePatterns(calls, { min_support });
  const actionable = patterns.filter((pattern) => isActionable(pattern, { min_failures, min_rate }));
  const hypotheses = actionable.map((pattern) => formHypothesis(pattern, { target }));
  const proposals = hypotheses.map((hypothesis) => improvementProposal(hypothesis));
  const prior = knowledge === null ? [] : [...new Set(
    hypotheses.map((hypothesis) => knowledge.get(hypothesis.subject)).filter((entry) => entry !== null).map((entry) => entry.id),
  )];

  const body = {
    nexa: 'omega1',
    kind: 'Reflection',
    window: {
      runs: observations.length,
      calls: calls.length,
      denials: calls.filter((call) => call.decision === 'DENY').length,
      missions: [...new Set(observations.map((observation) => observation.mission))].sort(),
    },
    // The evidence ids, so a human (or the meta-audit) can re-read exactly what was read.
    evidence_ids: observations.map((observation) => observation.id),
    call_evidence_ids: calls.map((call) => call.id),
    prior_knowledge: prior,
    patterns: patterns.map((pattern) => pattern.id),
    actionable: actionable.length,
    hypotheses: hypotheses.map((hypothesis) => hypothesis.id),
    proposals: proposals.map((proposal) => proposal.id),
    findings: {
      patterns,
      hypotheses,
      proposals,
    },
    // Reflection produces no verdict about the world: only about the system's own calls.
    scope: 'self',
    authority: 'none',
  };
  return { ...body, id: reflectionId(body) };
}
