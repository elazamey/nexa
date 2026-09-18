/**
 * Owner bindings — the record that turns "this is a Google subject" into "this subject is the
 * owner of this instance".
 *
 * Binding is not authority. It yields a **role**, and roles only ever inform a capability policy;
 * nothing here can mint, and the identity cell in particular cannot hand itself one because a
 * role says "owner". Google never creates a binding — only a key the operator layer trusts does,
 * and the first one is created by an invitation signed with the local operator key (the same
 * `createIdentity()` path the rest of NEXA uses). There is no path in which a successful login
 * creates its own binding, and `email` never binds: changing the display email changes nothing.
 *
 * Break-glass is the exception that proves the rule: a **recovery-only state**, never a second
 * owner. It is bounded (≤ 24 hours), restricted (role `recovery`, identity verification only, no
 * class D), evidenced *before* it is active, unchained, undelegable, unable to touch the kernel,
 * and terminated the moment a legitimate binding exists again — not when its clock runs out.
 */
import { KID_PATTERN, canonicalBytes, parseInstant } from '../../../../ast/index.js';
import { createRevocation, RevocationSet, verifyRevocation } from '../../../../capability/index.js';
import { verifyWithKeyId } from '../../../../crypto/index.js';
import { OmegaError } from '../../../../compiler/index.js';
import { KERNEL_MODULE_NAMES } from '../../../../cell/index.js';

export const BINDING_DOMAIN = 'NEXA/google1 owner binding\u0000';
export const BINDING_METHODS = Object.freeze(['invitation', 'break-glass']);
export const BINDING_ROLES = Object.freeze(['owner', 'admin', 'developer', 'agent', 'viewer', 'recovery']);
export const BREAK_GLASS_MAX_MS = 24 * 60 * 60 * 1000;

/** The record shape. Anything else is a different record pretending to be this one. */
export const BINDING_FIELDS = Object.freeze([
  'binding',
  'sub_hash',
  'nexa_kid',
  'role',
  'created_by',
  'created_at',
  'expires_at',
  'method',
  'reason',
  'changes',
  'sig',
]);

/** A hash in NEXA's multihash spelling: `sha256:` and 32 base64url-encoded bytes. */
const HASH_PATTERN = /^sha256:[A-Za-z0-9_-]{43}$/;

/**
 * The bytes the signature covers: exactly the declared fields, nothing else.
 *
 * A binding travels with metadata attached — the evidence hash of its own creation, its sequence
 * number — and a signature that covered *those* would be a signature over the host's bookkeeping
 * rather than over the claim. The projection is why `verify(copy(record))` holds: only a change
 * to a declared field can break the signature, and no extra field can.
 * @param {object} record
 * @returns {Buffer}
 */
export function bindingPayload(record) {
  const unsigned = {};
  for (const field of BINDING_FIELDS) {
    if (field === 'sig') continue;
    if (record[field] !== undefined) unsigned[field] = record[field];
  }
  return Buffer.concat([Buffer.from(BINDING_DOMAIN, 'utf8'), canonicalBytes(unsigned)]);
}

/** The kernel may not be touched by a recovery state — or by anything else. */
function assertTargetsAreNotKernel(changes) {
  for (const change of changes) {
    if (typeof change?.target !== 'string' || change.target.length === 0) {
      throw new OmegaError('OMEGA_E_SCHEMA', 'a change names a target module');
    }
    const module = change.target.split('@')[0];
    if (KERNEL_MODULE_NAMES.includes(module)) {
      throw new OmegaError('OMEGA_E_KERNEL_IMMUTABLE', `${change.target} is kernel: a binding may never modify it`, { target: change.target, kernel: [...KERNEL_MODULE_NAMES] });
    }
  }
}

/**
 * The twelve rules of § C.2.6, checked in one place so that a record made by hand and a record
 * made by this registry are held to the same shape.
 * @param {object} record
 * @returns {object} the record, having proved it is a legal break-glass record
 */
export function assertBreakGlassShape(record) {
  if (record.method !== 'break-glass') return record;
  if (record.role !== 'recovery') {
    throw new OmegaError('OMEGA_E_BREAKGLASS_ROLE', `a break-glass binding is a recovery state; its role was ${String(record.role)}`, { role: record.role });
  }
  if (typeof record.reason !== 'string' || record.reason.trim().length === 0) {
    throw new OmegaError('OMEGA_E_BREAKGLASS_REASON', 'a break-glass binding must say why it exists', { reason: record.reason ?? null });
  }
  if (typeof record.expires_at !== 'string' || record.expires_at.length === 0) {
    throw new OmegaError('OMEGA_E_BREAKGLASS_UNBOUNDED', 'a break-glass binding without a finite expiry is not a recovery state', { expires_at: record.expires_at ?? null });
  }
  const created = parseInstant(record.created_at);
  const expires = parseInstant(record.expires_at);
  if (expires <= created) {
    throw new OmegaError('OMEGA_E_BREAKGLASS_UNBOUNDED', 'a break-glass binding expires in the future or it is not a binding', { created_at: record.created_at, expires_at: record.expires_at });
  }
  if (expires - created > BREAK_GLASS_MAX_MS) {
    throw new OmegaError('OMEGA_E_BREAKGLASS_UNBOUNDED', `a break-glass binding may not outlive ${BREAK_GLASS_MAX_MS / 3_600_000} hours`, { created_at: record.created_at, expires_at: record.expires_at });
  }
  if (record.delegated_by !== undefined && record.delegated_by !== null) {
    throw new OmegaError('OMEGA_E_BREAKGLASS_CHAIN', 'a break-glass binding may not be delegated', { delegated_by: record.delegated_by });
  }
  assertTargetsAreNotKernel(record.changes ?? []);
  return record;
}

/**
 * @param {{operator: object, sub_hash: string, nexa_kid: string, role?: string, method?: string,
 *          created_at: string, expires_at?: string|null, reason?: string|null,
 *          changes?: object[], delegated_by?: string|null}} input
 * @returns {Readonly<object>} a signed binding record
 */
export function createBindingRecord({
  operator,
  sub_hash,
  nexa_kid,
  role = 'owner',
  method = 'invitation',
  created_at,
  expires_at = null,
  reason = null,
  changes = [],
  delegated_by = null,
}) {
  if (typeof operator?.keys?.sign !== 'function' || typeof operator?.kid !== 'string') {
    throw new OmegaError('OMEGA_E_NOT_ACTIVATOR', 'a binding is signed by a key the operator layer trusts');
  }
  if (typeof sub_hash !== 'string' || !HASH_PATTERN.test(sub_hash)) {
    throw new OmegaError('OMEGA_E_IDENTITY', 'a binding is keyed by a sub_hash, and nothing else', { sub_hash: sub_hash ?? null });
  }
  if (typeof nexa_kid !== 'string' || !KID_PATTERN.test(nexa_kid)) {
    throw new OmegaError('OMEGA_E_IDENTITY', 'a binding names the NEXA identity the subject speaks as', { nexa_kid: nexa_kid ?? null });
  }
  if (!BINDING_METHODS.includes(method)) {
    throw new OmegaError('OMEGA_E_SCHEMA', `unknown binding method: ${String(method)}`, { known: [...BINDING_METHODS] });
  }
  if (!BINDING_ROLES.includes(role)) {
    throw new OmegaError('OMEGA_E_SCHEMA', `unknown role: ${String(role)}`, { known: [...BINDING_ROLES] });
  }
  if (delegated_by !== null) {
    // v1 has one authority that binds, and break-glass is never delegated. Both are the same
    // question — "may authority arrive second-hand?" — and both answers are no.
    throw method === 'break-glass'
      ? new OmegaError('OMEGA_E_BREAKGLASS_CHAIN', 'a break-glass binding may not be delegated')
      : new OmegaError('OMEGA_E_NOT_ACTIVATOR', 'an owner binding is created by the operator key, never delegated');
  }
  if (method === 'invitation' && role !== 'owner') {
    throw new OmegaError('OMEGA_E_SCHEMA', `v1 binds exactly one role by invitation: owner (asked for ${role})`, { role });
  }
  parseInstant(created_at);
  const record = {
    binding: 'owner',
    sub_hash,
    nexa_kid,
    role,
    created_by: operator.kid,
    created_at,
    expires_at,
    method,
    reason,
    changes: changes.map((change) => ({ target: change.target })),
    ...(delegated_by === null ? {} : { delegated_by }),
  };
  assertBreakGlassShape({ ...record, delegated_by: null, sig: undefined });
  const sig = { kind: 'ed25519', kid: operator.kid, val: operator.keys.sign(bindingPayload(record)) };
  return Object.freeze({ ...record, sig: Object.freeze(sig) });
}

/**
 * Structural, cryptographic and shape verification. Whether the creator is *trusted* is a local
 * decision made by the registry, never claimed by the record itself.
 * @param {object} record
 * @param {{operatorKid?: string, now?: Date}} [input]
 * @returns {Readonly<object>}
 */
export function verifyBinding(record, { operatorKid = null, now = null } = {}) {
  if (typeof record !== 'object' || record === null) throw new OmegaError('OMEGA_E_SCHEMA', 'a binding is an object');
  for (const field of BINDING_FIELDS) {
    if (!Object.hasOwn(record, field)) throw new OmegaError('OMEGA_E_SCHEMA', `a binding is missing ${field}`, { field });
  }
  if (record.binding !== 'owner') throw new OmegaError('OMEGA_E_SCHEMA', `unknown binding kind: ${String(record.binding)}`);
  if (!HASH_PATTERN.test(record.sub_hash)) throw new OmegaError('OMEGA_E_IDENTITY', 'a binding is keyed by a sub_hash', { sub_hash: record.sub_hash });
  if (!KID_PATTERN.test(record.nexa_kid)) throw new OmegaError('OMEGA_E_IDENTITY', 'a binding names a NEXA key id', { nexa_kid: record.nexa_kid });
  if (!KID_PATTERN.test(record.created_by)) throw new OmegaError('OMEGA_E_IDENTITY', 'a binding names the key that created it', { created_by: record.created_by });
  if (operatorKid !== null && record.created_by !== operatorKid) {
    throw new OmegaError('OMEGA_E_NOT_ACTIVATOR', 'the binding was not created by the operator key this instance trusts', { created_by: record.created_by, expected: operatorKid });
  }
  assertBreakGlassShape(record);
  if (record.sig?.kid !== record.created_by) throw new OmegaError('OMEGA_E_SIGNATURE', 'a binding is signed by its creator');
  if (verifyWithKeyId(bindingPayload(record), record.sig.val, record.sig.kid) !== true) {
    throw new OmegaError('OMEGA_E_SIGNATURE', 'the binding signature does not verify');
  }
  if (now !== null && record.expires_at !== null && typeof record.expires_at === 'string' && parseInstant(record.expires_at) <= now.getTime()) {
    throw new OmegaError('OMEGA_E_IDENTITY', `the binding expired at ${record.expires_at}`, { expires_at: record.expires_at });
  }
  return record;
}

/**
 * @param {{operator: object, clock: () => Date, record: Function, vault?: object|null,
 *          maxBreakGlassMs?: number}} input
 */
export function createBindingRegistry({ operator, clock, record, vault = null, maxBreakGlassMs = BREAK_GLASS_MAX_MS }) {
  const live = new Map();
  const history = [];
  const minted = new Map();
  const revocations = new RevocationSet();
  const revocationRecords = [];
  let transaction = [];

  const nowIso = () => clock().toISOString().replace(/\.\d{3}Z$/, 'Z');

  /** Evidence before activation, always. A failed write is a failed binding. */
  const seal = (candidate, decision, extra = {}) => record({
    kind: 'OWNER_BINDING',
    decision,
    subject: candidate.sub_hash,
    resource: 'cell:google.identity',
    action: candidate.method,
    detail: {
      binding: candidate.binding,
      nexa_kid: candidate.nexa_kid,
      role: candidate.role,
      by: candidate.created_by,
      method: candidate.method,
      reason: candidate.reason,
      expires_at: candidate.expires_at,
      ...extra,
    },
  });

  /**
   * Revocation is evidence, and it is immediate. Vault material is destroyed **before** the
   * capabilities are revoked: a token that survives a revocation is a defect, not a delay.
   */
  function revoke({ sub_hash, reason, by, capability_reason = 'operator_request' }) {
    if (by !== operator.kid) throw new OmegaError('OMEGA_E_NOT_ACTIVATOR', 'only the operator key may revoke a binding', { by });
    const existing = live.get(sub_hash);
    if (existing === undefined) throw new OmegaError('OMEGA_E_SCHEMA', `there is no live binding for ${sub_hash} to revoke`, { sub_hash });
    if (typeof reason !== 'string' || reason.trim().length === 0) throw new OmegaError('OMEGA_E_SCHEMA', 'a revocation says why');
    const steps = [];
    const deleted = vault === null ? 0 : vault.deleteFor(sub_hash);
    steps.push({ step: 'vault.delete', deleted });
    let revokedCaps = 0;
    for (const capabilityId of minted.get(sub_hash) ?? []) {
      // The capability vocabulary is closed (`compromised`, `superseded`, `expired_early`,
      // `operator_request`), so a binding revocation maps into it rather than inventing a word.
      const revocation = createRevocation({ cap: capabilityId, issuer: operator, reason: capability_reason, ts: nowIso() });
      if (verifyRevocation(revocation).cap === capabilityId) {
        revocations.add(revocation);
        revocationRecords.push(revocation);
        revokedCaps += 1;
      }
    }
    steps.push({ step: 'capability.revoke', revoked: revokedCaps });
    const entry = seal({ ...existing, reason }, 'DENY', { revoked: true, revoked_capabilities: revokedCaps, deleted_material: deleted });
    steps.push({ step: 'evidence', hash: entry.hash });
    live.delete(sub_hash);
    history.push(Object.freeze({ ...existing, revoked_at: nowIso(), revocation_reason: reason, evidence: entry.hash }));
    transaction = steps;
    return { revoked: existing, deleted_material: deleted, capabilities_revoked: revokedCaps, steps, evidence: entry.hash };
  }

  return {
    /**
     * @param {object} input as `createBindingRecord`, plus `created_by`
     * @returns {Readonly<object>} the active binding
     */
    create({ created_by, ...rest }) {
      if (created_by !== operator.kid) {
        throw new OmegaError('OMEGA_E_NOT_ACTIVATOR', 'only the operator key this instance trusts may create a binding', { created_by });
      }
      if (live.has(rest.sub_hash)) {
        throw new OmegaError('OMEGA_E_BINDING_EXISTS', `${rest.sub_hash} already has a live binding; revoke it first, on the record`, { sub_hash: rest.sub_hash });
      }
      // Rule 10: a legitimate binding ends the recovery state *now*, not when its clock runs out.
      for (const [subHash, existing] of [...live.entries()]) {
        if (existing.method === 'break-glass') {
          revoke({ sub_hash: subHash, reason: 'a legitimate owner binding replaced the recovery state', by: operator.kid, capability_reason: 'superseded' });
        }
      }
      const candidate = createBindingRecord({ operator, created_at: nowIso(), ...rest });
      const entry = seal(candidate, 'ALLOW');
      const sealed = Object.freeze({ ...candidate, evidence: entry.hash, seq: entry.seq });
      live.set(sealed.sub_hash, sealed);
      history.push(sealed);
      return sealed;
    },

    /**
     * The recovery state. Bounded, evidenced, and not a second owner.
     * @param {{sub_hash: string, nexa_kid: string, reason: string, created_by: string,
     *          hours?: number, changes?: object[], role?: string}} input
     */
    breakGlass({ sub_hash, nexa_kid, reason, created_by, hours = 24, changes = [], role = 'recovery' }) {
      if (created_by !== operator.kid) {
        throw new OmegaError('OMEGA_E_NOT_ACTIVATOR', 'only the operator key this instance trusts may declare recovery', { created_by });
      }
      if (role !== 'recovery') {
        throw new OmegaError('OMEGA_E_BREAKGLASS_ROLE', `break-glass is a recovery state, not a ${role} binding`, { role });
      }
      for (const existing of live.values()) {
        if (existing.method === 'break-glass') {
          throw new OmegaError('OMEGA_E_BREAKGLASS_CHAIN', 'a break-glass binding may not be chained onto another one', { sub_hash: existing.sub_hash });
        }
      }
      if (live.has(sub_hash)) {
        throw new OmegaError('OMEGA_E_BINDING_EXISTS', `${sub_hash} already has a live binding; recovery does not bypass a revocation`, { sub_hash });
      }
      if (!Number.isSafeInteger(hours) || hours <= 0 || hours * 3_600_000 > maxBreakGlassMs) {
        throw new OmegaError('OMEGA_E_BREAKGLASS_UNBOUNDED', `a break-glass binding lives at most ${maxBreakGlassMs / 3_600_000} hours`, { hours });
      }
      const createdAt = clock().getTime();
      const candidate = createBindingRecord({
        operator,
        sub_hash,
        nexa_kid,
        role: 'recovery',
        method: 'break-glass',
        created_at: nowIso(),
        expires_at: new Date(createdAt + (hours * 3_600_000)).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        reason,
        changes,
      });
      const entry = seal(candidate, 'ALLOW', { recovery: true });
      const sealed = Object.freeze({ ...candidate, evidence: entry.hash, seq: entry.seq });
      live.set(sealed.sub_hash, sealed);
      history.push(sealed);
      return sealed;
    },

    revoke,

    /** Remember a capability minted under a binding, so revocation can find it. */
    noteMinted({ sub_hash, capability_id }) {
      if (!minted.has(sub_hash)) minted.set(sub_hash, new Set());
      minted.get(sub_hash).add(capability_id);
      return minted.get(sub_hash).size;
    },

    /** @returns {Readonly<object>|null} the live binding, if any */
    active() {
      return live.size === 0 ? null : [...live.values()][0];
    },

    /** @param {string} sub_hash @returns {Readonly<object>|null} */
    activeFor(sub_hash) {
      return live.get(sub_hash) ?? null;
    },

    /** @returns {boolean} whether a recovery state is live right now */
    hasBreakGlass() {
      return [...live.values()].some((binding) => binding.method === 'break-glass');
    },

    /** @returns {object[]} every binding ever created, revocations included */
    history() {
      return history.map((entry) => ({ ...entry }));
    },

    /** @returns {RevocationSet} the set a verifier is handed */
    revocations() {
      return revocations;
    },

    /** @returns {object[]} the revocation records themselves */
    revocationRecords() {
      return revocationRecords.map((entry) => ({ ...entry }));
    },

    /** @returns {object[]} the steps of the last revocation transaction, in order */
    lastTransaction() {
      return transaction.map((entry) => ({ ...entry }));
    },
  };
}
