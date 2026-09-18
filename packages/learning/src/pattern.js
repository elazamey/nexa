/**
 * Patterns — what repeats.
 *
 * A pattern is not a conclusion. It is a counted, content-addressed observation about
 * repetition: "`tool:github!call` failed 23 times out of 100, always with
 * `NEXA_E_HANDLER`". Patterns are mined deterministically — same input, same output,
 * same order — because a pattern whose existence depends on iteration order is not
 * evidence of anything.
 *
 * Rates are basis points (an integer out of 10000), because canonical NEXA data has no
 * floats: a number that cannot be hashed cannot be evidence.
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';
import { flattenCalls } from './observation.js';

export const OMEGA_PATTERN_DOMAIN = 'NEXA/omega1 pattern\u0000';

/** @param {object} value @returns {string} */
export function patternId(value) {
  const body = { ...value };
  delete body.id;
  return sha256Multihash(Buffer.concat([
    Buffer.from(OMEGA_PATTERN_DOMAIN, 'utf8'),
    canonicalBytes(body),
  ]));
}

/** @param {object} call @returns {string} the group key a call belongs to */
export function patternKey(call) {
  return `${call.resource}!${call.action ?? 'call'}`;
}

/**
 * @param {object[]} calls call observations
 * @param {{min_support?: number, failures_only?: boolean}} [input]
 *   `min_support` is the number of calls a group needs before it is worth naming.
 * @returns {object[]} patterns, most-failed first, ties broken by key
 */
export function minePatterns(calls, { min_support = 2, failures_only = false } = {}) {
  if (!Array.isArray(calls)) throw new OmegaError('OMEGA_E_OBSERVATION', 'calls must be an array');
  if (!Number.isSafeInteger(min_support) || min_support < 1) {
    throw new OmegaError('OMEGA_E_OBSERVATION', 'min_support must be a positive integer');
  }
  const groups = new Map();
  for (const call of calls) {
    const key = patternKey(call);
    if (!groups.has(key)) {
      groups.set(key, { key, resource: call.resource, action: call.action ?? null, calls: [], codes: new Map() });
    }
    const group = groups.get(key);
    group.calls.push(call);
    if (call.decision === 'DENY') {
      const code = call.code ?? 'OMEGA_E_UNKNOWN';
      group.codes.set(code, (group.codes.get(code) ?? 0) + 1);
    }
  }

  const patterns = [];
  for (const group of groups.values()) {
    const total = group.calls.length;
    const failed = [...group.codes.values()].reduce((sum, count) => sum + count, 0);
    if (total < min_support) continue;
    if (failures_only && failed === 0) continue;
    const codes = Object.fromEntries([...group.codes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
    const body = {
      nexa: 'omega1',
      kind: 'Pattern',
      key: group.key,
      resource: group.resource,
      action: group.action,
      observations: total,
      failures: failed,
      failure_rate_bp: Math.round((failed / total) * 10_000),
      codes,
      dominant_code: Object.keys(codes)[0] ?? null,
      missions: [...new Set(group.calls.map((call) => call.mission))].sort(),
      evidence: group.calls.map((call) => call.id),
      bounds: [...new Set(group.calls.map((call) => call.step))].sort((a, b) => a - b),
    };
    patterns.push({ ...body, id: patternId(body) });
  }
  patterns.sort((a, b) => b.failures - a.failures || b.failure_rate_bp - a.failure_rate_bp || a.key.localeCompare(b.key));
  return patterns;
}

/**
 * A failure pattern is worth a hypothesis only when it repeats *and* dominates: a tool
 * that fails once in twenty is noise, a tool that fails twenty-three times in a hundred
 * is a design fact.
 *
 * @param {object} pattern
 * @param {{min_failures?: number, min_rate_bp?: number}} [input] `min_rate_bp` defaults to 5000 (50%)
 * @returns {boolean}
 */
export function isActionable(pattern, { min_failures = 2, min_rate_bp = 5_000 } = {}) {
  return pattern.failures >= min_failures && pattern.failure_rate_bp >= min_rate_bp;
}

/** @param {number} basisPoints @returns {string} `875` → `"8.75%"` */
export function formatRate(basisPoints) {
  if (!Number.isSafeInteger(basisPoints)) throw new OmegaError('OMEGA_E_OBSERVATION', 'a rate is basis points (an integer)');
  return `${(basisPoints / 100).toFixed(2)}%`;
}
