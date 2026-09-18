/**
 * Revocation.
 *
 * NEXA capabilities are offline-verifiable, so revocation cannot be a lookup in
 * the issuer's database at use time. Instead an issuer publishes signed
 * revocation records; verifiers keep the set they have seen and pass it to
 * `verifyCapability({ revoked })`. Revoking a root revokes the whole chain,
 * because every link id is checked.
 */
import {
  NexaError,
  canonicalBytes,
  formatInstant,
  parseInstant,
  validateSignature,
  assertCapabilityId,
  assertKid,
} from '../../ast/index.js';
import { KeyPair, publicKeyFromKeyId, verifyBytes } from '../../crypto/index.js';
import { REVOCATION_DOMAIN } from './token.js';

export const REVOCATION_FIELDS = Object.freeze(['nexa', 'cap', 'issuer', 'ts', 'reason', 'sig']);

const REASONS = Object.freeze(['compromised', 'superseded', 'expired_early', 'operator_request']);

/** @param {object} record @returns {Buffer} */
export function revocationPayload(record) {
  const { sig, ...unsigned } = record; // eslint-disable-line no-unused-vars
  return Buffer.concat([Buffer.from(REVOCATION_DOMAIN, 'utf8'), canonicalBytes(unsigned)]);
}

/**
 * @param {{cap: string, issuer: {keys: KeyPair, kid: string}, reason?: string, ts?: string}} input
 * @returns {object} signed revocation record
 */
export function createRevocation({ cap, issuer, reason = 'operator_request', ts }) {
  if (!(issuer?.keys instanceof KeyPair)) {
    throw new NexaError('NEXA_E_KEY', 'revocation must be signed by a KeyPair');
  }
  assertCapabilityId(cap);
  if (!REASONS.includes(reason)) {
    throw new NexaError('NEXA_E_SCHEMA', `unknown revocation reason: ${String(reason)}`);
  }
  const record = {
    nexa: '0.1',
    cap,
    issuer: issuer.kid,
    ts: ts ?? formatInstant(new Date()),
    reason,
  };
  return { ...record, sig: { alg: 'ed25519', kid: issuer.kid, val: issuer.keys.sign(revocationPayload(record)) } };
}

/**
 * @param {unknown} record
 * @param {{capId?: string, issuerKid?: string}} [expect]
 * @returns {{ok: true, cap: string, issuer: string, ts: string, reason: string}}
 */
export function verifyRevocation(record, expect = {}) {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw new NexaError('NEXA_E_SCHEMA', 'revocation record must be an object');
  }
  for (const key of Object.keys(record)) {
    if (!REVOCATION_FIELDS.includes(key)) {
      throw new NexaError('NEXA_E_SCHEMA', `unknown revocation field: ${key}`);
    }
  }
  if (record.nexa !== '0.1') {
    throw new NexaError('NEXA_E_SCHEMA', `unsupported revocation version: ${String(record.nexa)}`);
  }
  assertCapabilityId(record.cap);
  assertKid(record.issuer);
  parseInstant(record.ts);
  if (!REASONS.includes(record.reason)) {
    throw new NexaError('NEXA_E_SCHEMA', `unknown revocation reason: ${String(record.reason)}`);
  }
  validateSignature(record.sig);
  if (record.sig.kid !== record.issuer) {
    throw new NexaError('NEXA_E_SIG', 'revocation must be signed by its issuer');
  }
  if (expect.capId !== undefined && expect.capId !== record.cap) {
    throw new NexaError('NEXA_E_SCHEMA', 'revocation is for a different capability');
  }
  if (expect.issuerKid !== undefined && expect.issuerKid !== record.issuer) {
    throw new NexaError('NEXA_E_UNTRUSTED', 'revocation issuer is not the expected one');
  }
  const ok = verifyBytes(publicKeyFromKeyId(record.issuer), revocationPayload(record), record.sig.val);
  if (!ok) {
    throw new NexaError('NEXA_E_SIG', 'revocation signature is invalid');
  }
  return { ok: true, cap: record.cap, issuer: record.issuer, ts: record.ts, reason: record.reason };
}

/**
 * A collection of verified revocation records.
 *
 * A record is only *evidence of revocation* when its issuer was entitled to revoke
 * that capability — the issuer of the capability itself, or of a link below it.
 * Anyone can sign a record naming any capability id, so membership alone is not
 * attribution: `revokes(id, chainIssuers)` answers the question that matters, and it
 * is what `verifyCapability` calls.
 */
export class RevocationSet {
  /** @type {Map<string, Map<string, object>>} capId -> issuerKid -> record */
  #byCapability = new Map();

  /**
   * Adds a record after verifying its signature. Adding the same record twice is
   * idempotent; a record from an issuer outside `issuers` (when supplied) is refused.
   * @param {object} record
   * @param {{issuers?: string[]}} [options]
   * @returns {{added: boolean, cap: string, issuer: string}}
   */
  add(record, { issuers } = {}) {
    const verified = verifyRevocation(record);
    if (issuers !== undefined && !issuers.includes(verified.issuer)) {
      throw new NexaError('NEXA_E_UNTRUSTED', 'revocation issuer is not an accepted authority', {
        issuer: verified.issuer,
        accepted: [...issuers].sort(),
      });
    }
    const bucket = this.#byCapability.get(verified.cap) ?? new Map();
    if (bucket.has(verified.issuer)) {
      return { added: false, cap: verified.cap, issuer: verified.issuer };
    }
    bucket.set(verified.issuer, verified);
    this.#byCapability.set(verified.cap, bucket);
    return { added: true, cap: verified.cap, issuer: verified.issuer };
  }

  /**
   * @param {string} capId
   * @param {{issuers?: string[]}} [options] when supplied, only records from these
   *   issuers count — this is the attributed form and the one to prefer.
   * @returns {boolean}
   */
  has(capId, { issuers } = {}) {
    const bucket = this.#byCapability.get(capId);
    if (bucket === undefined) return false;
    if (issuers === undefined) return bucket.size > 0;
    return [...bucket.keys()].some((issuer) => issuers.includes(issuer));
  }

  /** @param {string} capId @returns {string[]} every issuer that signed a record for it */
  issuersOf(capId) {
    const bucket = this.#byCapability.get(capId);
    return bucket === undefined ? [] : [...bucket.keys()].sort();
  }

  /** @param {object} token @returns {boolean} true when any link of the chain is revoked */
  hasAnyInChain(token, options = {}) {
    let cursor = token;
    const issuers = [];
    for (;;) {
      issuers.push(cursor.issuer);
      if (this.has(cursor.id, { issuers })) return true;
      if (cursor.proof.kind !== 'chain') return false;
      cursor = cursor.proof.parent;
    }
    void options;
  }

  /**
   * Attributed check used by `verifyCapability`: the record must come from an issuer
   * that appears in this chain, otherwise it is ignored rather than obeyed.
   * @param {string} capId
   * @param {string[]} chainIssuers
   * @returns {boolean}
   */
  revokes(capId, chainIssuers) {
    return this.has(capId, { issuers: chainIssuers });
  }

  /** @returns {string[]} revoked capability ids */
  ids() {
    return [...this.#byCapability.keys()].sort();
  }

  /** @returns {{cap: string, issuer: string, ts: string, reason: string}[]} */
  records() {
    const out = [];
    for (const bucket of this.#byCapability.values()) {
      for (const record of bucket.values()) out.push({ cap: record.cap, issuer: record.issuer, ts: record.ts, reason: record.reason });
    }
    return out.sort((a, b) => a.cap.localeCompare(b.cap) || a.issuer.localeCompare(b.issuer));
  }

  /** @returns {Set<string>} unattributed view, for callers that only need membership */
  asSet() {
    return new Set(this.#byCapability.keys());
  }

  /** @returns {number} number of revoked capabilities, not of records */
  get size() {
    return this.#byCapability.size;
  }
}
