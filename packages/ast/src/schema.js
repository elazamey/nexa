/**
 * NEXA envelope schema (v0.1).
 *
 * An envelope is the only thing that travels on the wire. It is strict on purpose:
 * unknown top-level fields are rejected so that no unsigned field can ever be
 * smuggled alongside a signed one.
 */
import { NexaError } from './errors.js';
import { canonicalBytes } from './canonical.js';
import { compareInstant, parseInstant } from './time.js';

export const NEXA_VERSION = '0.1';

/** Domain separator: a NEXA envelope signature can never be replayed as another object type. */
export const ENVELOPE_SIGNATURE_DOMAIN = `NEXA/${NEXA_VERSION} envelope signature\u0000`;

export const MESSAGE_TYPES = Object.freeze([
  'HELLO', // endpoint announcement / identity exchange
  'CAP_GRANT', // capability issuance or delegation is being delivered
  'CALL', // request to invoke a resource action
  'RESULT', // successful response to a CALL
  'DENY', // refused CALL (policy, gate, capability, freshness)
  'EVIDENCE', // evidence log entry or chain proof
  'RECEIPT', // signed proof of a decision
  'ERROR', // protocol-level error (malformed, unsupported)
]);

const TYPE_SET = new Set(MESSAGE_TYPES);

export const KID_PATTERN = /^nexa:key:ed25519:z[1-9A-HJ-NP-Za-km-z]{20,128}$/;
export const MESSAGE_ID_PATTERN = /^urn:nexa:msg:[A-Za-z0-9_-]{8,64}$/;
export const CAPABILITY_ID_PATTERN = /^urn:nexa:cap:[A-Za-z0-9_-]{8,64}$/;
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/**
 * Resource identifiers are `<namespace>:<path>`. The grammar is deliberately generic:
 * which namespaces are *dangerous* is decided by the policy gates
 * (`packages/policy/src/gates.js`), not by the syntax. That keeps one list of things
 * NEXA refuses, instead of two that can drift apart.
 */
export const RESOURCE_PATTERN = /^[a-z][a-z0-9_-]{0,31}:[a-z0-9/._-]{1,127}$/;
export const ACTION_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export const ENVELOPE_FIELDS = Object.freeze([
  'nexa',
  'type',
  'id',
  'from',
  'to',
  'ts',
  'exp',
  'nonce',
  'cap',
  'in_reply_to',
  'body',
  'sig',
]);

export const REQUIRED_ENVELOPE_FIELDS = Object.freeze([
  'nexa',
  'type',
  'id',
  'from',
  'to',
  'ts',
  'exp',
  'nonce',
  'body',
  'sig',
]);

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** @param {string} value @param {RegExp} pattern @param {string} label */
function assertMatch(value, pattern, label, code = 'NEXA_E_SCHEMA') {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new NexaError(code, `invalid ${label}: ${String(value)}`);
  }
  return value;
}

export const assertKid = (value) => assertMatch(value, KID_PATTERN, 'key id', 'NEXA_E_IDENTITY');
export const assertMessageId = (value) => assertMatch(value, MESSAGE_ID_PATTERN, 'message id');
export const assertCapabilityId = (value) => assertMatch(value, CAPABILITY_ID_PATTERN, 'capability id');
export const assertNonce = (value) => assertMatch(value, NONCE_PATTERN, 'nonce');
export const assertResource = (value) => assertMatch(value, RESOURCE_PATTERN, 'resource');
export const assertAction = (value) => assertMatch(value, ACTION_PATTERN, 'action');

/** @param {object} signature */
export function validateSignature(signature) {
  if (!isPlainObject(signature)) {
    throw new NexaError('NEXA_E_SCHEMA', 'signature must be an object');
  }
  const keys = Object.keys(signature).sort();
  if (keys.join(',') !== 'alg,kid,val') {
    throw new NexaError('NEXA_E_SCHEMA', `signature fields must be alg,kid,val; got ${keys.join(',')}`);
  }
  if (signature.alg !== 'ed25519') {
    throw new NexaError('NEXA_E_SIG_ALG', `unsupported algorithm: ${String(signature.alg)}`);
  }
  assertKid(signature.kid);
  if (typeof signature.val !== 'string' || !/^[A-Za-z0-9_-]{80,96}$/.test(signature.val)) {
    throw new NexaError('NEXA_E_SIG', 'signature value must be a base64url Ed25519 signature');
  }
  return signature;
}

/**
 * Validates an envelope structurally. Does NOT verify the signature
 * (that is `packages/crypto` + `packages/protocol`).
 * @param {unknown} envelope
 * @returns {object} the same envelope, validated
 */
export function validateEnvelope(envelope) {
  if (!isPlainObject(envelope)) {
    throw new NexaError('NEXA_E_SCHEMA', 'envelope must be a plain object');
  }
  for (const key of Object.keys(envelope)) {
    if (!ENVELOPE_FIELDS.includes(key)) {
      throw new NexaError('NEXA_E_SCHEMA', `unknown envelope field: ${key}`);
    }
  }
  for (const key of REQUIRED_ENVELOPE_FIELDS) {
    if (!Object.hasOwn(envelope, key)) {
      throw new NexaError('NEXA_E_SCHEMA', `missing envelope field: ${key}`);
    }
  }
  if (envelope.nexa !== NEXA_VERSION) {
    throw new NexaError('NEXA_E_SCHEMA', `unsupported nexa version: ${String(envelope.nexa)}`);
  }
  if (!TYPE_SET.has(envelope.type)) {
    throw new NexaError('NEXA_E_SCHEMA', `unknown message type: ${String(envelope.type)}`);
  }
  assertMessageId(envelope.id);
  assertKid(envelope.from);
  assertKid(envelope.to);
  parseInstant(envelope.ts);
  parseInstant(envelope.exp);
  if (compareInstant(envelope.exp, envelope.ts) <= 0) {
    throw new NexaError('NEXA_E_SCHEMA', 'exp must be strictly after ts');
  }
  assertNonce(envelope.nonce);
  if (Object.hasOwn(envelope, 'cap')) {
    assertCapabilityId(envelope.cap);
  }
  if (Object.hasOwn(envelope, 'in_reply_to')) {
    assertMessageId(envelope.in_reply_to);
  }
  if (!isPlainObject(envelope.body)) {
    throw new NexaError('NEXA_E_SCHEMA', 'body must be a plain object');
  }
  // body must round-trip through the canonical form: rejects floats and bad strings early.
  canonicalBytes(envelope.body);
  validateSignature(envelope.sig);
  if (envelope.sig.kid !== envelope.from) {
    throw new NexaError('NEXA_E_SIG', 'signature kid does not match the envelope sender');
  }
  return envelope;
}

/**
 * Exact bytes covered by an envelope signature: the domain separator followed by
 * the canonical form of every field except `sig`.
 * @param {object} envelope
 * @returns {Buffer}
 */
export function signaturePayload(envelope) {
  const { sig, ...unsigned } = envelope; // eslint-disable-line no-unused-vars
  return Buffer.concat([
    Buffer.from(ENVELOPE_SIGNATURE_DOMAIN, 'utf8'),
    canonicalBytes(unsigned),
  ]);
}

/** Structural helpers used by the protocol layer. */
export function isCall(envelope) {
  return envelope?.type === 'CALL';
}

export function isDenial(envelope) {
  return envelope?.type === 'DENY';
}
