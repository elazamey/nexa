/**
 * Ω memory: six tiers, digests not payloads.
 *
 * Two properties are deliberate:
 *
 *   1. Ω v1 stores a *hash* of what was learned plus its metadata — never the value.
 *      Memory therefore cannot become a leak channel, and it cannot be replayed as
 *      evidence: it is a ledger of what happened, not a store of what was seen.
 *   2. Memory is reached only through the kernel (`memory:<tier>`), so `remember` and
 *      `recall` need a capability like everything else, and both are recorded.
 */
import { OmegaError } from '../../compiler/index.js';
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';

export const MEMORY_TIER_NAMES = Object.freeze([
  'working', 'episodic', 'semantic', 'procedural', 'meta', 'evolution',
]);

export class Memory {
  #tiers;

  /**
   * @param {{tiers?: Record<string, object[]>}} [input]
   */
  constructor({ tiers = {} } = {}) {
    this.#tiers = new Map();
    for (const tier of MEMORY_TIER_NAMES) {
      this.#tiers.set(tier, Array.isArray(tiers[tier]) ? tiers[tier].map((entry) => ({ ...entry })) : []);
    }
    for (const tier of Object.keys(tiers)) {
      if (!MEMORY_TIER_NAMES.includes(tier)) {
        throw new OmegaError('OMEGA_E_SCHEMA', `unknown memory tier: ${tier}`, { known: [...MEMORY_TIER_NAMES] });
      }
    }
  }

  /** @param {string} tier @returns {object[]} */
  entries(tier) {
    const found = this.#tiers.get(tier);
    if (found === undefined) throw new OmegaError('OMEGA_E_SCHEMA', `unknown memory tier: ${tier}`);
    return found.map((entry) => ({ ...entry }));
  }

  /** @param {string} tier @param {object} entry @returns {object} */
  write(tier, entry) {
    const found = this.#tiers.get(tier);
    if (found === undefined) throw new OmegaError('OMEGA_E_SCHEMA', `unknown memory tier: ${tier}`);
    if (typeof entry?.value_hash !== 'string') {
      throw new OmegaError('OMEGA_E_SCHEMA', 'a memory entry needs a value_hash (values themselves are never stored)');
    }
    found.push({ ...entry });
    return { tier, entries: found.length, digest: this.digest(tier) };
  }

  /** @param {string} tier @returns {{tier: string, entries: number, digest: string}} */
  read(tier) {
    const found = this.#tiers.get(tier);
    if (found === undefined) throw new OmegaError('OMEGA_E_SCHEMA', `unknown memory tier: ${tier}`);
    return { tier, entries: found.length, digest: this.digest(tier) };
  }

  /** @param {string} tier @returns {string} */
  digest(tier) {
    const found = this.#tiers.get(tier);
    if (found === undefined) throw new OmegaError('OMEGA_E_SCHEMA', `unknown memory tier: ${tier}`);
    return sha256Multihash(canonicalBytes(found.length === 0 ? [] : found));
  }

  /** @returns {object} a compact view for a planner port or a report */
  summary() {
    const tiers = {};
    for (const tier of MEMORY_TIER_NAMES) {
      const found = this.#tiers.get(tier);
      tiers[tier] = { entries: found.length, digest: this.digest(tier) };
    }
    return { tiers };
  }
}
