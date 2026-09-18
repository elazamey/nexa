/**
 * Cell health — the local half of homeostasis.
 *
 * The runtime already owns a circuit breaker, so the cell layer does not invent a second
 * one: `Health` *is* a circuit breaker plus the counters a homeostat needs (calls,
 * failures, latency, evidence continuity). Everything is an integer — rates are basis
 * points — because cell state ends up in evidence, and evidence is canonical data.
 */
import { OmegaError } from '../../compiler/index.js';
import { CircuitBreaker } from '../../runtime/index.js';

export const HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'isolated']);

export class Health {
  #calls = 0;
  #failures = 0;
  #latencyMs = 0;
  #lastCode = null;
  #breaker;
  #threshold;

  /**
   * @param {{threshold?: number, cooldownMs?: number, clock?: () => Date}} [input]
   */
  constructor({ threshold = 3, cooldownMs = 60_000, clock = () => new Date() } = {}) {
    if (!Number.isSafeInteger(threshold) || threshold < 1) {
      throw new OmegaError('OMEGA_E_SCHEMA', 'a health threshold must be a positive integer');
    }
    this.#threshold = threshold;
    this.#breaker = new CircuitBreaker({ threshold, cooldownMs, clock });
  }

  /**
   * @param {{resource: string, ok: boolean, code?: string|null, latency_ms?: number}} input
   * @returns {object} the resulting health
   */
  observe({ resource, ok, code = null, latency_ms = 0 }) {
    if (!Number.isSafeInteger(latency_ms) || latency_ms < 0) {
      throw new OmegaError('OMEGA_E_SCHEMA', 'latency_ms must be a non-negative integer');
    }
    this.#calls += 1;
    this.#latencyMs += latency_ms;
    if (!ok) {
      this.#failures += 1;
      this.#lastCode = code ?? 'OMEGA_E_UNKNOWN';
    }
    this.#breaker.record(resource, ok);
    return this.state(resource);
  }

  /** @param {string} resource @returns {'healthy'|'degraded'|'isolated'} */
  state(resource) {
    const breaker = this.#breaker.check(resource);
    if (breaker.open === true) return 'isolated';
    if (this.#failures > 0) return 'degraded';
    return 'healthy';
  }

  /** @param {string} resource @returns {object} */
  metrics(resource) {
    const breaker = this.#breaker.check(resource);
    return {
      calls: this.#calls,
      failures: this.#failures,
      failure_rate_bp: this.#calls === 0 ? 0 : Math.round((this.#failures / this.#calls) * 10_000),
      latency_ms_total: this.#latencyMs,
      latency_ms_avg: this.#calls === 0 ? 0 : Math.round(this.#latencyMs / this.#calls),
      last_code: this.#lastCode,
      consecutive_failures: breaker.failures,
      breaker: { open: breaker.open === true, failures: breaker.failures },
      state: this.state(resource),
    };
  }

  /** A verified recovery is the only thing that clears a cell's failure record. */
  clear() {
    this.#failures = 0;
    this.#lastCode = null;
  }

  /** Clearing one resource's breaker — used by recovery, never by a timer. */
  recover(resource) {
    this.#breaker.reset(resource);
    this.clear();
    return this.state(resource);
  }
}
