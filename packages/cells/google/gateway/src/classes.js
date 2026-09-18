/**
 * Risk classes — an operation's effect, not a cell's personality.
 *
 *     Risk class is a property of the triple (resource, action, scope/effect)
 *     and MUST NOT be inherited solely from Cell identity.
 *
 * One cell can hold a harmless read and a send that leaves the building, so the class
 * follows the operation. `max_class` belongs to the cell's nucleus, and an operation above
 * the ceiling **fails during authorization and mints nothing** — which is why this check
 * lives here, before any capability is asked for, rather than in the code that does the work.
 *
 * The ladder, by effect:
 *
 *     A  reads metadata — no content, no egress
 *     B  reads content, or invokes a model at a cost
 *     C  writes inside one named object, correctable
 *     D  egresses or is irreversible (sending, sharing, deleting, changing permissions)
 *
 * Roles only ever *inform* the ceiling. `owner` and `admin` may reach D; a `recovery` binding
 * may reach nothing but identity verification, which is what makes break-glass a recovery
 * state rather than a second owner.
 */
import { OmegaError } from '../../../../compiler/index.js';

export const RISK_CLASSES = Object.freeze(['A', 'B', 'C', 'D']);

/** @param {string} riskClass @returns {number} */
export function classRank(riskClass) {
  const rank = RISK_CLASSES.indexOf(riskClass);
  if (rank === -1) throw new OmegaError('OMEGA_E_SCHEMA', `unknown risk class: ${String(riskClass)}`, { known: [...RISK_CLASSES] });
  return rank;
}

/**
 * The § G0-E capability mapping, as data. `scope` names the row of `GOOGLE_SCOPE_TABLE` the
 * operation is admitted under, so an operation cannot exist without a documented question.
 */
export const GOOGLE_OPERATIONS = Object.freeze([
  { operation: 'identity.verify', resource: 'cell:google.identity', action: 'verify', capability: 'identity.verify', class: 'A', scope: null, note: 'no Google user data; the JWKS is public key material' },
  { operation: 'drive.read.metadata', resource: 'net:google.drive', action: 'read', capability: 'net.read(scope "drive.metadata")', class: 'A', scope: { cell: 'google.drive', action: 'read.metadata' } },
  { operation: 'drive.read.content', resource: 'net:google.drive', action: 'read', capability: 'net.read(scope "drive.content")', class: 'B', scope: { cell: 'google.drive', action: 'read.content' } },
  { operation: 'sheets.read.range', resource: 'net:google.sheets', action: 'read', capability: 'net.read(scope "sheets.values")', class: 'B', scope: { cell: 'google.sheets', action: 'read.range' } },
  { operation: 'gmail.read.message', resource: 'net:google.gmail', action: 'read', capability: 'net.read(scope "gmail.messages")', class: 'B', scope: { cell: 'google.gmail', action: 'read.message' } },
  { operation: 'gmail.send', resource: 'net:google.gmail', action: 'send', capability: 'net.send(scope "gmail.send")', class: 'D', scope: { cell: 'google.gmail', action: 'send' } },
  { operation: 'calendar.read.events', resource: 'net:google.calendar', action: 'read', capability: 'net.read(scope "calendar.events")', class: 'B', scope: { cell: 'google.calendar', action: 'read.events' } },
  { operation: 'model.invoke', resource: 'model:gemini', action: 'invoke', capability: 'model.invoke(provider: "gemini")', class: 'B', scope: { cell: 'google.gemini', action: 'invoke' } },
].map((row) => Object.freeze(row)));

/** @param {string} name @returns {Readonly<object>} */
export function googleOperation(name) {
  const operation = GOOGLE_OPERATIONS.find((row) => row.operation === name);
  if (operation === undefined) {
    throw new OmegaError('OMEGA_E_SCHEMA', `unknown Google operation: ${String(name)}`, { known: GOOGLE_OPERATIONS.map((row) => row.operation) });
  }
  return operation;
}

/** What a role may reach at most. Roles inform the policy; they never mint. */
export const ROLE_CEILINGS = Object.freeze({
  owner: 'D',
  admin: 'D',
  developer: 'C',
  agent: 'B',
  viewer: 'A',
  recovery: 'A',
});

/** The only operation a recovery binding may reach — break-glass is not a second owner. */
export const RECOVERY_OPERATIONS = Object.freeze(['identity.verify']);

/**
 * @param {{cell: string, maxClass: string, operation: object, binding?: object|null}} input
 * @returns {Readonly<object>} the operation, having proved it is inside every ceiling
 */
export function assertWithinCeiling({ cell, maxClass, operation, binding = null }) {
  if (binding !== null && binding.method === 'break-glass' && !RECOVERY_OPERATIONS.includes(operation.operation)) {
    throw new OmegaError('OMEGA_E_CLASS_CEILING', `a break-glass binding may not reach ${operation.operation}`, {
      cell,
      operation: operation.operation,
      recovery_operations: [...RECOVERY_OPERATIONS],
    });
  }
  if (classRank(operation.class) > classRank(maxClass)) {
    throw new OmegaError('OMEGA_E_CLASS_CEILING', `${operation.operation} is class ${operation.class}, above the ceiling ${maxClass} of ${cell}`, {
      cell,
      operation: operation.operation,
      class: operation.class,
      max_class: maxClass,
    });
  }
  if (binding !== null) {
    const roleCeiling = ROLE_CEILINGS[binding.role];
    if (roleCeiling === undefined) {
      throw new OmegaError('OMEGA_E_CLASS_CEILING', `unknown role ${String(binding.role)} has no ceiling, so it has no access`, { role: binding.role });
    }
    if (classRank(operation.class) > classRank(roleCeiling)) {
      throw new OmegaError('OMEGA_E_CLASS_CEILING', `role ${binding.role} may not reach class ${operation.class} (${operation.operation})`, {
        role: binding.role,
        role_ceiling: roleCeiling,
        class: operation.class,
      });
    }
  }
  return operation;
}
