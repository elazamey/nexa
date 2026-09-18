/**
 * Receipts.
 *
 * A receipt is the portable proof that a decision happened: it names the
 * decision, the evidence record that carries it, and the chain head at the time
 * of signing. A verifier holding only the receipt (plus optionally the log) can
 * check who decided what, when, and under which capability.
 */
import {
  NexaError,
  canonicalBytes,
  formatInstant,
  parseInstant,
  validateSignature,
  assertKid,
  assertMessageId,
  assertCapabilityId,
} from '../../ast/index.js';
import { KeyPair, publicKeyFromKeyId, randomId, verifyBytes } from '../../crypto/index.js';

export const RECEIPT_DOMAIN = 'NEXA/0.1 receipt\u0000';
export const RECEIPT_FIELDS = Object.freeze([
  'nexa',
  'id',
  'decision',
  'evidence_seq',
  'evidence_hash',
  'chain_head',
  'capability',
  'actor',
  'subject',
  'ts',
  'sig',
]);
export const RECEIPT_DECISIONS = Object.freeze(['ALLOW', 'DENY']);

/** @param {object} receipt @returns {Buffer} */
export function receiptPayload(receipt) {
  const { sig, ...unsigned } = receipt; // eslint-disable-line no-unused-vars
  return Buffer.concat([Buffer.from(RECEIPT_DOMAIN, 'utf8'), canonicalBytes(unsigned)]);
}

/**
 * @param {object} input
 * @param {object} input.record a sealed evidence record
 * @param {{keys: KeyPair, kid: string}} input.actor
 * @param {string} [input.chainHead]
 * @param {string} [input.id]
 * @param {string} [input.ts]
 * @returns {object} signed receipt
 */
export function createReceipt({ record, actor, chainHead, id, ts }) {
  if (!(actor?.keys instanceof KeyPair)) {
    throw new NexaError('NEXA_E_KEY', 'receipt must be signed by a KeyPair');
  }
  if (record?.decision !== 'ALLOW' && record?.decision !== 'DENY') {
    throw new NexaError('NEXA_E_SCHEMA', 'only ALLOW/DENY decisions produce receipts');
  }
  const receipt = {
    nexa: '0.1',
    id: id ?? randomId('urn:nexa:msg:'),
    decision: record.decision,
    evidence_seq: record.seq,
    evidence_hash: record.hash,
    chain_head: chainHead ?? record.hash,
    ...(record.capability === undefined ? {} : { capability: record.capability }),
    actor: actor.kid,
    subject: record.subject,
    ts: ts ?? formatInstant(new Date()),
  };
  const signed = {
    ...receipt,
    sig: { alg: 'ed25519', kid: actor.kid, val: actor.keys.sign(receiptPayload(receipt)) },
  };
  return verifyReceipt(signed).receipt;
}

/**
 * @param {unknown} receipt
 * @returns {{ok: true, receipt: object, summary: object}}
 */
export function verifyReceipt(receipt) {
  if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
    throw new NexaError('NEXA_E_SCHEMA', 'receipt must be an object');
  }
  for (const key of Object.keys(receipt)) {
    if (!RECEIPT_FIELDS.includes(key)) {
      throw new NexaError('NEXA_E_SCHEMA', `unknown receipt field: ${key}`);
    }
  }
  if (receipt.nexa !== '0.1') {
    throw new NexaError('NEXA_E_SCHEMA', `unsupported receipt version: ${String(receipt.nexa)}`);
  }
  assertMessageId(receipt.id);
  if (!RECEIPT_DECISIONS.includes(receipt.decision)) {
    throw new NexaError('NEXA_E_SCHEMA', `receipt decision must be ALLOW or DENY`);
  }
  if (!Number.isSafeInteger(receipt.evidence_seq) || receipt.evidence_seq < 0) {
    throw new NexaError('NEXA_E_SCHEMA', 'evidence_seq must be a non-negative integer');
  }
  for (const field of ['evidence_hash', 'chain_head']) {
    if (!/^sha256:[A-Za-z0-9_-]{43}$/.test(receipt[field])) {
      throw new NexaError('NEXA_E_SCHEMA', `${field} must be a sha256 multihash`);
    }
  }
  if (receipt.capability !== undefined) assertCapabilityId(receipt.capability);
  assertKid(receipt.actor);
  assertKid(receipt.subject);
  parseInstant(receipt.ts);
  validateSignature(receipt.sig);
  if (receipt.sig.kid !== receipt.actor) {
    throw new NexaError('NEXA_E_SIG', 'receipt must be signed by its actor');
  }
  const ok = verifyBytes(publicKeyFromKeyId(receipt.actor), receiptPayload(receipt), receipt.sig.val);
  if (!ok) {
    throw new NexaError('NEXA_E_SIG', 'receipt signature is invalid');
  }
  return {
    ok: true,
    receipt,
    summary: {
      id: receipt.id,
      decision: receipt.decision,
      actor: receipt.actor,
      subject: receipt.subject,
      capability: receipt.capability ?? null,
      evidence_seq: receipt.evidence_seq,
      evidence_hash: receipt.evidence_hash,
      ts: receipt.ts,
    },
  };
}

/**
 * Cross-checks a receipt against the evidence record it claims to describe.
 * This is the link between the portable receipt and the append-only log.
 * @param {object} receipt
 * @param {object} record
 * @returns {{ok: true}}
 */
export function matchReceiptToRecord(receipt, record) {
  const { receipt: verified } = verifyReceipt(receipt);
  if (record.seq !== verified.evidence_seq) {
    throw new NexaError('NEXA_E_SCHEMA', 'receipt points at a different evidence seq');
  }
  if (record.hash !== verified.evidence_hash) {
    throw new NexaError('NEXA_E_SCHEMA', 'receipt points at a different evidence hash');
  }
  if (record.decision !== verified.decision) {
    throw new NexaError('NEXA_E_SCHEMA', 'receipt decision does not match the evidence record');
  }
  if (record.actor !== verified.actor) {
    throw new NexaError('NEXA_E_SCHEMA', 'receipt actor does not match the evidence record');
  }
  return { ok: true };
}

export { randomId };
