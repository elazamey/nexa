/**
 * Evidence chain.
 *
 * Every decision NEXA makes — ALLOW or DENY — appends one record:
 *
 *   { seq, ts, kind, decision, subject, resource, action, capability, detail,
 *     prev, hash, sig }
 *
 * `hash` is sha256 over the canonical form of the record without `hash`/`sig`,
 * and it commits to the previous record's hash, so the log is append-only:
 * deleting, reordering or editing an entry breaks the chain at a known seq.
 * Each record is separately signed by the recording endpoint, so a single
 * receipt can be verified without shipping the whole log.
 */
import {
  NexaError,
  canonicalBytes,
  formatInstant,
  parseInstant,
  validateSignature,
  assertKid,
} from '../../ast/index.js';
import { KeyPair, publicKeyFromKeyId, randomId, sha256Multihash, verifyBytes } from '../../crypto/index.js';

export const EVIDENCE_DOMAIN = 'NEXA/0.1 evidence record\u0000';
export const GENESIS_PREV = 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export const EVIDENCE_KINDS = Object.freeze([
  'ENVELOPE_ACCEPTED',
  'ENVELOPE_REJECTED',
  'CAPABILITY_VERIFIED',
  'CAPABILITY_REJECTED',
  'POLICY_DECISION',
  'GATE_BLOCKED',
  'HANDLER_RESULT',
  'REVOCATION_RECORDED',
  'PEER_PINNED',
  'PEER_REVOKED',
]);

export const DECISIONS = Object.freeze(['ALLOW', 'DENY', 'INFO']);

const RECORD_FIELDS = Object.freeze([
  'nexa',
  'seq',
  'ts',
  'kind',
  'decision',
  'actor',
  'subject',
  'resource',
  'action',
  'capability',
  'detail',
  'prev',
  'hash',
  'sig',
]);

/** @param {object} record @returns {Buffer} */
export function recordPayload(record) {
  const { hash, sig, ...unsigned } = record; // eslint-disable-line no-unused-vars
  return Buffer.concat([Buffer.from(EVIDENCE_DOMAIN, 'utf8'), canonicalBytes(unsigned)]);
}

/** @param {object} record @returns {string} the hash a record must carry */
export function computeRecordHash(record) {
  const { hash, sig, ...unsigned } = record; // eslint-disable-line no-unused-vars
  return sha256Multihash(Buffer.concat([Buffer.from(EVIDENCE_DOMAIN, 'utf8'), canonicalBytes(unsigned)]));
}

export function validateRecordShape(record) {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw new NexaError('NEXA_E_SCHEMA', 'evidence record must be an object');
  }
  for (const key of Object.keys(record)) {
    if (!RECORD_FIELDS.includes(key)) {
      throw new NexaError('NEXA_E_SCHEMA', `unknown evidence field: ${key}`);
    }
  }
  for (const key of RECORD_FIELDS) {
    if (key === 'capability' || key === 'detail' || key === 'resource' || key === 'action') continue;
    if (!Object.hasOwn(record, key)) {
      throw new NexaError('NEXA_E_SCHEMA', `missing evidence field: ${key}`);
    }
  }
  if (record.nexa !== '0.1') {
    throw new NexaError('NEXA_E_SCHEMA', `unsupported evidence version: ${String(record.nexa)}`);
  }
  if (!Number.isSafeInteger(record.seq) || record.seq < 0) {
    throw new NexaError('NEXA_E_SCHEMA', 'evidence seq must be a non-negative integer');
  }
  parseInstant(record.ts);
  if (!EVIDENCE_KINDS.includes(record.kind)) {
    throw new NexaError('NEXA_E_SCHEMA', `unknown evidence kind: ${String(record.kind)}`);
  }
  if (!DECISIONS.includes(record.decision)) {
    throw new NexaError('NEXA_E_SCHEMA', `unknown decision: ${String(record.decision)}`);
  }
  assertKid(record.actor);
  assertKid(record.subject);
  if (!/^sha256:[A-Za-z0-9_-]{43}$/.test(record.prev)) {
    throw new NexaError('NEXA_E_SCHEMA', 'prev must be a sha256 multihash');
  }
  if (!/^sha256:[A-Za-z0-9_-]{43}$/.test(record.hash)) {
    throw new NexaError('NEXA_E_SCHEMA', 'hash must be a sha256 multihash');
  }
  validateSignature(record.sig);
  if (record.sig.kid !== record.actor) {
    throw new NexaError('NEXA_E_SIG', 'evidence record must be signed by its actor');
  }
  canonicalBytes(record.detail ?? {});
  return record;
}

/**
 * Append-only, in-memory evidence log. Durable storage is deliberately out of
 * scope for v0.1 (FILESYSTEM_WRITE is closed): callers export/import records.
 */
export class EvidenceLog {
  #records = [];

  /**
   * @param {{actor: {keys: KeyPair, kid: string}, clock?: () => Date}} input
   */
  constructor({ actor, clock } = {}) {
    if (!(actor?.keys instanceof KeyPair)) {
      throw new NexaError('NEXA_E_KEY', 'evidence log needs a signing actor with a KeyPair');
    }
    this.actor = actor;
    this.clock = clock ?? (() => new Date());
  }

  /**
   * @param {object} input
   * @param {string} input.kind
   * @param {'ALLOW'|'DENY'|'INFO'} input.decision
   * @param {string} input.subject key id the decision is about
   * @param {string} [input.resource]
   * @param {string} [input.action]
   * @param {string} [input.capability] capability id
   * @param {object} [input.detail] free-form, canonicalizable context
   * @returns {object} the sealed record
   */
  append({ kind, decision, subject, resource, action, capability, detail }) {
    const head = this.#records.at(-1);
    const record = {
      nexa: '0.1',
      seq: this.#records.length,
      ts: formatInstant(this.clock()),
      kind,
      decision,
      actor: this.actor.kid,
      subject,
      ...(resource === undefined ? {} : { resource }),
      ...(action === undefined ? {} : { action }),
      ...(capability === undefined ? {} : { capability }),
      detail: detail ?? {},
      prev: head === undefined ? GENESIS_PREV : head.hash,
    };
    const hash = computeRecordHash(record);
    const sealed = {
      ...record,
      hash,
      sig: { alg: 'ed25519', kid: this.actor.kid, val: this.actor.keys.sign(recordPayload(record)) },
    };
    validateRecordShape(sealed);
    this.#records.push(sealed);
    return sealed;
  }

  /** @returns {object} last record, or undefined */
  get head() {
    return this.#records.at(-1);
  }

  /** @returns {number} */
  get length() {
    return this.#records.length;
  }

  /** @returns {object[]} a copy of the log */
  entries() {
    return this.#records.map((record) => structuredClone(record));
  }

  /** @param {number} seq @returns {object} */
  at(seq) {
    const record = this.#records[seq];
    if (record === undefined) {
      throw new NexaError('NEXA_E_SCHEMA', `no evidence record at seq ${seq}`);
    }
    return structuredClone(record);
  }

  /** @returns {{kind: string, decision: string, count: number}[]} */
  summary() {
    const buckets = new Map();
    for (const record of this.#records) {
      const key = `${record.kind}\u0000${record.decision}`;
      const bucket = buckets.get(key) ?? { kind: record.kind, decision: record.decision, count: 0 };
      bucket.count += 1;
      buckets.set(key, bucket);
    }
    return [...buckets.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.decision.localeCompare(b.decision));
  }
}

/**
 * Full verification of a chain of records: shape, hash commitment, linkage, signature.
 * @param {object[]} records
 * @param {{expectActor?: string, expectLength?: number}} [options]
 * @returns {{ok: true, length: number, head: string, actors: string[]}}
 */
export function verifyEvidenceChain(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new NexaError('NEXA_E_SCHEMA', 'evidence chain must be an array');
  }
  const actors = new Set();
  let previousHash = GENESIS_PREV;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    validateRecordShape(record);
    if (record.seq !== index) {
      throw new NexaError('NEXA_E_SCHEMA', `evidence record out of order at position ${index}`, {
        expected_seq: index,
        actual_seq: record.seq,
      });
    }
    if (record.prev !== previousHash) {
      throw new NexaError('NEXA_E_SCHEMA', `evidence chain broken at seq ${index}`, {
        expected_prev: previousHash,
        actual_prev: record.prev,
      });
    }
    const expectedHash = computeRecordHash(record);
    if (expectedHash !== record.hash) {
      throw new NexaError('NEXA_E_SCHEMA', `evidence record ${index} was modified after sealing`);
    }
    const ok = verifyBytes(publicKeyFromKeyId(record.sig.kid), recordPayload(record), record.sig.val);
    if (!ok) {
      throw new NexaError('NEXA_E_SIG', `evidence record ${index} has an invalid signature`);
    }
    if (options.expectActor !== undefined && record.actor !== options.expectActor) {
      throw new NexaError('NEXA_E_UNTRUSTED', `evidence record ${index} was emitted by another actor`);
    }
    actors.add(record.actor);
    previousHash = record.hash;
  }
  if (options.expectLength !== undefined && records.length !== options.expectLength) {
    throw new NexaError('NEXA_E_SCHEMA', 'evidence chain length mismatch', {
      expected: options.expectLength,
      actual: records.length,
    });
  }
  return {
    ok: true,
    length: records.length,
    head: previousHash,
    actors: [...actors].sort(),
  };
}

/** @param {string} prefix @returns {string} */
export function evidenceId(prefix = 'urn:nexa:ev:') {
  return randomId(prefix);
}
