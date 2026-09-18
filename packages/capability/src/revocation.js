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

export class RevocationSet {
  #records = new Map();

  /**
   * Adds a record after verification. A record for a capability id we already
   * revoked is ignored (idempotent), a conflicting one from another issuer is rejected.
   * @param {object} record
   * @returns {{added: boolean, cap: string}}
   */
  add(record) {
    const verified = verifyRevocation(record);
    const existing = this.#records.get(verified.cap);
    if (existing !== undefined && existing.issuer !== verified.issuer) {
      throw new NexaError('NEXA_E_UNTRUSTED', 'conflicting revocation issuers for the same capability');
    }
    if (existing !== undefined) return { added: false, cap: verified.cap };
    this.#records.set(verified.cap, verified);
    return { added: true, cap: verified.cap };
  }

  /** @param {string} capId @returns {boolean} */
  has(capId) {
    return this.#records.has(capId);
  }

  /** @param {object} token @returns {boolean} true when any link of the chain is revoked */
  hasAnyInChain(token) {
    let cursor = token;
    for (;;) {
      if (this.#records.has(cursor.id)) return true;
      if (cursor.proof.kind !== 'chain') return false;
      cursor = cursor.proof.parent;
    }
  }

  /** @returns {string[]} revoked capability ids */
  ids() {
    return [...this.#records.keys()].sort();
  }

  /** @returns {Set<string>} view for `verifyCapability({ revoked })` */
  asSet() {
    return new Set(this.#records.keys());
  }

  /** @returns {number} */
  get size() {
    return this.#records.size;
  }
}
