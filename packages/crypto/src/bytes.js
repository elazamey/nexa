/** Byte/encoding helpers. Only what the protocol actually needs. */
import { NexaError } from '../../ast/index.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((char, index) => [char, index]));

/** @param {string} text @returns {Buffer} */
export function utf8(text) {
  return Buffer.from(text, 'utf8');
}

/** @param {Buffer|Uint8Array|string} bytes @returns {string} */
export function base64url(bytes) {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  return buf.toString('base64url');
}

/** @param {string} text @returns {Buffer} */
export function fromBase64url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) {
    throw new NexaError('NEXA_E_KEY', 'invalid base64url input');
  }
  return Buffer.from(text, 'base64url');
}

/** base58btc (multibase `z`), big-endian, leading zero bytes preserved as '1'. */
export function base58btc(bytes) {
  const input = Buffer.from(bytes);
  let zeros = 0;
  while (zeros < input.length && input[zeros] === 0) zeros += 1;
  let value = 0n;
  for (const byte of input) value = value * 256n + BigInt(byte);
  let out = '';
  while (value > 0n) {
    out = BASE58_ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  return '1'.repeat(zeros) + out;
}

/** @param {string} text @returns {Buffer} */
export function fromBase58btc(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new NexaError('NEXA_E_KEY', 'invalid base58btc input');
  }
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') zeros += 1;
  let value = 0n;
  for (const char of text.slice(zeros)) {
    const index = BASE58_INDEX.get(char);
    if (index === undefined) throw new NexaError('NEXA_E_KEY', `invalid base58btc character: ${char}`);
    value = value * 58n + BigInt(index);
  }
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(bytes)]);
}

/** @param {Buffer|Uint8Array} bytes @returns {string} lowercase hex */
export function toHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

/** @param {string} text @returns {Buffer} */
export function fromHex(text) {
  if (typeof text !== 'string' || text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) {
    throw new NexaError('NEXA_E_KEY', 'invalid hex input');
  }
  return Buffer.from(text, 'hex');
}
