/**
 * The Google service cells, their ceilings, and the grant templates the host mints from.
 *
 * Two halves, deliberately kept apart:
 *
 *   · **data** — `GOOGLE_SERVICE_CELLS` declares each service cell's `max_class`, and
 *     `googleGrantTemplates` turns the § G0-E mapping table into grant templates naming
 *     `net:google.*` / `model:gemini`. A template is a description of what the authority may be
 *     willing to mint, exactly like an Ω grant: it is not a permission, and holding it grants
 *     nothing.
 *   · **verification** — `createGoogleCallPort` verifies a presented capability and tracks
 *     single use. It **does not mint**: the gateway holds no authority, so the object it builds
 *     is only ever the verifying half. The minting half is the host's, precisely as with every
 *     other tissue.
 *
 * That split is why this package can be trusted with the provider's keys and still be unable to
 * grant itself anything.
 */
import { verifyCapability } from '../../../../capability/index.js';
import { OmegaError } from '../../../../compiler/index.js';
import { GOOGLE_OPERATIONS } from './classes.js';

/** Each service cell's ceiling, declared with its nucleus. `max_class` is not editable at run time. */
export const GOOGLE_SERVICE_CELLS = Object.freeze({
  'google.identity': Object.freeze({ max_class: 'A', nucleus: Object.freeze({ module: 'google.identity@1', invariants: Object.freeze(['sub is the identity key; email is display metadata', 'verification is fail-closed and has one order', 'a login never creates a binding']) }) }),
  'google.gemini': Object.freeze({ max_class: 'B', nucleus: Object.freeze({ module: 'google.gemini@1', invariants: Object.freeze(['the model is a provider, never an authority', 'cost is accounted per call']) }) }),
  'google.drive': Object.freeze({ max_class: 'B', nucleus: Object.freeze({ module: 'google.drive@1', invariants: Object.freeze(['reads are scoped to the narrowest rung', 'no write path exists in this cell']) }) }),
  'google.sheets': Object.freeze({ max_class: 'B', nucleus: Object.freeze({ module: 'google.sheets@1', invariants: Object.freeze(['a range read touches one sheet, never the account']) }) }),
  'google.gmail': Object.freeze({ max_class: 'D', nucleus: Object.freeze({ module: 'google.gmail@1', invariants: Object.freeze(['sending is class D: capability, policy and approval, every time', 'the mailbox is never modified in v1']) }) }),
  'google.calendar': Object.freeze({ max_class: 'C', nucleus: Object.freeze({ module: 'google.calendar@1', invariants: Object.freeze(['a write is correctable, and becomes class D when it notifies anyone']) }) }),
});

/**
 * Grant templates for the operations of one or more service cells. The `subject` is the service
 * cell — never the owner, who has no key in this table at all.
 * @param {{cell: string, kid?: string, ttlMs?: number, maxCalls?: number, operations?: string[]}} input
 * @returns {object[]} templates an `Authority` accepts
 */
export function googleGrantTemplates({ cell, ttlMs = 300_000, maxCalls = 50, operations = null }) {
  if (GOOGLE_SERVICE_CELLS[cell] === undefined) {
    throw new OmegaError('OMEGA_E_SCHEMA', `unknown Google service cell: ${String(cell)}`, { known: Object.keys(GOOGLE_SERVICE_CELLS) });
  }
  const rows = GOOGLE_OPERATIONS.filter((row) => row.resource.startsWith('net:google.') || row.resource === 'model:gemini');
  return rows
    .filter((row) => (operations === null ? row.resource.includes(cell.replace('google.', '')) || (cell === 'google.gemini' && row.resource === 'model:gemini') : operations.includes(row.operation)))
    .map((row) => ({
      name: `${cell}:${row.operation}`,
      subject: cell,
      resource: row.resource,
      actions: [row.action],
      ttl_ms: ttlMs,
      max_calls: maxCalls,
      requiresApproval: row.class === 'D',
      class: row.class,
      operation: row.operation,
    }));
}

/**
 * The verifying half. Presenter-bound, single-use, trusted-issuer-only — fail-closed when no
 * issuer is named, like every other verifier in the system.
 *
 * @param {{operator: object, clock: () => Date}} input
 * @returns {{verify: Function, spent: Function, spentCount: number}}
 */
export function createGoogleCallPort({ operator, clock }) {
  if (typeof operator?.kid !== 'string') throw new OmegaError('OMEGA_E_IDENTITY', 'a call port verifies against a named issuer');
  const used = new Set();
  return {
    /** @param {object} token @param {{presenter: string, resource: string, action: string, at: Date}} input */
    verify(token, { presenter, resource, action, at }) {
      if (token === null || typeof token !== 'object') {
        return { ok: false, code: 'OMEGA_E_CAP_MISSING', reason: 'a Google call must carry a capability' };
      }
      if (used.has(token.id)) {
        return { ok: false, code: 'NEXA_E_REPLAY', reason: `capability ${token.id} was already spent`, detail: { id: token.id } };
      }
      let verdict;
      try {
        verdict = verifyCapability(token, {
          presenter,
          now: at ?? clock(),
          uses: (id) => (used.has(id) ? 1 : 0),
          action,
          resource,
          trustedIssuers: [operator.kid],
        });
      } catch (cause) {
        return { ok: false, code: cause.code ?? 'OMEGA_E_CAP_MISSING', reason: cause.message };
      }
      if (verdict.ok !== true) return { ok: false, code: verdict.code ?? 'OMEGA_E_CAP_MISSING', reason: verdict.reason ?? 'the capability did not verify' };
      used.add(token.id);
      return { ok: true, grant: verdict.grant ?? null, code: null, reason: null };
    },
    /** @param {string} id @returns {boolean} */
    spent(id) {
      return used.has(id);
    },
    /** @returns {number} */
    get spentCount() {
      return used.size;
    },
  };
}
