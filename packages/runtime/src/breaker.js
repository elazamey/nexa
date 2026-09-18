/**
 * Circuit breaker — the containment half of self-healing.
 *
 * The design's rule is "detect → isolate → diagnose → recover → replay → learn", and the
 * part that has to be mechanical is *isolate*. After `threshold` consecutive failures of
 * one resource the breaker opens: further calls are refused by the runtime before any
 * envelope is built, with `OMEGA_E_CIRCUIT_OPEN`, and the refusal is recorded. A retry
 * storm is not a failure mode this runtime has.
 */
export class CircuitBreaker {
  #state = new Map();

  /**
   * @param {{threshold?: number, cooldownMs?: number, clock?: () => Date}} [input]
   */
  constructor({ threshold = 3, cooldownMs = 60_000, clock = () => new Date() } = {}) {
    if (!Number.isSafeInteger(threshold) || threshold < 1) {
      throw new RangeError('threshold must be a positive integer');
    }
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.clock = clock;
  }

  #entry(resource) {
    if (!this.#state.has(resource)) {
      this.#state.set(resource, { resource, failures: 0, openedAt: null, openedCount: 0 });
    }
    return this.#state.get(resource);
  }

  /** @param {string} resource */
  check(resource) {
    const entry = this.#entry(resource);
    if (entry.failures < this.threshold) return { open: false, failures: entry.failures };
    const elapsed = this.clock().getTime() - entry.openedAt;
    if (elapsed >= this.cooldownMs) {
      // Half-open: one probe is allowed; if it fails the breaker closes again.
      return { open: false, failures: entry.failures, probe: true };
    }
    return {
      open: true,
      failures: entry.failures,
      cooldown_remaining_ms: this.cooldownMs - elapsed,
      opened_count: entry.openedCount,
    };
  }

  /**
   * @param {string} resource
   * @param {boolean} ok
   */
  record(resource, ok) {
    const entry = this.#entry(resource);
    if (ok) {
      entry.failures = 0;
      entry.openedAt = null;
      return { ...entry };
    }
    entry.failures += 1;
    if (entry.failures >= this.threshold) {
      entry.openedAt = this.clock().getTime();
      entry.openedCount += 1;
    }
    return { ...entry };
  }

  /** @param {string} resource */
  reset(resource) {
    const entry = this.#entry(resource);
    entry.failures = 0;
    entry.openedAt = null;
    return { ...entry };
  }

  /** @returns {object[]} */
  snapshot() {
    return [...this.#state.values()]
      .map((entry) => ({ ...entry, open: entry.failures >= this.threshold }))
      .sort((a, b) => a.resource.localeCompare(b.resource));
  }
}
