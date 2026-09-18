/**
 * Self-healing — detect → isolate → diagnose → recover → verify → learn.
 *
 * The circuit breaker already does *detect* and *isolate* mechanically. This adds the
 * part that needs judgement: a failure is classified, and the classification decides
 * what may happen next.
 *
 *   · `permanent`  — a closed gate, a missing capability, a secret-egress attempt. Not
 *                    retried, and not routed around: routing around authority is how a
 *                    system grows a second, quieter authority.
 *   · `transient`  — a handler error, a timeout, an open circuit. Retried, or moved to a
 *                    declared fallback, bounded by the breaker.
 *   · `unknown`    — anything else. Fail closed and record it; an unclassified failure
 *                    is a defect in the classifier, not a licence to retry.
 *
 * The healer never decides *authority*: a substitute still needs its own capability, and
 * a mission that cannot proceed without one ends in DENY like any other refusal.
 */
import { OmegaError } from '../../compiler/index.js';

export const HEAL_PHASES = Object.freeze(['detect', 'isolate', 'diagnose', 'recover', 'verify', 'learn']);

export const HEAL_ACTIONS = Object.freeze(['stop', 'retry', 'substitute']);

/** Failures that must never be retried and never be routed around. */
const PERMANENT = Object.freeze([
  'NEXA_E_GATE',
  'NEXA_E_CAP_MISSING',
  'NEXA_E_CAP_AUDIENCE',
  'NEXA_E_CAP_EXPIRED',
  'NEXA_E_CAP_USES',
  'NEXA_E_POLICY',
  'OMEGA_E_CAP_MISSING',
  'OMEGA_E_SECRET_EGRESS',
  'OMEGA_E_SECRET_UNAVAILABLE',
  'OMEGA_E_SECRET_LITERAL',
]);

/** Failures that may be retried or moved to a fallback. */
const TRANSIENT = Object.freeze([
  'NEXA_E_HANDLER',
  'NEXA_E_TIMEOUT',
  'OMEGA_E_CIRCUIT_OPEN',
  'OMEGA_E_PROVIDER_UNAVAILABLE',
]);

/** Failures that are a fact about the plan, not about the tool: stop, and learn. */
const STRUCTURAL = Object.freeze([
  'OMEGA_E_BUDGET',
  'OMEGA_E_CONTRACT_UNMET',
  'OMEGA_E_ASSERT',
  'OMEGA_E_UNPROVEN',
]);

/** @param {string|null} code @returns {'permanent'|'transient'|'structural'|'unknown'} */
export function classify(code) {
  if (code === null || code === undefined) return 'unknown';
  if (PERMANENT.includes(code)) return 'permanent';
  if (TRANSIENT.includes(code)) return 'transient';
  if (STRUCTURAL.includes(code)) return 'structural';
  return 'unknown';
}

export class SelfHealer {
  #incidents = [];
  #breaker;
  #clock;
  #fallbacks;

  /**
   * @param {{breaker?: object|null, fallbacks?: Record<string, string[]>, clock?: () => Date}} [input]
   *   `fallbacks` maps a resource to the resources that may carry its load, in order.
   */
  constructor({ breaker = null, fallbacks = {}, clock = () => new Date() } = {}) {
    for (const [resource, alternatives] of Object.entries(fallbacks)) {
      if (!Array.isArray(alternatives) || alternatives.some((alternative) => typeof alternative !== 'string')) {
        throw new OmegaError('OMEGA_E_HEAL', `fallbacks for ${resource} must be a list of resources`);
      }
    }
    this.#breaker = breaker;
    this.#fallbacks = { ...fallbacks };
    this.#clock = clock;
  }

  /**
   * @param {{resource: string, code: string|null, step?: number}} failure
   * @returns {object} a heal event: what the failure was, and what may happen next
   */
  observe({ resource, code = null, step = null }) {
    if (typeof resource !== 'string' || resource.length === 0) {
      throw new OmegaError('OMEGA_E_HEAL', 'a failure needs a resource');
    }
    const classification = classify(code);
    const alternatives = this.#fallbacks[resource] ?? [];
    const breakerState = this.#breaker === null ? null : this.#breaker.check(resource);

    let action = 'stop';
    let substitute = null;
    if (classification === 'transient') {
      if (breakerState !== null && breakerState.open && alternatives.length > 0) {
        action = 'substitute';
        substitute = alternatives[0];
      } else {
        action = 'retry';
      }
    }

    const incident = {
      nexa: 'omega1',
      kind: 'HealEvent',
      seq: this.#incidents.length,
      at: this.#clock().toISOString(),
      resource,
      step,
      code,
      classification,
      // The phase this event *reports*: an open breaker is isolation, a refusal to
      // proceed is a diagnosis, a declared substitute is a recovery plan.
      phase: classification === 'transient' && breakerState?.open === true ? 'isolate' : 'diagnose',
      action,
      substitute,
      fallbacks: alternatives.length,
      breaker_open: breakerState?.open ?? null,
    };
    this.#incidents.push(incident);
    return { ...incident };
  }

  /**
   * A recovery is only a recovery once the substitute (or the original, after a probe)
   * works.
   * @param {string} resource
   * @param {boolean} ok
   * @returns {object|null} a heal event, or null when there was nothing to recover
   */
  verify(resource, ok) {
    const incident = [...this.#incidents].reverse().find((entry) => entry.resource === resource);
    if (incident === undefined) return null;
    const event = {
      nexa: 'omega1',
      kind: 'HealEvent',
      seq: this.#incidents.length,
      at: this.#clock().toISOString(),
      resource,
      code: incident.code,
      classification: incident.classification,
      phase: 'verify',
      action: ok ? 'recovered' : 'stop',
      substitute: incident.substitute,
      fallbacks: incident.fallbacks,
      breaker_open: ok && this.#breaker !== null ? this.#breaker.check(resource).open : incident.breaker_open,
    };
    this.#incidents.push(event);
    if (ok && this.#breaker !== null) this.#breaker.reset(resource);
    return { ...event };
  }

  /** @returns {object[]} every heal event, in order */
  incidents() {
    return this.#incidents.map((incident) => ({ ...incident }));
  }

  /** @returns {object[]} incidents that are still open (no successful verify after them) */
  open() {
    const resolved = new Set();
    for (const incident of this.#incidents) {
      if (incident.phase === 'verify' && incident.action === 'recovered') resolved.add(incident.resource);
    }
    return this.incidents().filter((incident) => incident.phase !== 'verify' && !resolved.has(incident.resource));
  }

  /** @returns {object} */
  describe() {
    const byClassification = {};
    for (const incident of this.#incidents) {
      byClassification[incident.classification] = (byClassification[incident.classification] ?? 0) + 1;
    }
    return {
      phases: [...HEAL_PHASES],
      events: this.#incidents.length,
      open: this.open().length,
      by_classification: byClassification,
      fallbacks: Object.fromEntries(Object.entries(this.#fallbacks).map(([resource, alternatives]) => [resource, [...alternatives]])),
    };
  }
}
