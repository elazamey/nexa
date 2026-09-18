/**
 * Replay protection.
 *
 * Two independent keys must both be fresh: the message id and the nonce.
 * Entries live only as long as the envelope could still be valid, so the guard
 * is bounded in memory without a background sweep (pruning happens on write).
 */
import { NexaError, parseInstant } from '../../ast/index.js';

export class ReplayGuard {
  #seenIds = new Map();

  #seenNonces = new Map();

  /**
   * @param {{windowSeconds?: number}} [options] window must be >= the maximum envelope TTL
   */
  constructor({ windowSeconds = 300 } = {}) {
    if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1) {
      throw new NexaError('NEXA_E_SCHEMA', 'replay window must be a positive integer');
    }
    this.windowSeconds = windowSeconds;
  }

  /**
   * Records an envelope as seen. Throws NEXA_E_REPLAY when it was seen before.
   * Call this *after* signature verification: unauthenticated data must never
   * consume replay slots (that would be a cheap denial-of-service).
   * @param {object} envelope
   * @param {Date} [now]
   * @returns {{ok: true, id: string, nonce: string}}
   */
  commit(envelope, now = new Date()) {
    this.#prune(now);
    if (this.#seenIds.has(envelope.id)) {
      throw new NexaError('NEXA_E_REPLAY', `message id ${envelope.id} was already processed`);
    }
    if (this.#seenNonces.has(envelope.nonce)) {
      throw new NexaError('NEXA_E_REPLAY', `nonce ${envelope.nonce} was already used`);
    }
    const expiresAt = parseInstant(envelope.exp);
    this.#seenIds.set(envelope.id, expiresAt);
    this.#seenNonces.set(envelope.nonce, expiresAt);
    return { ok: true, id: envelope.id, nonce: envelope.nonce };
  }

  /** @param {object} envelope @returns {boolean} */
  hasSeen(envelope) {
    return this.#seenIds.has(envelope.id) || this.#seenNonces.has(envelope.nonce);
  }

  /** @param {Date} [now] */
  #prune(now = new Date()) {
    const cutoff = now.getTime();
    for (const map of [this.#seenIds, this.#seenNonces]) {
      for (const [key, expiresAt] of map) {
        if (expiresAt <= cutoff) map.delete(key);
      }
    }
  }

  /** @returns {{ids: number, nonces: number}} */
  get size() {
    return { ids: this.#seenIds.size, nonces: this.#seenNonces.size };
  }
}
