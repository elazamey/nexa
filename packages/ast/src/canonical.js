/**
 * NEXA-C14N v0.1 — canonical serialization of the NEXA data model.
 *
 * Design goals: one value -> exactly one byte string, on every platform.
 *
 * Rules (RFC 8785 compatible subset):
 *   - values: null, boolean, string, safe integer, array, plain object
 *   - non-integer numbers are REJECTED (v0.1 is integer-only: no float ambiguity)
 *   - object keys are sorted by UTF-16 code unit order
 *   - strings are NFC-normalized, emitted as raw UTF-8 with minimal escaping
 *     (only `"`, `\` and U+0000..U+001F are escaped)
 *   - unpaired surrogates, undefined, functions, symbols, bigint, Date, Map,
 *     class instances and prototypes are REJECTED
 */
import { NexaError } from './errors.js';

const ESCAPES = Object.freeze({
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
  0x22: '\\"',
  0x5c: '\\\\',
});

function canonicalString(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const escape = ESCAPES[code];
    if (escape !== undefined) {
      out += escape;
      continue;
    }
    if (code < 0x20) {
      out += `\\u00${code.toString(16).padStart(2, '0')}`;
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) {
        throw new NexaError('NEXA_E_C14N_STRING', 'unpaired high surrogate in string');
      }
      out += value[i] + value[i + 1];
      i += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new NexaError('NEXA_E_C14N_STRING', 'unpaired low surrogate in string');
    }
    out += value[i];
  }
  return `"${out}"`;
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function writeValue(value, out, depth) {
  if (depth > 64) {
    throw new NexaError('NEXA_E_C14N_TYPE', 'value nesting exceeds 64 levels');
  }
  if (value === null) {
    out.push('null');
    return;
  }
  const type = typeof value;
  if (type === 'boolean') {
    out.push(value ? 'true' : 'false');
    return;
  }
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new NexaError('NEXA_E_C14N_NUMBER', 'non-finite number is not canonicalizable');
    }
    if (!Number.isSafeInteger(value)) {
      throw new NexaError('NEXA_E_C14N_NUMBER', `only safe integers are allowed, got ${value}`);
    }
    out.push(String(Object.is(value, -0) ? 0 : value));
    return;
  }
  if (type === 'string') {
    out.push(canonicalString(value.normalize('NFC')));
    return;
  }
  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) out.push(',');
      if (!Object.hasOwn(value, i)) {
        throw new NexaError('NEXA_E_C14N_TYPE', 'sparse arrays are not canonicalizable');
      }
      writeValue(value[i], out, depth + 1);
    }
    out.push(']');
    return;
  }
  if (isPlainObject(value)) {
    // Two raw keys can normalize to the same canonical key ("é" vs "e" + U+0301).
    // Emitting both would make the signed bytes ambiguous, so the collision is a
    // hard error rather than a silent merge. `__proto__` is refused outright: an
    // own property with that name is a prototype-pollution vector for any consumer
    // that spreads or assigns the decoded object.
    const entries = [];
    const seen = new Map();
    for (const rawKey of Object.keys(value)) {
      if (rawKey === '__proto__') {
        throw new NexaError('NEXA_E_C14N_TYPE', 'object key "__proto__" is not canonicalizable');
      }
      const key = rawKey.normalize('NFC');
      const clash = seen.get(key);
      if (clash !== undefined) {
        throw new NexaError(
          'NEXA_E_C14N_FORM',
          `keys ${JSON.stringify(clash)} and ${JSON.stringify(rawKey)} collide after NFC normalization`,
        );
      }
      seen.set(key, rawKey);
      entries.push([key, rawKey]);
    }
    entries.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
    out.push('{');
    let first = true;
    for (const [key, rawKey] of entries) {
      if (!first) out.push(',');
      first = false;
      out.push(canonicalString(key), ':');
      writeValue(value[rawKey], out, depth + 1);
    }
    out.push('}');
    return;
  }
  throw new NexaError('NEXA_E_C14N_TYPE', `unsupported value of type ${type}`);
}

/**
 * @param {unknown} value
 * @returns {string} canonical text
 */
export function canonicalize(value) {
  const out = [];
  writeValue(value, out, 0);
  return out.join('');
}

/**
 * @param {unknown} value
 * @returns {Buffer} canonical UTF-8 bytes
 */
export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), 'utf8');
}

/**
 * Parses JSON text and *requires* it to already be in canonical form.
 * This rejects duplicate keys, float literals, non-NFC strings and key reordering.
 * @param {string} text
 * @returns {unknown}
 */
export function parseCanonical(text) {
  if (typeof text !== 'string') {
    throw new NexaError('NEXA_E_SCHEMA', 'canonical input must be a string');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new NexaError('NEXA_E_PARSE', `invalid JSON: ${cause.message}`);
  }
  const reencoded = canonicalize(value);
  if (reencoded !== text) {
    throw new NexaError('NEXA_E_C14N_FORM', 'input is not in NEXA-C14N canonical form', {
      expected: reencoded,
    });
  }
  return value;
}
