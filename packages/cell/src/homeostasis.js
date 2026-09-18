/**
 * Homeostasis — the organ keeps its own house.
 *
 * An organ owns tissues, and this is where the organ acts on what the membranes recorded:
 * it watches failure rates per cell, and a cell that keeps refusing traffic is **isolated**
 * by its tissue, not by the caller. Isolation is not punishment, it is containment: the
 * membrane then refuses everything with `OMEGA_E_ISOLATED` until a verified recovery.
 *
 * The organ cannot heal itself and does not try: it detects, isolates and reports. Repair
 * is a proposal that goes through the Evolution Gate like every other change.
 */
import { OmegaError } from '../../compiler/index.js';

/** Default thresholds, in integers. A cell with 3 consecutive failures or 40% failures is sick. */
export const DEFAULT_HOMEOSTASIS = Object.freeze({ max_failure_rate_bp: 4_000, min_calls_for_rate: 3, max_consecutive_failures: 3 });

/**
 * @param {object} input
 * @param {object} input.organ an organ (tissues + contract)
 * @param {{max_failure_rate_bp?: number, min_calls_for_rate?: number, max_consecutive_failures?: number}} [input.policy]
 * @param {{onIsolate?: Function, onDegrade?: Function}} [input.hooks]
 */
export function createHomeostat({ organ, policy = {}, hooks = {} }) {
  const rules = { ...DEFAULT_HOMEOSTASIS, ...policy };
  if (!Number.isSafeInteger(rules.max_failure_rate_bp) || rules.max_failure_rate_bp < 0 || rules.max_failure_rate_bp > 10_000) {
    throw new OmegaError('OMEGA_E_HOMEOSTASIS', 'max_failure_rate_bp is basis points between 0 and 10000');
  }
  if (!Number.isSafeInteger(rules.max_consecutive_failures) || rules.max_consecutive_failures < 1) {
    throw new OmegaError('OMEGA_E_HOMEOSTASIS', 'max_consecutive_failures is a positive integer');
  }

  const history = [];

  /**
   * One reading of the organ, with a decision per cell.
   * @returns {{organ: string, at: string, calls: number, failures: number, failure_rate_bp: number,
   *            sick: object[], decisions: object[]}}
   */
  function sample() {
    const cells = [];
    for (const tissue of organ.tissues.values()) {
      for (const cell of tissue.cells.values()) cells.push({ tissue: tissue.name, cell });
    }
    const readings = cells.map(({ tissue, cell }) => {
      const metrics = cell.metrics();
      const ill =
        metrics.consecutive_failures >= rules.max_consecutive_failures ||
        (metrics.calls >= rules.min_calls_for_rate && metrics.failure_rate_bp > rules.max_failure_rate_bp);
      return { tissue, cell: cell.name, state: cell.state, ...metrics, ill };
    });
    const calls = readings.reduce((sum, entry) => sum + entry.calls, 0);
    const failures = readings.reduce((sum, entry) => sum + entry.failures, 0);
    const reading = {
      organ: organ.name,
      policy: { ...rules },
      calls,
      failures,
      failure_rate_bp: calls === 0 ? 0 : Math.round((failures / calls) * 10_000),
      sick: readings.filter((entry) => entry.ill).map((entry) => ({ tissue: entry.tissue, cell: entry.cell, code: entry.last_code, state: entry.state })),
      cells: readings,
    };
    return reading;
  }

  /**
   * Act on a reading: isolate what is ill, and say why. Never restore — restoration needs a
   * verified recovery.
   * @returns {{reading: object, isolated: object[], degraded: object[]}}
   */
  function enforce() {
    const reading = sample();
    const isolated = [];
    const degraded = [];
    for (const entry of reading.cells) {
      const cell = organ.tissues.get(entry.tissue).cells.get(entry.cell);
      if (!entry.ill) continue;
      if (cell.state === 'ACTIVE') {
        cell.degrade(entry.last_code ?? 'OMEGA_E_HANDLER');
        degraded.push({ tissue: entry.tissue, cell: entry.cell, code: entry.last_code });
        hooks.onDegrade?.({ tissue: entry.tissue, cell: entry.cell, code: entry.last_code });
      }
      if (entry.consecutive_failures >= rules.max_consecutive_failures && cell.state !== 'ISOLATED' && cell.state !== 'RETIRED') {
        cell.isolate();
        isolated.push({ tissue: entry.tissue, cell: entry.cell, code: entry.last_code });
        hooks.onIsolate?.({ tissue: entry.tissue, cell: entry.cell, code: entry.last_code });
      }
    }
    history.push({ at: reading.cells.length, isolated: isolated.length, degraded: degraded.length });
    return { reading, isolated, degraded };
  }

  return {
    policy: { ...rules },
    sample,
    enforce,
    /** @returns {object[]} every enforcement action taken so far */
    history: () => history.map((entry) => ({ ...entry })),
    /** @returns {object} the organ's health, with the isolation it has applied */
    report() {
      return { reading: sample(), isolation: organ.health().isolated, actions: history.map((entry) => ({ ...entry })) };
    },
  };
}
