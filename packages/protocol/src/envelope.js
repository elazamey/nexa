/**
 * Envelope construction and verification.
 *
 * An envelope is signed by its sender and covers *every* field except `sig`
 * (see `signaturePayload`). Nothing is added after signing: the receiver
 * re-derives the payload from the bytes it received, so a forwarded envelope
 * cannot be re-labelled, re-targeted, or extended.
 */
import {
  NexaError,
  MESSAGE_TYPES,
  buildUnsignedMessage,
  canonicalBytes,
  compareInstant,
  formatInstant,
  parseInstant,
  signaturePayload,
  validateEnvelope,
} from '../../ast/index.js';
import { KeyPair, publicKeyFromKeyId, randomId, randomNonce, verifyBytes } from '../../crypto/index.js';

export const DEFAULT_TTL_SECONDS = 60;
export const MAX_TTL_SECONDS = 300;
export const DEFAULT_SKEW_SECONDS = 30;
export const MAX_BODY_BYTES = 64 * 1024;

const TYPE_SET = new Set(MESSAGE_TYPES);

/**
 * @param {object} input
 * @param {{keys: KeyPair, kid: string}} input.sender
 * @param {string} input.to
 * @param {string} input.type
 * @param {object} input.body
 * @param {number} [input.ttlSeconds]
 * @param {string} [input.capability]
 * @param {string} [input.inReplyTo]
 * @param {string} [input.id]
 * @param {string} [input.nonce]
 * @param {Date} [input.now]
 * @returns {object} signed envelope
 */
export function buildEnvelope({
  sender,
  to,
  type,
  body,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  capability,
  inReplyTo,
  id,
  nonce,
  now,
}) {
  if (!(sender?.keys instanceof KeyPair)) {
    throw new NexaError('NEXA_E_KEY', 'envelope sender must carry a KeyPair');
  }
  if (!TYPE_SET.has(type)) {
    throw new NexaError('NEXA_E_SCHEMA', `unknown message type: ${String(type)}`);
  }
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new NexaError('NEXA_E_TTL', `ttlSeconds must be in 1..${MAX_TTL_SECONDS}`);
  }
  const issuedAt = now ?? new Date();
  const unsigned = buildUnsignedMessage({
    type,
    id: id ?? randomId('urn:nexa:msg:'),
    from: sender.kid,
    to,
    ts: formatInstant(issuedAt),
    exp: formatInstant(issuedAt.getTime() + ttlSeconds * 1000),
    nonce: nonce ?? randomNonce(),
    ...(capability === undefined ? {} : { cap: capability }),
    ...(inReplyTo === undefined ? {} : { in_reply_to: inReplyTo }),
    body,
  });
  const envelope = {
    ...unsigned,
    sig: { alg: 'ed25519', kid: sender.kid, val: sender.keys.sign(signaturePayload(unsigned)) },
  };
  return validateEnvelope(envelope);
}

/**
 * Full structural + cryptographic + freshness verification of an inbound envelope.
 * @param {unknown} envelope
 * @param {object} [options]
 * @param {Date} [options.now]
 * @param {number} [options.skewSeconds]
 * @param {string} [options.expectSender] require a specific sender key id
 * @param {string} [options.expectRecipient] require a specific recipient key id
 * @param {string[]} [options.allowedTypes]
 * @returns {{ok: true, envelope: object, sender: string, recipient: string, issuedAt: string, expiresAt: string}}
 */
export function verifyEnvelope(envelope, options = {}) {
  // Size is checked before anything else, deliberately: hashing and signature
  // verification are the expensive part, and an attacker who can cheaply make us
  // do them wins by default. A body that is not canonicalizable is ignored here and
  // rejected later by schema validation, so this check never masks a schema error.
  if (envelope !== null && typeof envelope === 'object' && envelope.body !== undefined) {
    let bodyBytes = null;
    try {
      bodyBytes = canonicalBytes(envelope.body).length;
    } catch {
      bodyBytes = null;
    }
    if (bodyBytes !== null && bodyBytes > MAX_BODY_BYTES) {
      throw new NexaError('NEXA_E_TOO_LARGE', `envelope body of ${bodyBytes} bytes exceeds the ${MAX_BODY_BYTES}-byte limit`, {
        bytes: bodyBytes,
        limit: MAX_BODY_BYTES,
      });
    }
  }
  validateEnvelope(envelope);
  const now = options.now ?? new Date();
  const skew = options.skewSeconds ?? DEFAULT_SKEW_SECONDS;
  const nowMs = now.getTime();

  const ok = verifyBytes(
    publicKeyFromKeyId(envelope.sig.kid),
    signaturePayload(envelope),
    envelope.sig.val,
  );
  if (!ok) {
    throw new NexaError('NEXA_E_SIG', `envelope ${envelope.id} has an invalid signature`);
  }

  const issuedMs = parseInstant(envelope.ts);
  const expiresMs = parseInstant(envelope.exp);
  if ((expiresMs - issuedMs) / 1000 > MAX_TTL_SECONDS) {
    throw new NexaError('NEXA_E_TTL', `envelope ${envelope.id} lives longer than the ${MAX_TTL_SECONDS}s maximum`);
  }
  if (nowMs >= expiresMs) {
    throw new NexaError('NEXA_E_EXPIRED', `envelope ${envelope.id} expired at ${envelope.exp}`);
  }
  if (issuedMs > nowMs + skew * 1000) {
    throw new NexaError('NEXA_E_CLOCK', `envelope ${envelope.id} is dated in the future`);
  }
  if (compareInstant(envelope.exp, envelope.ts) <= 0) {
    throw new NexaError('NEXA_E_SCHEMA', 'envelope exp must be after ts');
  }

  if (options.expectSender !== undefined && envelope.from !== options.expectSender) {
    throw new NexaError('NEXA_E_UNTRUSTED', 'envelope came from an unexpected sender', {
      expected: options.expectSender,
      actual: envelope.from,
    });
  }
  if (options.expectRecipient !== undefined && envelope.to !== options.expectRecipient) {
    throw new NexaError('NEXA_E_UNTRUSTED', 'envelope is addressed to another endpoint', {
      expected: options.expectRecipient,
      actual: envelope.to,
    });
  }
  if (options.allowedTypes !== undefined && !options.allowedTypes.includes(envelope.type)) {
    throw new NexaError('NEXA_E_SCHEMA', `message type ${envelope.type} is not accepted here`);
  }

  return {
    ok: true,
    envelope,
    sender: envelope.from,
    recipient: envelope.to,
    issuedAt: envelope.ts,
    expiresAt: envelope.exp,
  };
}
