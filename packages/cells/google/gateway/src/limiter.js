/**
 * Quota discipline — the provider's limits are read, not assumed.
 *
 * Google's project quotas change (Drive's project limits, Sheets' per-minute project quota,
 * Gmail's per-user quota), so no number is hard-coded as truth: `observe()` reads whatever the
 * response says and the limiter adapts. Three behaviours, all of them testable:
 *
 *   · **one flight per service** — a second call while one is in flight is refused, not
 *     duplicated. A retry storm is how a small quota becomes a denial of service.
 *   · **backoff with jitter** — `429` opens a window whose delay grows exponentially up to a
 *     cap, with jitter from an injected port so a test can pin the sequence.
 *   · **exhaustion is contained** — the refusal is `OMEGA_E_QUOTA`, recorded as a `QUOTA`
 *     record with `retry_after_ms` and the remaining quota the provider reported, and the
 *     caller (a service cell) degrades rather than crashing. The homeostat decides what
 *     happens next; a limiter does not decide anything about authority.
 */
import { OmegaError } from '../../../../compiler/index.js';

export const DEFAULT_LIMITS = Object.freeze({
  default: Object.freeze({ calls: 60, window_ms: 60_000 }),
});

/** @param {object} entry @returns {boolean} */
const isLive = (entry) => entry !== null && entry !== undefined;

/**
 * @param {{clock: () => Date, limits?: Record<string, {calls: number, window_ms: number}>,
 *          record?: Function|null, sleep?: (ms: number) => void, random?: () => number,
 *          baseDelayMs?: number, maxDelayMs?: number}} input
 */
export function createLimiter({
  clock,
  limits = DEFAULT_LIMITS,
  record = null,
  sleep = () => {},
  random = () => 0,
  baseDelayMs = 1_000,
  maxDelayMs = 64_000,
}) {
  const windows = new Map();
  const backoff = new Map();
  const inFlight = new Set();
  let throttled = 0;
  let denied = 0;

  const limitFor = (service) => limits[service] ?? limits.default ?? { calls: 60, window_ms: 60_000 };

  const windowOf = (service) => {
    const now = clock().getTime();
    const current = windows.get(service);
    if (!isLive(current) || now - current.started_at >= limitFor(service).window_ms) {
      const fresh = { started_at: now, calls: 0 };
      windows.set(service, fresh);
      return fresh;
    }
    return current;
  };

  const refuse = (service, reason, detail = {}) => {
    throttled += 1;
    denied += 1;
    if (record !== null) {
      record({
        kind: 'QUOTA',
        decision: 'DENY',
        resource: `net:google.${service}`,
        action: 'call',
        detail: { service, ...detail, throttled },
      });
    }
    throw new OmegaError('OMEGA_E_QUOTA', reason, { service, ...detail });
  };

  return {
    /**
     * May this service be called right now?
     * @param {{service: string}} input
     * @returns {{ok: true, remaining: number}}
     */
    schedule({ service }) {
      const waiting = backoff.get(service);
      if (waiting !== undefined && waiting.until > clock().getTime()) {
        refuse(service, `${service} is backing off for another ${waiting.until - clock().getTime()}ms`, { retry_after_ms: waiting.until - clock().getTime() });
      }
      if (inFlight.has(service)) {
        refuse(service, `${service} already has a call in flight; a second one would double the burn rate`, { in_flight: true });
      }
      const window = windowOf(service);
      const limit = limitFor(service);
      if (window.calls >= limit.calls) {
        refuse(service, `${service} reached its own ceiling of ${limit.calls} calls per ${limit.window_ms}ms`, { limit: limit.calls, window_ms: limit.window_ms });
      }
      window.calls += 1;
      return { ok: true, remaining: limit.calls - window.calls };
    },

    /**
     * Read the provider's answer. `retry_after_ms` is whatever the provider said; the delay is
     * exponential from there, capped, with jitter.
     * @param {{service: string, status?: number, retry_after_ms?: number|null, remaining?: number|null}} input
     */
    observe({ service, status = 200, retry_after_ms = null, remaining = null }) {
      if (status !== 429) {
        backoff.delete(service);
        return { backing_off: false };
      }
      const previous = backoff.get(service)?.attempts ?? 0;
      const attempts = previous + 1;
      const base = retry_after_ms ?? Math.min(baseDelayMs * (2 ** (attempts - 1)), maxDelayMs);
      const delay = Math.min(Math.round(base + (random() * baseDelayMs)), maxDelayMs);
      backoff.set(service, { until: clock().getTime() + delay, attempts, delay });
      if (record !== null) {
        record({
          kind: 'QUOTA',
          decision: 'DENY',
          resource: `net:google.${service}`,
          action: 'call',
          detail: { service, status, retry_after_ms: delay, attempts, remaining },
        });
      }
      throttled += 1;
      return { backing_off: true, retry_after_ms: delay, attempts };
    },

    /** Wait out the current window if there is one. Never a tight loop: the delay is positive. */
    wait({ service }) {
      const waiting = backoff.get(service);
      if (waiting === undefined) return { waited_ms: 0 };
      const remaining = Math.max(0, waiting.until - clock().getTime());
      if (remaining > 0) sleep(remaining);
      return { waited_ms: remaining };
    },

    /**
     * The wrapper a service cell uses: schedule, single flight, call, read the answer.
     * @param {{service: string, invoke: Function}} input
     */
    call({ service, invoke }) {
      this.schedule({ service });
      inFlight.add(service);
      try {
        const response = invoke();
        this.observe({ service, status: response?.status ?? 200, retry_after_ms: response?.retry_after_ms ?? null, remaining: response?.remaining ?? null });
        return response;
      } finally {
        inFlight.delete(service);
      }
    },

    /** @returns {object} what a report may say: counts, never tokens */
    metrics() {
      return {
        throttled,
        denied,
        services: [...new Set([...windows.keys(), ...backoff.keys()])].sort().map((service) => ({
          service,
          calls: windows.get(service)?.calls ?? 0,
          limit: limitFor(service).calls,
          backoff_until: backoff.get(service)?.until ?? null,
        })),
      };
    },
  };
}
