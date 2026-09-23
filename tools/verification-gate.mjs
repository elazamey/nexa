/**
 * Verification gate — the deterministic judge at the end of the agent loop.
 *
 * The agent (proposer) may *claim* that a step succeeded. This module decides
 * whether that claim is admissible as PASS, and it never trusts the claim
 * itself. Only three verdicts exist:
 *
 *   PASS    — a verified evidence chain, produced by a verifier that is not
 *             the proposer, contains a real-runtime HANDLER_RESULT/ALLOW for
 *             the claimed subject, with no later DENY for it.
 *   FAIL    — evidence exists but contradicts the claim (a DENY / GATE_BLOCKED
 *             for the subject) or the chain itself is tampered.
 *   BLOCKED — there is not enough admissible evidence to decide: no evidence,
 *             self-asserted evidence, mock-only evidence, or the proposer is
 *             also the verifier.
 *
 * MOCK ≠ REAL ≠ EVIDENCE (see docs/agent-loop.md):
 *   - a MOCK test proves the code honours a contract; it can never upgrade a
 *     claim to PASS on its own;
 *   - a REAL runtime record is the only thing that can produce PASS;
 *   - and even a REAL record counts only when it sits in a chain that verifies.
 *
 * Zero runtime dependencies beyond the evidence package. Pure function.
 */
import { verifyEvidenceChain } from '../packages/evidence/index.js';

export const VERDICTS = Object.freeze(['PASS', 'FAIL', 'BLOCKED']);
export const EVIDENCE_SOURCES = Object.freeze(['mock', 'real']);

/**
 * Loop stages, in order. `REPAIR_LOOP` is the DIAGNOSE → REPAIR → RETEST cycle
 * that repeats until TEST stops failing.
 */
export const LOOP_STAGES = Object.freeze([
  'DISCOVER', 'UNDERSTAND', 'INSPECT', 'PLAN', 'AUTHORIZE', 'IMPLEMENT',
  'EXECUTE', 'OBSERVE', 'TEST', 'DIAGNOSE', 'REPAIR', 'RETEST',
  'REVIEW', 'VERIFY', 'EVIDENCE', 'DELIVER',
]);

const NEGATIVE_KINDS = new Set(['GATE_BLOCKED', 'ENVELOPE_REJECTED', 'CAPABILITY_REJECTED']);

/**
 * @param {object} input
 * @param {{subject: string, proposer: string, asserted?: boolean}} input.claim
 *   subject   — the key id / artifact id the claim is about
 *   proposer  — key id of the agent making the claim
 *   asserted  — the agent says it is done (informational; never trusted)
 * @param {object[]} [input.records] sealed evidence records (full chain)
 * @param {'mock'|'real'} [input.source] where the records came from
 * @returns {{verdict: 'PASS'|'FAIL'|'BLOCKED', reason: string, evidence?: object}}
 */
export function assessClaim({ claim, records = [], source } = {}) {
  if (!claim || typeof claim.subject !== 'string' || typeof claim.proposer !== 'string') {
    return { verdict: 'BLOCKED', reason: 'claim must name a subject and a proposer' };
  }
  if (!Array.isArray(records) || records.length === 0) {
    return { verdict: 'BLOCKED', reason: 'no evidence: a self-asserted claim is not admissible' };
  }
  if (!EVIDENCE_SOURCES.includes(source)) {
    return { verdict: 'BLOCKED', reason: 'evidence source must be declared as "mock" or "real"' };
  }
  if (source === 'mock') {
    return { verdict: 'BLOCKED', reason: 'mock evidence proves the contract, not the runtime; a REAL run is required for PASS' };
  }

  let chain;
  try {
    chain = verifyEvidenceChain(records);
  } catch (error) {
    return { verdict: 'FAIL', reason: `evidence chain rejected: ${error.message}` };
  }

  if (chain.actors.includes(claim.proposer)) {
    return { verdict: 'BLOCKED', reason: 'proposer signed its own evidence; the verifier must be a different key' };
  }

  const about = records.filter((r) => r.subject === claim.subject);
  if (about.length === 0) {
    return { verdict: 'BLOCKED', reason: 'evidence chain verifies but says nothing about the claimed subject' };
  }

  const negative = about.find((r) => r.decision === 'DENY' || NEGATIVE_KINDS.has(r.kind));
  if (negative) {
    return {
      verdict: 'FAIL',
      reason: `evidence contradicts the claim: ${negative.kind}/${negative.decision} at seq ${negative.seq}`,
      evidence: negative,
    };
  }

  const result = about.find((r) => r.kind === 'HANDLER_RESULT' && r.decision === 'ALLOW');
  if (!result) {
    return { verdict: 'BLOCKED', reason: 'no HANDLER_RESULT/ALLOW record: nothing proves the step actually ran' };
  }

  return { verdict: 'PASS', reason: `verified by ${chain.actors.join(',')} at seq ${result.seq}`, evidence: result };
}
