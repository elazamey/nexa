/**
 * Ed25519 key handling for NEXA v0.1.
 *
 * Wire identity of a key: `nexa:key:ed25519:z<base58btc(0xed01 || pubkey32)>`
 * — multibase base58btc over the multicodec `ed25519-pub` prefix. The key id is
 * derived from the public key alone, so it is self-certifying: `kid -> key`,
 * with no registry and no trust-on-first-use for the id itself.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto';
import { NexaError } from '../../ast/index.js';
import { base58btc, base64url, fromBase58btc, fromBase64url, fromHex, toHex } from './bytes.js';

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const MULTICODEC_ED25519 = Buffer.from([0xed, 0x01]);

export const KID_PREFIX = 'nexa:key:ed25519:z';

/** @param {import('node:crypto').KeyObject} publicKey @returns {Buffer} raw 32 bytes */
export function rawPublicKey(publicKey) {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  if (der.length < 32) throw new NexaError('NEXA_E_KEY', 'public key DER is too short');
  return Buffer.from(der.subarray(der.length - 32));
}

/** @param {Buffer|Uint8Array} raw @returns {import('node:crypto').KeyObject} */
export function publicKeyFromRaw(raw) {
  const bytes = Buffer.from(raw);
  if (bytes.length !== 32) {
    throw new NexaError('NEXA_E_KEY', 'an ed25519 public key must be exactly 32 bytes');
  }
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, bytes]),
    format: 'der',
    type: 'spki',
  });
}

/** @param {Buffer|Uint8Array} seed32 @returns {import('node:crypto').KeyObject} */
export function privateKeyFromSeed(seed32) {
  const seed = Buffer.from(seed32);
  if (seed.length !== 32) {
    throw new NexaError('NEXA_E_KEY', 'an ed25519 seed must be exactly 32 bytes');
  }
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** @param {import('node:crypto').KeyObject} privateKey @returns {Buffer} raw 32-byte seed */
export function seedFromPrivateKey(privateKey) {
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  if (der.length < 32) throw new NexaError('NEXA_E_KEY', 'private key DER is too short');
  return Buffer.from(der.subarray(der.length - 32));
}

/** @param {Buffer|Uint8Array} rawPublic @returns {string} */
export function keyIdFromRaw(rawPublic) {
  const bytes = Buffer.from(rawPublic);
  if (bytes.length !== 32) {
    throw new NexaError('NEXA_E_KEY', 'an ed25519 public key must be exactly 32 bytes');
  }
  return `${KID_PREFIX}${base58btc(Buffer.concat([MULTICODEC_ED25519, bytes]))}`;
}

/** @param {string} kid @returns {Buffer} raw public key bytes */
export function rawFromKeyId(kid) {
  if (typeof kid !== 'string' || !kid.startsWith(KID_PREFIX)) {
    throw new NexaError('NEXA_E_IDENTITY', `not a NEXA ed25519 key id: ${String(kid)}`);
  }
  const decoded = fromBase58btc(kid.slice(KID_PREFIX.length));
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new NexaError('NEXA_E_IDENTITY', 'key id does not carry an ed25519 multicodec prefix');
  }
  return Buffer.from(decoded.subarray(2));
}

/** @param {string} kid @returns {import('node:crypto').KeyObject} */
export function publicKeyFromKeyId(kid) {
  return publicKeyFromRaw(rawFromKeyId(kid));
}

/** @param {Buffer|Uint8Array} data @returns {Buffer} 32-byte sha256 digest */
export function sha256(data) {
  return createHash('sha256').update(Buffer.from(data)).digest();
}

/** @param {Buffer|Uint8Array} bytes @returns {string} `sha256:<base64url>` */
export function sha256Multihash(bytes) {
  return `sha256:${base64url(sha256(bytes))}`;
}

/** @returns {string} fresh 128-bit nonce (base64url) */
export function randomNonce() {
  return base64url(randomBytes(16));
}

/** @param {string} prefix e.g. `urn:nexa:msg:` @returns {string} */
export function randomId(prefix) {
  return `${prefix}${base64url(randomBytes(16))}`;
}

/** @param {import('node:crypto').KeyObject} publicKey @param {Buffer|Uint8Array|string} data @param {string} signature base64url @returns {boolean} */
export function verifyBytes(publicKey, data, signature) {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  let raw;
  try {
    raw = fromBase64url(signature);
  } catch {
    return false;
  }
  if (raw.length !== 64) return false;
  try {
    return edVerify(null, bytes, publicKey, raw);
  } catch {
    return false;
  }
}

/** @param {Buffer|Uint8Array|string} data @param {string} signature base64url @param {string} kid @returns {boolean} */
export function verifyWithKeyId(data, signature, kid) {
  try {
    return verifyBytes(publicKeyFromKeyId(kid), data, signature);
  } catch {
    return false;
  }
}

export class KeyPair {
  #privateKey;

  #publicKey;

  /**
   * Prefer `KeyPair.generate()` / `KeyPair.fromSeed()`.
   * @param {{privateKey: import('node:crypto').KeyObject}} input
   */
  constructor({ privateKey }) {
    this.#privateKey = privateKey;
    this.#publicKey = createPublicKey(privateKey);
    this.alg = 'ed25519';
    /** @type {string} self-certifying key id */
    this.kid = keyIdFromRaw(rawPublicKey(this.#publicKey));
  }

  /** @returns {KeyPair} */
  static generate() {
    const { privateKey } = generateKeyPairSync('ed25519');
    return new KeyPair({ privateKey });
  }

  /**
   * Deterministic key pair from a 32-byte seed — used to pin spec test vectors.
   * @param {Buffer|Uint8Array|string} seed hex string, or 32 raw bytes
   * @returns {KeyPair}
   */
  static fromSeed(seed) {
    const bytes = typeof seed === 'string' ? fromHex(seed) : Buffer.from(seed);
    return new KeyPair({ privateKey: privateKeyFromSeed(bytes) });
  }

  /**
   * @param {Buffer|Uint8Array|string} data
   * @returns {string} base64url signature
   */
  sign(data) {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    return base64url(edSign(null, bytes, this.#privateKey));
  }

  /**
   * @param {Buffer|Uint8Array|string} data
   * @param {string} signature base64url
   * @returns {boolean}
   */
  verify(data, signature) {
    return verifyBytes(this.#publicKey, data, signature);
  }

  /** @returns {import('node:crypto').KeyObject} */
  get publicKeyObject() {
    return this.#publicKey;
  }

  /** @returns {Buffer} raw public key bytes */
  get rawPublicKey() {
    return rawPublicKey(this.#publicKey);
  }

  /** @returns {string} raw public key, base64url */
  get publicKeyB64u() {
    return base64url(this.rawPublicKey);
  }

  /** @returns {Buffer} raw 32-byte seed */
  get seed() {
    return seedFromPrivateKey(this.#privateKey);
  }

  /** @returns {string} hex seed — test vectors only, never log in production */
  get seedHex() {
    return toHex(this.seed);
  }

  /** @returns {{kid: string, alg: string, public_key: string}} */
  toPublicKeyRecord() {
    return { kid: this.kid, alg: 'ed25519', public_key: this.publicKeyB64u };
  }
}
