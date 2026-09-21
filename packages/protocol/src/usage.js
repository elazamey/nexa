/**
 * @nexa/protocol — per-mission usage meter (v13-4).
 *
 * The honest counter behind the governance dashboard: every mission step
 * records what it really consumed (runs, input/output bytes, wall duration,
 * success or failure). Summaries aggregate per mission, per step kind, and
 * globally. Cost is $0.00 by construction — NEXA executes local-first with
 * no paid providers — and the token figure is labeled for what it is: a
 * deterministic bytes/4 heuristic, never a provider-reported count.
 *
 * Observational by design: reads never throw for unknown missions (they
 * summarize to zeros); writes validate at the boundary (NEXA_E_SCHEMA).
 * Pure module: deps limited to @nexa/ast, no fs, no net, no real time
 * (the clock is injected).
 */
import { NexaError, formatInstant } from '../../ast/index.js';

/** Step kinds the meter accepts (frozen — mirrors the mission engine). */
export const USAGE_KINDS = Object.freeze(['terminal', 'creative']);

const MAX_BYTES = 64 * 1024 * 1024; // sanity cap: ports cap outputs far below this
const ZERO_KIND = () => ({ runs: 0, failed: 0, inputBytes: 0, outputBytes: 0, durationMs: 0 });
const NOTE =
  'cost is $0.00: local-first execution, no paid providers; ' +
  'tokens are a bytes/4 heuristic, not provider-reported';

function requireCounter(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_BYTES) {
    throw new NexaError('NEXA_E_SCHEMA', `${name} must be an integer in [0, ${MAX_BYTES}]`);
  }
  return value;
}

export class UsageMeter {
  #now = () => new Date();
  /** @type {object[]} append-only usage entries */
  #entries = [];

  /** @param {{now?: () => Date}} [options] injected clock (deterministic in tests) */
  constructor({ now = () => new Date() } = {}) {
    this.#now = now;
  }

  /**
   * Record one step execution.
   * @returns {{seq: number}}
   */
  record({ missionId, stepIndex, kind, inputBytes, outputBytes, durationMs, ok = true } = {}) {
    if (typeof missionId !== 'string' || missionId.length === 0 || missionId.length > 128) {
      throw new NexaError('NEXA_E_SCHEMA', 'missionId must be a non-empty string of ≤ 128 chars');
    }
    if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) {
      throw new NexaError('NEXA_E_SCHEMA', 'stepIndex must be an integer ≥ 0');
    }
    if (!USAGE_KINDS.includes(kind)) {
      throw new NexaError('NEXA_E_SCHEMA', `kind must be one of ${USAGE_KINDS.join(', ')}`);
    }
    requireCounter(inputBytes, 'inputBytes');
    requireCounter(outputBytes, 'outputBytes');
    requireCounter(durationMs, 'durationMs');
    if (typeof ok !== 'boolean') {
      throw new NexaError('NEXA_E_SCHEMA', 'ok must be a boolean');
    }
    const seq = this.#entries.length;
    this.#entries.push({
      seq,
      at: formatInstant(this.#now()),
      missionId,
      stepIndex,
      kind,
      inputBytes,
      outputBytes,
      durationMs,
      ok,
    });
    return { seq };
  }

  /**
   * Aggregate one mission. Unknown missions summarize to zeros.
   * @returns {{missionId: string, records: number, steps: number, failed: number,
   *   byKind: object, totals: object, tokensEstimated: number,
   *   costMicros: number, currency: string, note: string}}
   */
  summary(missionId) {
    if (typeof missionId !== 'string' || missionId.length === 0 || missionId.length > 128) {
      throw new NexaError('NEXA_E_SCHEMA', 'missionId must be a non-empty string of ≤ 128 chars');
    }
    const rows = this.#entries.filter((entry) => entry.missionId === missionId);
    return this.#aggregate(missionId, rows);
  }

  /** Aggregate across all missions. */
  summaryAll() {
    const { missionId: _omit, steps: _steps, ...rest } = this.#aggregate(null, this.#entries);
    return {
      missions: new Set(this.#entries.map((entry) => entry.missionId)).size,
      ...rest,
    };
  }

  /**
   * @param {string|null} missionId null returns every entry
   * @returns {object[]} defensive copies in seq order
   */
  entries(missionId = null) {
    const rows = missionId === null
      ? this.#entries
      : this.#entries.filter((entry) => entry.missionId === missionId);
    return rows.map((entry) => ({ ...entry }));
  }

  // --- internals -----------------------------------------------------------

  #aggregate(missionId, rows) {
    const byKind = { terminal: ZERO_KIND(), creative: ZERO_KIND() };
    const totals = { runs: 0, failed: 0, inputBytes: 0, outputBytes: 0, durationMs: 0 };
    const steps = new Set();
    for (const row of rows) {
      steps.add(row.stepIndex);
      const bucket = byKind[row.kind];
      bucket.runs += 1;
      bucket.inputBytes += row.inputBytes;
      bucket.outputBytes += row.outputBytes;
      bucket.durationMs += row.durationMs;
      totals.runs += 1;
      totals.inputBytes += row.inputBytes;
      totals.outputBytes += row.outputBytes;
      totals.durationMs += row.durationMs;
      if (row.ok !== true) {
        bucket.failed += 1;
        totals.failed += 1;
      }
    }
    const bytes = totals.inputBytes + totals.outputBytes;
    return {
      missionId,
      records: rows.length,
      steps: steps.size,
      failed: totals.failed,
      byKind,
      totals,
      tokensEstimated: Math.ceil(bytes / 4),
      costMicros: 0,
      currency: 'USD',
      note: NOTE,
    };
  }
}
