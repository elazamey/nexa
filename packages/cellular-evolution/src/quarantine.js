/**
 * Quarantine — where a failed candidate goes, and stays.
 *
 * The design rule is "any adversarial-gate failure ⇒ QUARANTINE, never retry in production".
 * This store makes that mechanical: an entry can be *superseded* by a new version, but it
 * can never be released, re-tested into health, or deleted. A quarantined candidate is not
 * a todo item; it is a fact.
 */
import { OmegaError } from '../../compiler/index.js';

export const QUARANTINE_STATES = Object.freeze(['QUARANTINED', 'SUPERSEDED']);

export class Quarantine {
  #entries = new Map();

  /**
   * @param {{candidate: string, reason: string, code?: string, evidence?: string[]}} input
   * @returns {object} the entry
   */
  add({ candidate, reason, code = 'OMEGA_E_QUARANTINED', evidence = [] }) {
    if (typeof candidate !== 'string' || candidate.length === 0) {
      throw new OmegaError('OMEGA_E_SCHEMA', 'a quarantined candidate needs a name');
    }
    if (typeof reason !== 'string' || reason.length === 0) {
      throw new OmegaError('OMEGA_E_SCHEMA', 'a quarantined candidate needs a reason');
    }
    if (this.#entries.has(candidate)) {
      throw new OmegaError('OMEGA_E_VERSION_DUPLICATE', `${candidate} is already quarantined`);
    }
    const entry = { candidate, code, reason, evidence: [...evidence], state: 'QUARANTINED', superseded_by: null };
    this.#entries.set(candidate, entry);
    return { ...entry, evidence: [...entry.evidence] };
  }

  /** @param {string} candidate @returns {boolean} */
  has(candidate) {
    return this.#entries.has(candidate);
  }

  /** @param {string} candidate @returns {object} */
  get(candidate) {
    const entry = this.#entries.get(candidate);
    if (entry === undefined) throw new OmegaError('OMEGA_E_VERSION_UNKNOWN', `${candidate} is not quarantined`);
    return { ...entry, evidence: [...entry.evidence] };
  }

  /** @returns {object[]} every entry, in the order they were quarantined */
  list() {
    return [...this.#entries.values()].map((entry) => ({ ...entry, evidence: [...entry.evidence] }));
  }

  /**
   * A new version replaces the quarantined one. The old entry stays, marked superseded:
   * quarantine is a record, not a queue.
   * @param {string} candidate @param {{by: string}} input
   * @returns {object} the superseded entry
   */
  supersede(candidate, { by }) {
    const entry = this.#entries.get(candidate);
    if (entry === undefined) throw new OmegaError('OMEGA_E_VERSION_UNKNOWN', `${candidate} is not quarantined`);
    if (typeof by !== 'string' || by.length === 0) throw new OmegaError('OMEGA_E_SCHEMA', 'supersede names the new version');
    entry.state = 'SUPERSEDED';
    entry.superseded_by = by;
    return { ...entry, evidence: [...entry.evidence] };
  }

  /**
   * There is no release. A quarantined version is never activated; a new version is built
   * and gated on its own evidence.
   */
  release() {
    throw new OmegaError('OMEGA_E_QUARANTINED', 'a quarantined candidate cannot be released; build a new version and gate it');
  }
}
