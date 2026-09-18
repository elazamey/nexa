/**
 * `authorizeGoogleCall` — the gate every Google operation passes, in order.
 *
 *     1. the operation exists and is a row of the mapping table
 *     2. the class is inside the cell's `max_class` **and** inside the role's ceiling
 *     3. the scope, if the operation has one, is admitted for this cell, action and phase
 *     4. the capability verifies — presenter-bound, single-use, trusted-issuer-only
 *     5. class D additionally consumes a single-use approval for this exact operation
 *
 * Two things this function is not. It does not mint: verification is done by the port the
 * caller passes in, and that port belongs to the authority, which the gateway never holds.
 * It does not know the owner: the *subject* of the capability is the service cell's key, and
 * the owner appears only as the author of an approval.
 *
 * The ceiling is checked before the capability on purpose. An operation above `max_class` must
 * fail during authorization and mint nothing, so the failure has to happen before anyone is in
 * a position to mint — a cell that is asked for something above its ceiling does not get a
 * token that then goes unused.
 */
import { NexaError } from '../../../../ast/index.js';
import { OmegaError } from '../../../../compiler/index.js';
import { admitScope } from './scopes.js';
import { assertWithinCeiling, googleOperation } from './classes.js';

/**
 * Refuse with the code the *refusing layer* chose. The capability layer refuses with `NEXA_E_*`
 * codes and the Ω layer with `OMEGA_E_*`, and each error class only accepts its own vocabulary —
 * so a refusal is re-thrown in the class its code belongs to rather than flattened into one. A
 * gateway that rewrote every capability refusal as its own code would erase the distinction the
 * codes exist to make.
 *
 * @param {string} code @param {string} message @param {object} [details]
 * @returns {never}
 */
function refuse(code, message, details = {}) {
  if (typeof code === 'string' && code.startsWith('NEXA_E_')) throw new NexaError(code, message);
  throw new OmegaError(code, message, details);
}

/**
 * @param {object} input
 * @param {string} input.operation a row name from `GOOGLE_OPERATIONS`
 * @param {string} input.cell the service cell asking
 * @param {string} input.maxClass the ceiling declared with the cell's nucleus
 * @param {object|null} [input.capability] the token the cell presents
 * @param {string} input.presenter the presenting cell's key id
 * @param {(token: object, input: object) => object} input.verify the authority's verify port
 * @param {() => Date} input.clock
 * @param {object|null} [input.binding] the owner binding whose role informs the ceiling
 * @param {{consume: Function}|null} [input.approvals] required for class D
 * @param {string|null} [input.approval_id] the approval offered for this operation
 * @param {string|null} [input.scope] the scope being requested, if any
 * @param {string} [input.phase] the phase whose scope rows may be requested (default G0)
 * @returns {{ok: true, operation: object, scope: object|null, approval: object|null, grant: object|null}}
 */
export function authorizeGoogleCall({
  operation,
  cell,
  maxClass,
  capability = null,
  presenter,
  verify,
  clock,
  binding = null,
  approvals = null,
  approval_id = null,
  scope = null,
  phase = 'G0',
}) {
  if (typeof verify !== 'function') throw new OmegaError('OMEGA_E_SCHEMA', 'authorization needs a verify port; the gateway holds no authority of its own');
  const row = googleOperation(operation);

  // 2. ceiling — before anything is minted, and before the network is anywhere in sight.
  assertWithinCeiling({ cell, maxClass, operation: row, binding });

  // 3. scope — a scope outside the table, or outside this phase, never reaches a consent screen.
  let admitted = null;
  if (scope !== null) {
    if (row.scope === null) {
      throw new OmegaError('OMEGA_E_SCOPE', `${operation} needs no OAuth scope; ${scope} was not admitted`, { operation, scope });
    }
    admitted = admitScope({ cell: row.scope.cell, action: row.scope.action, scope, phase });
  }

  // 4. capability — the authority's verdict, not ours.
  const verdict = verify(capability, { presenter, resource: row.resource, action: row.action, at: clock() });
  if (verdict?.ok !== true) {
    refuse(verdict?.code ?? 'OMEGA_E_CAP_MISSING', verdict?.reason ?? 'the capability did not verify', { operation, presenter, resource: row.resource });
  }

  // 5. class D: capability and approval, both. Never one instead of the other.
  let approval = null;
  if (row.class === 'D') {
    if (approvals === null || approval_id === null) {
      throw new OmegaError('OMEGA_E_APPROVAL_REQUIRED', `${operation} is class D: it needs an explicit owner approval, not only a capability`, { operation, class: row.class });
    }
    approval = approvals.consume({ approval_id, resource: row.resource, action: row.action, scope: scope ?? null });
  }

  return { ok: true, operation: row, scope: admitted, approval, grant: verdict.grant ?? null };
}
