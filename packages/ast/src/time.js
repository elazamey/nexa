/** RFC 3339 UTC timestamps, second precision, no leap-second games. */
import { NexaError } from './errors.js';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * @param {string} value
 * @returns {number} epoch milliseconds
 */
export function parseInstant(value) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) {
    throw new NexaError('NEXA_E_SCHEMA', `not an RFC 3339 UTC timestamp: ${String(value)}`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new NexaError('NEXA_E_SCHEMA', `not a valid instant: ${value}`);
  }
  return ms;
}

/** @param {Date|number} [when] @returns {string} */
export function formatInstant(when = new Date()) {
  const date = typeof when === 'number' ? new Date(when) : when;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new NexaError('NEXA_E_SCHEMA', 'cannot format a non-date value');
  }
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * @param {string} instant
 * @param {number} seconds
 * @returns {string}
 */
export function addSeconds(instant, seconds) {
  if (!Number.isSafeInteger(seconds)) {
    throw new NexaError('NEXA_E_SCHEMA', 'seconds must be a safe integer');
  }
  return formatInstant(parseInstant(instant) + seconds * 1000);
}

/** @param {string} a @param {string} b @returns {number} -1 | 0 | 1 */
export function compareInstant(a, b) {
  const left = parseInstant(a);
  const right = parseInstant(b);
  return left === right ? 0 : left < right ? -1 : 1;
}
