/**
 * The Ω evidence ledger.
 *
 * Same construction as the kernel's evidence chain — hash-linked, individually signed,
 * append-only — with a different domain separator, so an Ω record can never be mistaken
 * for a kernel record and vice versa. The kernel records *decisions*; this ledger
 * records *reasoning* (what was claimed, observed, proven and concluded), and it points
 * at kernel decisions by hash and receipt id instead of restating them.
 */
import {
  NexaError,
  canonicalBytes,
  formatInstant,
  parseInstant,
} from '../../ast/index.js';
import { KeyPair, publicKeyFromKeyId, sha256Multihash, verifyBytes } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';

export const OMEGA_EVIDENCE_DOMAIN = 'NEXA/omega1 evidence record\u0000';
export const OMEGA_GENESIS_PREV = 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export const OMEGA_EVIDENCE_KINDS = Object.freeze([
  'MISSION_START', // the run began: module hash, agent, goal, plan
  'PLAN', // the declared plan, and the planner port's answer if one is installed
  'OBSERVATION', // `observe <key>`: a reading of the world model
  'TOOL_CALL', // a capability-gated call is about to happen
  'TOOL_RESULT', // the kernel's answer, with its record hash and receipt id
  'GATE_REFUSAL', // a closed hard gate refused the call (the kernel's own code)
  'CIRCUIT_OPEN', // the breaker isolated a failing resource
  'DECLASSIFY', // `untaint`: trust was raised or secrecy lowered, on the record
  'SEAL', // a secret was sealed
  'MEMORY_WRITE', // a value hash entered a memory tier
  'MEMORY_READ', // a memory tier was read as a reference
  'CLAIM', // a sentence, explicitly not a fact
  'EVIDENCE', // a verified value promoted to evidence
  'ASSERT', // a run-time assertion
  'CONTRACT_UNMET', // a `require evidence` contract has no evidence
  'VERDICT', // the mission's conclusion (ALLOW / DENY) with its reason
  'MISSION_END', // the run finished: steps, records, duration
  'PROPOSAL', // an evolution proposal was created
  'GATE', // an Evolution Gate verdict
  'CANARY', // a canary observation
  'ACTIVATION', // a version was activated
  'ROLLBACK', // a version was rolled back
  'QUARANTINE', // a candidate was set aside with a reason
  'HEAL', // a failure was classified, isolated, substituted or recovered
  // --- cellular layer: a crossing is a record, whichever layer it crossed -----
  'CELL_MESSAGE', // a message crossed a membrane; the payload itself stays out, its digest goes in
  'CELL_LIFECYCLE', // a cell changed state, with the cause
  'HOMEOSTASIS', // the organ read the system and acted on the reading
]);

export const OMEGA_DECISIONS = Object.freeze(['ALLOW', 'DENY', 'INFO']);

const RECORD_FIELDS = Object.freeze([
  'nexa', 'seq', 'ts', 'kind', 'decision', 'actor', 'module', 'mission', 'step',
  'subject', 'resource', 'action', 'capability', 'claim', 'trust', 'detail',
  'prev', 'hash', 'sig',
]);

const REQUIRED_FIELDS = Object.freeze([
  'nexa', 'seq', 'ts', 'kind', 'decision', 'actor', 'module', 'mission', 'step', 'prev', 'hash', 'sig',
]);

const HASH_RE = /^sha256:[A-Za-z0-9_-]{43}$/;

/** @param {object} record @returns {Buffer} the bytes a record's hash and signature cover */
export function omegaRecordPayload(record) {
  const { hash, sig, ...unsigned } = record; // eslint-disable-line no-unused-vars
  return Buffer.concat([Buffer.from(OMEGA_EVIDENCE_DOMAIN, 'utf8'), canonicalBytes(unsigned)]);
}

/** @param {object} record @returns {string} */
export function computeOmegaHash(record) {
  return sha256Multihash(omegaRecordPayload(record));
}

/** @param {object} record @returns {object} the same record, validated */
export function validateOmegaRecord(record) {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw new OmegaError('OMEGA_E_LEDGER', 'an Ω record must be an object');
  }
  for (const key of Object.keys(record)) {
    if (!RECORD_FIELDS.includes(key)) {
      throw new OmegaError('OMEGA_E_LEDGER', `unknown Ω record field: ${key}`);
    }
  }
  for (const key of REQUIRED_FIELDS) {
    if (!Object.hasOwn(record, key)) {
      throw new OmegaError('OMEGA_E_LEDGER', `missing Ω record field: ${key}`);
    }
  }
  if (record.nexa !== 'omega1') throw new OmegaError('OMEGA_E_LEDGER', `unsupported Ω record version: ${String(record.nexa)}`);
  if (!Number.isSafeInteger(record.seq) || record.seq < 0) throw new OmegaError('OMEGA_E_LEDGER', 'seq must be a non-negative integer');
  if (!Number.isSafeInteger(record.step) || record.step < 0) throw new OmegaError('OMEGA_E_LEDGER', 'step must be a non-negative integer');
  parseInstant(record.ts);
  if (!OMEGA_EVIDENCE_KINDS.includes(record.kind)) throw new OmegaError('OMEGA_E_LEDGER', `unknown Ω record kind: ${String(record.kind)}`);
  if (!OMEGA_DECISIONS.includes(record.decision)) throw new OmegaError('OMEGA_E_LEDGER', `unknown decision: ${String(record.decision)}`);
  if (typeof record.actor !== 'string' || record.actor.length === 0) throw new OmegaError('OMEGA_E_LEDGER', 'actor must be a key id');
  if (!HASH_RE.test(record.prev)) throw new OmegaError('OMEGA_E_LEDGER', 'prev must be a sha256 multihash');
  if (!HASH_RE.test(record.hash)) throw new OmegaError('OMEGA_E_LEDGER', 'hash must be a sha256 multihash');
  if (typeof record.sig !== 'object' || record.sig === null) throw new OmegaError('OMEGA_E_LEDGER', 'sig must be an object');
  if (record.sig.kid !== record.actor) throw new OmegaError('OMEGA_E_SIGNATURE', 'an Ω record must be signed by its actor');
  canonicalBytes(record.detail ?? {});
  return record;
}

/**
 * Append-only, in-memory Ω ledger. Durable storage is the caller's business (the
 * kernel's FILESYSTEM_WRITE gate is closed and Ω does not reopen it) via `entries()`.
 */
export class OmegaLedger {
  #records = [];

  /**
   * @param {{actor: {keys: KeyPair, kid: string}, clock?: () => Date, module?: string}} input
   */
  constructor({ actor, clock, module = null } = {}) {
    if (!(actor?.keys instanceof KeyPair)) {
      throw new OmegaError('OMEGA_E_LEDGER', 'the Ω ledger needs a signing actor with a KeyPair');
    }
    this.actor = actor;
    this.clock = clock ?? (() => new Date());
    this.module = module;
  }

  /** @returns {number} */
  get length() {
    return this.#records.length;
  }

  /** @returns {object} the last record, or a genesis-shaped placeholder */
  get head() {
    if (this.#records.length === 0) return { seq: -1, hash: OMEGA_GENESIS_PREV };
    return this.#records[this.#records.length - 1];
  }

  /** @returns {object[]} a copy of every record */
  entries() {
    return this.#records.map((record) => ({ ...record }));
  }

  /** @param {number} seq @returns {object} */
  at(seq) {
    const record = this.#records[seq];
    if (record === undefined || record.seq !== seq) {
      throw new OmegaError('OMEGA_E_LEDGER', `no Ω record at seq ${seq}`);
    }
    return { ...record };
  }

  /**
   * @param {object} input
   * @param {string} input.kind
   * @param {'ALLOW'|'DENY'|'INFO'} input.decision
   * @param {string} [input.mission]
   * @param {number} [input.step]
   * @param {string} [input.subject]
   * @param {string} [input.resource]
   * @param {string} [input.action]
   * @param {string} [input.capability]
   * @param {string} [input.claim]
   * @param {string} [input.trust]
   * @param {object} [input.detail]
   * @returns {object} the sealed record
   */
  append(input) {
    for (const key of Object.keys(input)) {
      if (['kind', 'decision', 'mission', 'step', 'subject', 'resource', 'action', 'capability', 'claim', 'trust', 'detail'].includes(key)) continue;
      // Silently dropping a field would produce a transcript that under-reports what
      // happened, so an unknown key is a caller bug and fails loudly.
      throw new OmegaError('OMEGA_E_LEDGER', `unknown Ω record input: ${key}`);
    }
    const unsigned = {
      nexa: 'omega1',
      seq: this.#records.length,
      ts: formatInstant(this.clock()),
      kind: input.kind,
      decision: input.decision,
      actor: this.actor.kid,
      module: this.module ?? '<inline>',
      mission: input.mission ?? '-',
      step: input.step ?? 0,
      ...(input.subject === undefined ? {} : { subject: input.subject }),
      ...(input.resource === undefined ? {} : { resource: input.resource }),
      ...(input.action === undefined ? {} : { action: input.action }),
      ...(input.capability === undefined ? {} : { capability: input.capability }),
      ...(input.claim === undefined ? {} : { claim: input.claim }),
      ...(input.trust === undefined ? {} : { trust: input.trust }),
      ...(input.detail === undefined ? {} : { detail: input.detail }),
    };
    // `prev` is part of what the hash commits to, exactly like the kernel's chain:
    // a record re-sequenced or re-parented anywhere breaks verification.
    const chained = { ...unsigned, prev: this.head.hash };
    const record = { ...chained, hash: computeOmegaHash(chained) };
    record.sig = {
      kind: 'ed25519',
      alg: 'ed25519',
      kid: this.actor.kid,
      val: this.actor.keys.sign(omegaRecordPayload(record)),
    };
    validateOmegaRecord(record);
    this.#records.push(record);
    return { ...record };
  }

  /** @returns {object} a compact, loggable summary */
  summary() {
    const byKind = {};
    for (const record of this.#records) byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
    return {
      records: this.#records.length,
      head: this.head.hash,
      decisions: {
        allow: this.#records.filter((record) => record.decision === 'ALLOW').length,
        deny: this.#records.filter((record) => record.decision === 'DENY').length,
        info: this.#records.filter((record) => record.decision === 'INFO').length,
      },
      kinds: byKind,
    };
  }
}

/**
 * Verifies a whole chain in order: sequence, linkage, hash, signature and actor.
 * @param {object[]} records
 * @param {{expectActor?: string}} [options]
 * @returns {{ok: true, length: number, head: string} | {ok: false, reason: string}}
 */
export function verifyOmegaChain(records, { expectActor = undefined } = {}) {
  try {
    if (!Array.isArray(records)) return { ok: false, reason: 'records must be an array' };
    let prev = OMEGA_GENESIS_PREV;
    let actor = expectActor ?? null;
    records.forEach((record, index) => {
      validateOmegaRecord(record);
      if (record.seq !== index) throw new OmegaError('OMEGA_E_CHAIN_BROKEN', `record ${index} has seq ${record.seq}`);
      if (record.prev !== prev) throw new OmegaError('OMEGA_E_CHAIN_BROKEN', `record ${index} is not linked to its predecessor`);
      const expected = computeOmegaHash(record);
      if (expected !== record.hash) throw new OmegaError('OMEGA_E_CHAIN_BROKEN', `record ${index} was modified after sealing`);
      const signatureOk = verifyBytes(publicKeyFromKeyId(record.sig.kid), omegaRecordPayload(record), record.sig.val);
      if (!signatureOk) throw new OmegaError('OMEGA_E_SIGNATURE', `record ${index} has an invalid signature`);
      if (actor === null) actor = record.actor;
      if (record.actor !== actor) throw new OmegaError('OMEGA_E_CHAIN_BROKEN', `record ${index} was emitted by another actor`);
      prev = record.hash;
    });
    return { ok: true, length: records.length, head: prev };
  } catch (cause) {
    const error = cause instanceof OmegaError || cause instanceof NexaError
      ? cause
      : new OmegaError('OMEGA_E_CHAIN_BROKEN', String(cause));
    return { ok: false, reason: `${error.code}: ${error.message}` };
  }
}

/** @param {object[]} records @param {{expectActor?: string}} [options] */
export function assertOmegaChain(records, options) {
  const result = verifyOmegaChain(records, options);
  if (!result.ok) throw new OmegaError('OMEGA_E_CHAIN_BROKEN', result.reason);
  return result;
}
