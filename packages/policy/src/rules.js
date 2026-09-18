/**
 * Policy documents and the default-deny evaluation order.
 *
 * Order matters and is deliberately non-negotiable:
 *   1. hard gates            (gates.js, checked before rules)
 *   2. rule set, first match (this file)
 *   3. default               (DENY, always)
 *
 * A rule that matches with ALLOW still cannot revive a gated request, because
 * step 1 runs first and throws.
 */
import { NexaError, canonicalBytes, assertKid, assertResource, assertAction } from '../../ast/index.js';

export const RULE_EFFECTS = Object.freeze(['ALLOW', 'DENY']);
export const DEFAULT_POLICY_ID = 'urn:nexa:policy:default';

/**
 * @typedef {object} PolicyRule
 * @property {string} id
 * @property {'ALLOW'|'DENY'} effect
 * @property {string} [resource] exact resource or namespace pattern (`tool:*`)
 * @property {string} [resource_prefix] scope prefix, e.g. `tool:echo`
 * @property {string[]} [actions]
 * @property {string[]} [subjects] key ids this rule applies to
 * @property {boolean} [require_capability] (default true)
 * @property {boolean} [require_signature] (default true)
 * @property {string} [description]
 */

/** @param {string} pattern @param {string} value */
function matchesResourcePattern(pattern, value) {
  if (pattern === '*') return true;
  if (pattern.endsWith(':*')) {
    const namespace = pattern.slice(0, -2);
    return value === namespace || value.startsWith(`${namespace}:`);
  }
  return pattern === value;
}

/** @param {PolicyRule} rule @param {object} request */
function ruleMatches(rule, { resource, action, subject }) {
  if (rule.resource !== undefined && !matchesResourcePattern(rule.resource, resource)) {
    return false;
  }
  if (rule.resource_prefix !== undefined && resource !== rule.resource_prefix
      && !resource.startsWith(`${rule.resource_prefix}:`) && !resource.startsWith(`${rule.resource_prefix}.`)) {
    return false;
  }
  if (rule.actions !== undefined && !rule.actions.includes(action)) return false;
  if (rule.subjects !== undefined && !rule.subjects.includes(subject)) return false;
  return true;
}

/**
 * @param {PolicyRule} rule
 * @returns {PolicyRule} validated rule
 */
export function validateRule(rule) {
  if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
    throw new NexaError('NEXA_E_POLICY', 'a policy rule must be an object');
  }
  // Plain data only: a class instance can carry behaviour (getters, a crafted
  // prototype chain) that the engine would otherwise evaluate as if it were data.
  const prototype = Object.getPrototypeOf(rule);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new NexaError('NEXA_E_POLICY', `rule ${String(rule.id)} must be a plain object, not a class instance`);
  }
  if (typeof rule.id !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(rule.id)) {
    throw new NexaError('NEXA_E_POLICY', `invalid rule id: ${String(rule.id)}`);
  }
  if (!RULE_EFFECTS.includes(rule.effect)) {
    throw new NexaError('NEXA_E_POLICY', `rule ${rule.id}: effect must be ALLOW or DENY`);
  }
  if (rule.resource !== undefined) {
    if (rule.resource !== '*' && !/^[a-z][a-z0-9_-]{0,31}(:(\*|[a-z0-9/._-]{1,127}))?$/.test(rule.resource)) {
      throw new NexaError('NEXA_E_POLICY', `rule ${rule.id}: invalid resource pattern`);
    }
  }
  if (rule.resource_prefix !== undefined) assertResource(rule.resource_prefix);
  if (rule.actions !== undefined) {
    if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
      throw new NexaError('NEXA_E_POLICY', `rule ${rule.id}: actions must be a non-empty array`);
    }
    for (const action of rule.actions) assertAction(action);
  }
  if (rule.subjects !== undefined) {
    if (!Array.isArray(rule.subjects) || rule.subjects.length === 0) {
      throw new NexaError('NEXA_E_POLICY', `rule ${rule.id}: subjects must be a non-empty array`);
    }
    for (const subject of rule.subjects) assertKid(subject);
  }
  for (const key of Object.keys(rule)) {
    if (!['id', 'effect', 'resource', 'resource_prefix', 'actions', 'subjects', 'require_capability', 'require_signature', 'description'].includes(key)) {
      throw new NexaError('NEXA_E_POLICY', `rule ${rule.id}: unknown field ${key}`);
    }
  }
  return rule;
}

export class Policy {
  /**
   * @param {{id?: string, rules?: PolicyRule[], defaultEffect?: 'DENY'}} [input]
   *   `defaultEffect` is accepted for API symmetry but v0.1 only ever DENYs.
   */
  constructor({ id = DEFAULT_POLICY_ID, rules = [], defaultEffect = 'DENY' } = {}) {
    if (defaultEffect !== 'DENY') {
      throw new NexaError('NEXA_E_POLICY', 'NEXA v0.1 is default-deny; no other default is accepted');
    }
    this.id = id;
    this.defaultEffect = 'DENY';
    this.rules = rules.map(validateRule);
    const ids = new Set();
    for (const rule of this.rules) {
      if (ids.has(rule.id)) {
        throw new NexaError('NEXA_E_POLICY', `duplicate rule id: ${rule.id}`);
      }
      ids.add(rule.id);
    }
    this.rules.sort((a, b) => a.id.localeCompare(b.id)); // deterministic evaluation order
  }

  /** @returns {Policy} an empty, default-deny policy */
  static denyAll() {
    return new Policy({ rules: [] });
  }

  /**
   * @param {object} request
   * @param {string} request.resource
   * @param {string} request.action
   * @param {string} request.subject key id of the party asking
   * @param {object} [request.capability] verified grant (from verifyCapability)
   * @param {object} [request.signals] extra context: { signed: boolean, ... }
   * @returns {{effect: 'ALLOW'|'DENY', rule: string|null, reason: string, policy: string}}
   */
  evaluate({ resource, action, subject, capability, signals = {} }) {
    assertResource(resource);
    assertAction(action);
    assertKid(subject);
    canonicalBytes(signals);
    for (const rule of this.rules) {
      if (!ruleMatches(rule, { resource, action, subject })) continue;
      // A rule can demand evidence that the request is actually authorized.
      if (rule.effect === 'ALLOW') {
        if ((rule.require_capability ?? true) && capability === undefined) {
          return {
            effect: 'DENY',
            rule: rule.id,
            policy: this.id,
            reason: 'rule requires a verified capability but none was presented',
          };
        }
        if ((rule.require_signature ?? true) && signals.signed !== true) {
          return {
            effect: 'DENY',
            rule: rule.id,
            policy: this.id,
            reason: 'rule requires a signed envelope',
          };
        }
      }
      return {
        effect: rule.effect,
        rule: rule.id,
        policy: this.id,
        reason: rule.description ?? `rule ${rule.id} matched`,
      };
    }
    return {
      effect: 'DENY',
      rule: null,
      policy: this.id,
      reason: 'no rule matched; NEXA v0.1 is default-deny',
    };
  }

  /** @returns {object} deterministic, loggable projection of the policy */
  toJSON() {
    return { id: this.id, defaultEffect: this.defaultEffect, rules: this.rules };
  }

  /** @returns {string} */
  digest() {
    return canonicalBytes(this.toJSON()).toString('base64url');
  }
}
