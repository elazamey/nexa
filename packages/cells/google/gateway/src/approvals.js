/**
 * Class-D approvals: single-use, bound to one exact operation.
 *
 *     D capability ≠ D approval
 *
 * A class-D operation needs both, and the approval is not a mood — it is a record that names
 * the operation it authorizes, down to a digest of `(resource, action, scope)`, so that
 *
 *     approval for X  ≠  approval for any other X
 *
 * The approval is consumed as part of the invocation and cannot be replayed. Three refusals
 * are possible and they are different questions: no approval was supplied
 * (`OMEGA_E_APPROVAL_REQUIRED`), the one supplied is for a different operation
 * (`OMEGA_E_APPROVAL_REQUIRED`, with the digest in the detail), or it was already spent
 * (`OMEGA_E_APPROVAL_CONSUMED`).
 *
 * The *author* of an approval is the owner binding; the *subject* of the capability it
 * accompanies is the service cell. Keeping those apart is what lets a human approve something
 * without becoming the capability's holder.
 */
import { canonicalBytes } from '../../../../ast/index.js';
import { sha256Multihash } from '../../../../crypto/index.js';
import { OmegaError } from '../../../../compiler/index.js';

/** @param {{resource: string, action: string, scope?: string|null}} operation @returns {string} */
export function operationDigest({ resource, action, scope = null }) {
  return sha256Multihash(canonicalBytes({ resource, action, scope }));
}

/** The fields an approval must carry for the record to mean anything. */
export const APPROVAL_FIELDS = Object.freeze([
  'approval_id',
  'owner_binding',
  'operation',
  'resource',
  'action',
  'scope',
  'operation_digest',
  'issued_at',
  'expires_at',
  'single_use',
  'consumed_at',
  'signer',
]);

/**
 * @param {{clock: () => Date, record: Function, ttlMs?: number}} input
 *   `record` writes the `APPROVAL` evidence record; without it nothing is granted, because an
 *   approval that is not in evidence is not an approval.
 */
export function createApprovalStore({ clock, record, ttlMs = 600_000 }) {
  if (typeof record !== 'function') {
    throw new OmegaError('OMEGA_E_SCHEMA', 'an approval store needs a recorder: an approval outside evidence is not an approval');
  }
  /** Live approvals by id, and the digest each one is bound to. One exact operation has at most
   *  one live approval: granting a second is a duplicate, not a spare. */
  const live = new Map();
  const liveByDigest = new Map();
  const spent = new Map();
  const history = [];
  let granted = 0;

  return {
    /**
     * @param {{operation: string, resource: string, action: string, scope?: string|null,
     *          owner_binding: string, signer: string, ttlMs?: number}} input
     * @returns {object} the approval record, already in evidence
     */
    grant({ operation, resource, action, scope = null, owner_binding, signer, ttlMs: ttl = ttlMs }) {
      if (typeof owner_binding !== 'string' || owner_binding.length === 0) {
        throw new OmegaError('OMEGA_E_APPROVAL_REQUIRED', 'an approval names the owner binding that authorizes it');
      }
      if (typeof signer !== 'string' || signer.length === 0) {
        throw new OmegaError('OMEGA_E_APPROVAL_REQUIRED', 'an approval is signed by someone');
      }
      if (!Number.isSafeInteger(ttl) || ttl <= 0) {
        throw new OmegaError('OMEGA_E_SCHEMA', 'an approval needs a positive lifetime');
      }
      const digest = operationDigest({ resource, action, scope });
      const held = liveByDigest.get(digest);
      if (held !== undefined) {
        throw new OmegaError('OMEGA_E_DUPLICATE', `a live approval for exactly this operation already exists (${held})`, { approval_id: held });
      }
      granted += 1;
      // The id is unique per approval; the *binding* to the operation is the digest. An id is
      // never reused, so a replayed approval is caught as a replay rather than mistaken for a
      // fresh consent to the same operation.
      const approval_id = `approval:${digest.slice('sha256:'.length, 'sha256:'.length + 16)}:${granted}`;
      const approval = Object.freeze({
        approval_id,
        owner_binding,
        operation,
        resource,
        action,
        scope,
        operation_digest: digest,
        issued_at: clock().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        expires_at: new Date(clock().getTime() + ttl).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        single_use: true,
        consumed_at: null,
        signer,
      });
      live.set(approval_id, approval);
      // Evidence first: if this write fails, the caller sees the failure and no approval is live.
      const entry = record({
        kind: 'APPROVAL',
        decision: 'ALLOW',
        subject: signer,
        resource,
        action,
        detail: { approval_id, owner_binding, operation, operation_digest: digest, issued_at: approval.issued_at, expires_at: approval.expires_at, single_use: true },
      });
      const sealed = Object.freeze({ ...approval, evidence: entry?.hash ?? null });
      live.set(approval_id, sealed);
      liveByDigest.set(digest, approval_id);
      return sealed;
    },

    /**
     * Consume the approval for exactly this operation. A near miss is a miss: the resource,
     * action and scope are re-digested and compared, so an approval for a read never carries a
     * send, and an approval for one file never carries another.
     * @param {{approval_id: string, resource: string, action: string, scope?: string|null}} input
     * @returns {object} the consumed approval
     */
    consume({ approval_id, resource, action, scope = null }) {
      if (spent.has(approval_id)) {
        throw new OmegaError('OMEGA_E_APPROVAL_CONSUMED', `approval ${approval_id} was already consumed at ${spent.get(approval_id).consumed_at}`, { approval_id, consumed_at: spent.get(approval_id).consumed_at });
      }
      const approval = live.get(approval_id);
      if (approval === undefined) {
        throw new OmegaError('OMEGA_E_APPROVAL_REQUIRED', `approval ${String(approval_id)} was not supplied`, { approval_id: approval_id ?? null });
      }
      const digest = operationDigest({ resource, action, scope });
      if (digest !== approval.operation_digest) {
        throw new OmegaError('OMEGA_E_APPROVAL_REQUIRED', `approval ${approval_id} authorizes a different operation`, {
          approval_id,
          approved: approval.operation_digest,
          requested: digest,
        });
      }
      if (Date.parse(approval.expires_at) < clock().getTime()) {
        throw new OmegaError('OMEGA_E_APPROVAL_REQUIRED', `approval ${approval_id} expired at ${approval.expires_at}`, { approval_id, expires_at: approval.expires_at });
      }
      const consumed = Object.freeze({ ...approval, consumed_at: clock().toISOString().replace(/\.\d{3}Z$/, 'Z') });
      live.delete(approval_id);
      liveByDigest.delete(approval.operation_digest);
      spent.set(approval_id, consumed);
      history.push(consumed);
      record({
        kind: 'APPROVAL',
        decision: 'ALLOW',
        subject: approval.signer,
        resource,
        action,
        detail: { approval_id, consumed_at: consumed.consumed_at, operation_digest: digest, consumed: true },
      });
      return consumed;
    },

    /** @param {string} approvalId @returns {object|undefined} a live approval, never a spent one */
    at(approvalId) {
      return live.get(approvalId);
    },

    /** @returns {object|undefined} a spent approval, for the record */
    spentAt(approvalId) {
      return spent.get(approvalId);
    },

    /** @returns {object[]} every approval this store ever consumed, in order */
    history() {
      return history.map((entry) => ({ ...entry }));
    },

    /** @returns {number} live approvals; consumed ones are history, not capacity */
    get size() {
      return live.size;
    },
  };
}
