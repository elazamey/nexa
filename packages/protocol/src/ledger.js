/**
 * Use ledger.
 *
 * Capabilities carry a `max_uses` budget. The budget is spent per *link* of the
 * chain: a delegated capability consumes both its own budget and its parent's,
 * so redelegation can never multiply authority.
 */
import { NexaError } from '../../ast/index.js';

export class UsageLedger {
  #counts = new Map();

  /** @param {string} capabilityId @returns {number} */
  used(capabilityId) {
    return this.#counts.get(capabilityId) ?? 0;
  }

  /**
   * Debits every id in the chain at once — all or nothing.
   * @param {string[]} chainIds root-first
   * @param {object[]} caveats the matching caveats, same order
   * @returns {{ok: true, spent: {id: string, used: number, max_uses: number}[]}}
   */
  spend(chainIds, caveats) {
    if (chainIds.length !== caveats.length) {
      throw new NexaError('NEXA_E_SCHEMA', 'ledger spend requires one caveat per chain id');
    }
    for (let index = 0; index < chainIds.length; index += 1) {
      const id = chainIds[index];
      const maxUses = caveats[index].max_uses;
      if (this.used(id) + 1 > maxUses) {
        throw new NexaError('NEXA_E_CAP_USES', `capability ${id} exhausted its use budget`, {
          id,
          used: this.used(id),
          max_uses: maxUses,
        });
      }
    }
    const spent = [];
    for (let index = 0; index < chainIds.length; index += 1) {
      const id = chainIds[index];
      const next = this.used(id) + 1;
      this.#counts.set(id, next);
      spent.push({ id, used: next, max_uses: caveats[index].max_uses });
    }
    return { ok: true, spent };
  }

  /** @param {string} capabilityId */
  release(capabilityId) {
    const current = this.used(capabilityId);
    if (current === 0) return 0;
    // Drop the entry at zero so a long-lived endpoint does not accumulate ids
    // it no longer knows anything about.
    if (current === 1) this.#counts.delete(capabilityId);
    else this.#counts.set(capabilityId, current - 1);
    return current - 1;
  }

  /** @returns {number} */
  get size() {
    return this.#counts.size;
  }

  /** @returns {{id: string, used: number}[]} */
  snapshot() {
    return [...this.#counts.entries()]
      .map(([id, used]) => ({ id, used }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
