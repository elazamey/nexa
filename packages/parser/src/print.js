/**
 * Printer: NEXA document -> `.nex` text.
 *
 * Objects are printed with keys in canonical (sorted) order, so printing is
 * deterministic: the same envelope always produces byte-identical text. That is
 * what makes `.nex` useful in review, diffs and evidence attachments.
 */
import { NexaError, canonicalBytes } from '../../ast/index.js';
import { HEADER_ORDER, fromEnvelope } from './map.js';

const ESCAPES = Object.freeze({
  '\n': '\\n',
  '\t': '\\t',
  '\r': '\\r',
  '"': '\\"',
  '\\': '\\\\',
});

const BARE_KEY = /^[\p{L}_][\p{L}\p{N}_.-]*$/u;
/** Strings that are safe to print unquoted (never the reserved words). */
const BARE_VALUE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const RESERVED = new Set(['null', 'true', 'false']);

function printString(value) {
  let out = '"';
  for (const char of value) {
    const escape = ESCAPES[char];
    if (escape !== undefined) {
      out += escape;
      continue;
    }
    const code = char.codePointAt(0);
    if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    out += char;
  }
  return `${out}"`;
}

function printValue(value, indent) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new NexaError('NEXA_E_C14N_NUMBER', 'only safe integers can be printed to .nex');
    }
    return String(value);
  }
  if (typeof value === 'string') {
    if (BARE_VALUE.test(value) && !RESERVED.has(value)) return value;
    return printString(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = value.map((item) => printValue(item, indent + 1)).join(' ');
    return `[${inner}]`;
  }
  return printObject(value, indent);
}

/** @param {object} object @param {number} indent @returns {string} */
export function printObject(object, indent = 0) {
  const keys = Object.keys(object).sort();
  if (keys.length === 0) return '{}';
  const pad = '  '.repeat(indent + 1);
  const lines = keys.map((key) => {
    const name = BARE_KEY.test(key) ? key : printString(key);
    return `${pad}${name} ${printValue(object[key], indent + 1)}`;
  });
  return `{\n${lines.join('\n')}\n${'  '.repeat(indent)}}`;
}

/**
 * @param {object} envelope
 * @returns {string} `.nex` text
 */
export function printNex(envelope) {
  canonicalBytes(envelope);
  const { version, headers, blocks } = fromEnvelope(envelope);
  const lines = [`nexa ${version}`];
  for (const key of HEADER_ORDER) {
    if (headers[key] === undefined) continue;
    lines.push(`@${key} ${printValue(headers[key], 0)}`);
  }
  for (const key of Object.keys(headers)) {
    if (HEADER_ORDER.includes(key)) continue;
    lines.push(`@${key} ${printValue(headers[key], 0)}`);
  }
  for (const block of Object.keys(blocks).sort()) {
    lines.push(`${block} ${printObject(blocks[block], 0)}`);
  }
  return `${lines.join('\n')}\n`;
}

export { parseNex, parseDocument, toEnvelope } from './parse.js';
