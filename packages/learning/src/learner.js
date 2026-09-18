/**
 * The learner — observe, reflect, propose, and stop there.
 *
 * This class is the whole self-learning surface of NEXA Ω, and the most important
 * method in it is `apply()`: it does not exist, and calling it throws
 * `OMEGA_E_LEARNER_AUTHORITY`. Learning in NEXA is the ability to *notice* and to
 * *argue*, not the ability to *change*. A proposal leaves this object as data, walks
 * through replay, benchmark and the adversarial suite, and only the Evolution Gate —
 * which reads no clock, holds no opinion and can only fail — may move a version.
 *
 *   OBSERVE → REFLECT → HYPOTHESIZE → PROPOSE → [ replay · benchmark · attack · gate ]
 */
import { OmegaError } from '../../compiler/index.js';
import { observeRun } from './observation.js';
import { reflect } from './reflection.js';
import { PROPOSAL_TARGETS } from './hypothesis.js';
import { KnowledgeStore } from './knowledge.js';

export const LEARNER_JOURNAL_KINDS = Object.freeze(['OBSERVATION', 'REFLECTION', 'PROPOSAL']);

export class Learner {
  #observations = [];
  #reflections = [];
  #journal = [];
  #clock;

  /**
   * @param {{clock?: () => Date, knowledge?: KnowledgeStore, min_support?: number,
   *          min_failures?: number, min_rate?: number, target?: string}} [input]
   */
  constructor({
    clock = () => new Date(),
    knowledge = new KnowledgeStore({ clock }),
    min_support = 2,
    min_failures = 2,
    min_rate = 0.5,
    target = 'recovery',
  } = {}) {
    if (!PROPOSAL_TARGETS.includes(target)) {
      throw new OmegaError('OMEGA_E_HYPOTHESIS', `unknown proposal target: ${target}`, { known: [...PROPOSAL_TARGETS] });
    }
    this.#clock = clock;
    this.knowledge = knowledge;
    this.minSupport = min_support;
    this.minFailures = min_failures;
    this.minRate = min_rate;
    this.target = target;
  }

  /** @param {string} kind @param {object} entry */
  #write(kind, entry) {
    if (!LEARNER_JOURNAL_KINDS.includes(kind)) {
      throw new OmegaError('OMEGA_E_OBSERVATION', `unknown journal kind: ${kind}`);
    }
    this.#journal.push({ seq: this.#journal.length, at: this.#clock().toISOString(), kind, id: entry.id, entry });
    return entry;
  }

  /**
   * @param {object} outcome a mission outcome
   * @param {{latency_ms?: number, cost?: number, tokens?: number}} [measurements]
   * @returns {object} the run observation
   */
  observe(outcome, measurements = {}) {
    const observation = observeRun(outcome, measurements);
    this.#observations.push(observation);
    this.#write('OBSERVATION', observation);
    return observation;
  }

  /** @returns {object[]} */
  observations() {
    return this.#observations.map((observation) => ({ ...observation }));
  }

  /**
   * @returns {object} the reflection over everything observed so far
   */
  reflect() {
    const reflection = reflect({
      observations: this.#observations,
      min_support: this.minSupport,
      min_failures: this.minFailures,
      min_rate: this.minRate,
      target: this.target,
      knowledge: this.knowledge,
    });
    this.#reflections.push(reflection);
    this.#write('REFLECTION', reflection);
    for (const proposal of reflection.findings.proposals) this.#write('PROPOSAL', proposal);
    return reflection;
  }

  /** @returns {object[]} every proposal formed so far, in order */
  proposals() {
    return this.#reflections.flatMap((reflection) => reflection.findings.proposals.map((proposal) => ({ ...proposal })));
  }

  /** @returns {object[]} the append-only journal of what was noticed and proposed */
  journal() {
    return this.#journal.map((entry) => ({ ...entry }));
  }

  /**
   * The boundary, made executable. The learner has no authority to apply anything; a
   * caller looking for a shortcut must find an exception instead.
   */
  apply() {
    throw new OmegaError(
      'OMEGA_E_LEARNER_AUTHORITY',
      'a learner cannot apply a change: proposals go to replay, benchmark and the Evolution Gate, and only an activation authority may move a version',
    );
  }

  /** @returns {object} */
  describe() {
    return {
      observations: this.#observations.length,
      reflections: this.#reflections.length,
      proposals: this.proposals().length,
      target: this.target,
      thresholds: { min_support: this.minSupport, min_failures: this.minFailures, min_rate: this.minRate },
      knowledge: this.knowledge.summary(),
      journal: this.#journal.length,
    };
  }
}
