/**
 * Trust store — the only place where "peer" becomes "trusted".
 *
 * v0.1 keeps trust deliberately primitive: pin-or-reject, plus explicit revoke.
 * There is no implicit TOFU anywhere in NEXA: an unknown identity is rejected
 * with NEXA_E_UNTRUSTED until the operator pins material verified out of band
 * (e.g. by comparing `identityFingerprint`).
 */
import { NexaError, canonicalBytes } from '../../ast/index.js';
import { base58btc, sha256 } from '../../crypto/index.js';
import { verifyIdentityDocument } from './document.js';

export class TrustStore {
  #pinned = new Map();

  #revoked = new Set();

  /**
   * Pins an identity document after full cryptographic verification.
   * @param {object} document
   * @param {{expectKid?: string, expectFingerprint?: string}} [options]
   * @returns {{kid: string, label: string, fingerprint: string}}
   */
  pin(document, options = {}) {
    const verified = verifyIdentityDocument(document);
    if (options.expectKid !== undefined && options.expectKid !== document.kid) {
      throw new NexaError('NEXA_E_UNTRUSTED', 'identity key id does not match the expected pin', {
        expected: options.expectKid,
        actual: document.kid,
      });
    }
    const fingerprint = identityFingerprint(document);
    if (options.expectFingerprint !== undefined && options.expectFingerprint !== fingerprint) {
      throw new NexaError('NEXA_E_UNTRUSTED', 'identity fingerprint does not match the expected pin', {
        expected: options.expectFingerprint,
        actual: fingerprint,
      });
    }
    this.#pinned.set(verified.kid, document);
    this.#revoked.delete(verified.kid);
    return { kid: verified.kid, label: verified.label, fingerprint };
  }

  /** @param {string} kid @returns {object} the pinned document */
  require(kid) {
    if (this.#revoked.has(kid)) {
      throw new NexaError('NEXA_E_UNTRUSTED', `identity ${kid} is revoked`);
    }
    const document = this.#pinned.get(kid);
    if (document === undefined) {
      throw new NexaError('NEXA_E_UNTRUSTED', `unknown identity: ${kid}`, {
        hint: 'call trust.pin(document) with out-of-band verified material first',
      });
    }
    return document;
  }

  /** @param {string} kid @returns {boolean} */
  isTrusted(kid) {
    return this.#pinned.has(kid) && !this.#revoked.has(kid);
  }

  /** @param {string} kid */
  revoke(kid) {
    if (!this.#pinned.has(kid)) {
      throw new NexaError('NEXA_E_UNTRUSTED', `cannot revoke an unknown identity: ${kid}`);
    }
    this.#revoked.add(kid);
  }

  /** @returns {string[]} trusted key ids */
  list() {
    return [...this.#pinned.keys()].filter((kid) => !this.#revoked.has(kid)).sort();
  }

  /** @returns {number} */
  get size() {
    return this.list().length;
  }
}

/**
 * Stable, human-comparable fingerprint of an identity document.
 * Verifies the document first, then hashes its canonical form.
 * @param {object} document
 * @returns {string} `nexa:fp:` + 24 base58btc characters (≈ 140 bits)
 */
export function identityFingerprint(document) {
  verifyIdentityDocument(document);
  const digest = sha256(canonicalBytes(document));
  return `nexa:fp:${base58btc(digest).slice(0, 24)}`;
}
