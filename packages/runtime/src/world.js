/**
 * Ω world model.
 *
 * The world is whatever the host says it is: a frozen, canonicalizable object provided
 * at runtime. A mission may *observe* it — and an observation is recorded as an
 * `OBSERVATION`, never promoted to evidence, because seeing something is not the same
 * as proving it. The compiled module only ever names the keys it observes, and each key
 * is a capability-gated resource (`world:<key>`).
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';

export class World {
  #state;

  /** @param {{state?: Record<string, unknown>}} [input] */
  constructor({ state = {} } = {}) {
    if (typeof state !== 'object' || state === null || Array.isArray(state)) {
      throw new OmegaError('OMEGA_E_SCHEMA', 'the world model must be a plain object of keys');
    }
    const copy = {};
    for (const key of Object.keys(state).sort()) {
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(key)) {
        throw new OmegaError('OMEGA_E_SCHEMA', `invalid world key: ${key} (world keys are resources: world:<key>)`);
      }
      canonicalBytes(state[key] ?? {}); // refuse anything a record could not commit to
      copy[key] = state[key];
    }
    this.#state = Object.freeze(copy);
  }

  /** @returns {string[]} */
  keys() {
    return Object.keys(this.#state);
  }

  /** @param {string} key @returns {boolean} */
  has(key) {
    return Object.hasOwn(this.#state, key);
  }

  /**
   * @param {string} key
   * @returns {{key: string, present: boolean, digest: string, value: unknown}}
   */
  observe(key) {
    if (!Object.hasOwn(this.#state, key)) {
      throw new OmegaError('OMEGA_E_SCHEMA', `the world model has no key "${key}"`, { known: this.keys() });
    }
    const value = this.#state[key];
    return {
      key,
      present: true,
      digest: sha256Multihash(canonicalBytes(value ?? {})),
      value,
    };
  }

  /** @returns {object} */
  summary() {
    const digest = sha256Multihash(canonicalBytes(this.#state));
    return { keys: this.keys(), digest };
  }
}
