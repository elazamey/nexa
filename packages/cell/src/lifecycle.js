/**
 * Cell lifecycle.
 *
 * A cell is never "just running". It is in exactly one state, and the transitions are a
 * closed set: a degraded cell cannot return to active without a verification, an isolated
 * cell cannot serve messages at all, and a retired cell cannot come back. These are the
 * invariants the Nucleus exists to hold, and they are enforced here rather than trusted to
 * whichever component happens to be driving the state.
 */
import { OmegaError } from '../../compiler/index.js';

export const CELL_STATES = Object.freeze(['DEFINED', 'READY', 'ACTIVE', 'DEGRADED', 'ISOLATED', 'RETIRED']);

/** Which state may follow which. `DEGRADED → ACTIVE` and `ISOLATED → READY` exist only
 * through `verify()`, which is the only API that performs them. */
export const TRANSITIONS = Object.freeze({
  DEFINED: ['READY', 'RETIRED'],
  READY: ['ACTIVE', 'ISOLATED', 'RETIRED'],
  ACTIVE: ['DEGRADED', 'ISOLATED', 'RETIRED'],
  DEGRADED: ['ISOLATED', 'ACTIVE', 'RETIRED'],
  ISOLATED: ['READY', 'RETIRED'],
  RETIRED: [],
});

/**
 * The states in which a cell will answer a message. DEGRADED serves: it is the warning
 * state — traffic continues while the homeostat watches — and ISOLATED is what stops it.
 */
export const SERVING_STATES = Object.freeze(['ACTIVE', 'DEGRADED']);

/** The states in which a cell will answer a life-support message (`health`, `recover`). */
export const DIAGNOSTIC_STATES = Object.freeze(['READY', 'ACTIVE', 'DEGRADED', 'ISOLATED']);

/**
 * @param {string} from @param {string} to
 * @returns {string} the state, having proved the transition is legal
 */
export function transition(from, to) {
  if (!CELL_STATES.includes(from) || !CELL_STATES.includes(to)) {
    throw new OmegaError('OMEGA_E_LIFECYCLE', `unknown cell state: ${!CELL_STATES.includes(from) ? from : to}`, { known: [...CELL_STATES] });
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new OmegaError('OMEGA_E_LIFECYCLE', `a cell cannot move from ${from} to ${to}`, { from, to, allowed: [...TRANSITIONS[from]] });
  }
  return to;
}
