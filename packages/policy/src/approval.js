/**
 * @nexa/policy — approval protocol (v13-1).
 *
 * The human seat in the loop. NEXA's gates default to CLOSED; this module is
 * the ONLY channel that can authorize a single gated execution, and only for
 * the gates whose blast radius is bounded by a target:
 *
 *   FILESYSTEM_WRITE, REAL_EXECUTION, TERMINAL        → approvable
 *   AUTO_COMMIT, AUTO_PUSH, AUTO_DEPLOY               → root-governed, NEVER
 *
 * The policy root (policy resources, root gates, keys, verifier, rollback) is
 * IMMUTABLE / HUMAN-GOVERNED: no approval — however many, however trusted —
 * can act on it. That rule is a vector (V4/V5), not a convention.
 *
 * State machine per approval id:
 *
 *   REQUESTED → APPROVED_ONCE    → CONSUMED          (exactly one consume)
 *   REQUESTED → APPROVED_MISSION (reusable while in-mission + unexpired)
 *   REQUESTED → DENIED                      (terminal)
 *   (anything) → EXPIRED                    (clock-driven, terminal)
 *
 * Every decision appends one record to a hash-chained log (same construction
 * as the evidence chain: sha256 over the canonical record, committing to the
 * previous hash). The log is tamper-evident: deleting, reordering or editing
 * any record breaks verification (V6). Signature of the exported records is
 * applied by the mission evidence layer (v13-3) when the log is exported into
 * the signed ledger — the chain here is self-contained and verifiable offline.
 *
 * Pure module: deps limited to @nexa/ast and @nexa/crypto, no fs, no net,
 * no real time (the clock is injected).
 */
import {
  NexaError,
  canonicalBytes,
  formatInstant,
  addSeconds,
  compareInstant,
} from '../../ast/index.js';
import { sha256Multihash, randomId } from '../../crypto/index.js';
import { checkGates } from './gates.js';

/** Gates whose executions may be individually approved (target-bounded). */
export const APPROVAL_ELIGIBLE_GATES = Object.freeze([
  'FILESYSTEM_WRITE',
  'REAL_EXECUTION',
  'TERMINAL',
]);

/** Root namespaces: no approval may ever target a resource inside them. */
export const ROOT_NAMESPACES = Object.freeze([
  'policy:',
  'kernel:',
  'evidence:',
  'identity:',
  'trust:',
  'capability:',
]);

/** Approval request lifetimes (seconds). Default 15m — matches the v12 budget decision. */
export const APPROVAL_DEFAULT_TTL_SECONDS = 900;
export const APPROVAL_MAX_TTL_SECONDS = 3600;

const GENESIS_PREV = 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const APPROVAL_KINDS = Object.freeze([
  'APPROVAL_REQUEST',
  'APPROVAL_GRANTED',
  'APPROVAL_DENIED',
  'APPROVAL_CONSUMED',
]);

function sha(recordBody) {
  return sha256Multihash(canonicalBytes(recordBody));
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NexaError('NEXA_E_SCHEMA', `${name} must be a non-empty string`);
  }
  return value;
}

function isRootResource(resource) {
  return ROOT_NAMESPACES.some((prefix) => resource.startsWith(prefix));
}

/**
 * @param {{resource?: string, action?: string}} request
 * @returns {{eligible: boolean, gate: string|null, reason: string}}
 */
export function isApprovalEligible({ resource, action } = {}) {
  requireString(resource, 'resource');
  if (isRootResource(resource)) {
    return { eligible: false, gate: null, reason: 'resource is policy root' };
  }
  const gate = checkGates({ resource, action });
  if (gate.allowed) return { eligible: false, gate: null, reason: 'not gated' };
  if (APPROVAL_ELIGIBLE_GATES.includes(gate.gate)) {
    return { eligible: true, gate: gate.gate, reason: 'target-bounded gate' };
  }
  return { eligible: false, gate: gate.gate, reason: 'gate is root-governed' };
}

export class ApprovalLedger {
  #trusted = [];
  #now = () => new Date();
  #maxTtl = APPROVAL_MAX_TTL_SECONDS;
  /** @type {Map<string, object>} approvalId → request state */
  #requests = new Map();
  /** @type {object[]} hash-chained decision log */
  #events = [];

  /**
   * @param {object} options
   * @param {string[]} [options.trustedApprovers] kids allowed to grant or deny
   * @param {() => Date} [options.now] injected clock (deterministic in tests)
   * @param {number} [options.maxTtlSeconds]
   */
  constructor({ trustedApprovers = [], now = () => new Date(), maxTtlSeconds = APPROVAL_MAX_TTL_SECONDS } = {}) {
    if (!Array.isArray(trustedApprovers) || trustedApprovers.some((kid) => typeof kid !== 'string')) {
      throw new NexaError('NEXA_E_SCHEMA', 'trustedApprovers must be an array of kids');
    }
    this.#trusted = Object.freeze([...trustedApprovers]);
    this.#now = now;
    this.#maxTtl = maxTtlSeconds;
  }

  get trustedApprovers() {
    return this.#trusted;
  }

  /**
   * Open an approval request for one gated execution.
   * @returns {{approvalId: string, decision: string, gate: string, exp: string}}
   */
  request({ resource, action, target, missionId = null, ttlSeconds = APPROVAL_DEFAULT_TTL_SECONDS, requestedBy = null } = {}) {
    requireString(resource, 'resource');
    requireString(action, 'action');
    requireString(target, 'target');
    if (missionId !== null && typeof missionId !== 'string') {
      throw new NexaError('NEXA_E_SCHEMA', 'missionId must be a string or null');
    }
    if (requestedBy !== null && typeof requestedBy !== 'string') {
      throw new NexaError('NEXA_E_SCHEMA', 'requestedBy must be a string or null');
    }
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > this.#maxTtl) {
      throw new NexaError('NEXA_E_SCHEMA', `ttlSeconds must be an integer in [1, ${this.#maxTtl}]`);
    }
    if (isRootResource(resource)) {
      throw new NexaError(
        'NEXA_E_POLICY_IMMUTABLE',
        `resource "${resource}" is policy root — no approval channel exists for it`,
      );
    }
    const eligibility = isApprovalEligible({ resource, action });
    if (!eligibility.eligible) {
      if (eligibility.reason === 'not gated') {
        throw new NexaError('NEXA_E_SCHEMA', `resource "${resource}" is not gated — no approval needed`);
      }
      throw new NexaError(
        'NEXA_E_POLICY_IMMUTABLE',
        `gate ${eligibility.gate} is root-governed — it cannot be opened per-execution`,
      );
    }
    const nowIso = formatInstant(this.#now());
    const exp = addSeconds(nowIso, ttlSeconds);
    const approvalId = randomId('urn:nexa:approval:');
    const state = {
      approvalId,
      resource,
      action,
      target,
      missionId,
      requestedBy,
      gate: eligibility.gate,
      scope: null,
      approverKid: null,
      decision: 'REQUESTED',
      createdAt: nowIso,
      exp,
    };
    this.#requests.set(approvalId, state);
    this.#append('APPROVAL_REQUEST', state);
    return { approvalId, decision: state.decision, gate: state.gate, exp };
  }

  /**
   * Grant an approval (human decision).
   * @param {{approvalId: string, scope?: 'once'|'mission', approverKid: string}} args
   * @returns {{approvalId: string, decision: string, scope: string}}
   */
  approve({ approvalId, scope = 'once', approverKid } = {}) {
    if (scope !== 'once' && scope !== 'mission') {
      throw new NexaError('NEXA_E_SCHEMA', "scope must be 'once' or 'mission'");
    }
    const state = this.#decide(approvalId, approverKid, scope === 'once' ? 'APPROVED_ONCE' : 'APPROVED_MISSION');
    return { approvalId: state.approvalId, decision: state.decision, scope: state.scope };
  }

  /**
   * Deny an approval (human decision).
   * @returns {{approvalId: string, decision: string, reason: string|null}}
   */
  deny({ approvalId, approverKid, reason = null } = {}) {
    const state = this.#decide(approvalId, approverKid, 'DENIED');
    return { approvalId: state.approvalId, decision: state.decision, reason: reason ?? null };
  }

  /**
   * Spend an approval on one execution. Verifies every binding before the
   * spend: root, tuple, target, mission, expiry, use count.
   * @returns {{approvalId: string, decision: string, resource: string, action: string, target: string}}
   */
  consume({ approvalId, resource, action, target, missionId = null } = {}) {
    const state = this.#lookup(approvalId);
    if (state.decision === 'DENIED') {
      throw new NexaError('NEXA_E_APPROVAL_STATE', `approval ${approvalId} was denied`);
    }
    if (state.decision === 'REQUESTED') {
      throw new NexaError('NEXA_E_APPROVAL_STATE', `approval ${approvalId} was never granted`);
    }
    if (isRootResource(resource)) {
      throw new NexaError(
        'NEXA_E_POLICY_IMMUTABLE',
        `resource "${resource}" is policy root — no approval can be spent on it`,
      );
    }
    if (resource !== state.resource || action !== state.action) {
      throw new NexaError(
        'NEXA_E_APPROVAL_SCOPE',
        `approval ${approvalId} covers ${state.resource}/${state.action}, not ${resource}/${action}`,
      );
    }
    requireString(target, 'target');
    if (target !== state.target) {
      throw new NexaError(
        'NEXA_E_APPROVAL_TARGET',
        `approval ${approvalId} was granted for target "${state.target}", not "${target}"`,
      );
    }
    if (state.missionId !== null && missionId !== state.missionId) {
      throw new NexaError(
        'NEXA_E_APPROVAL_SCOPE',
        `approval ${approvalId} is bound to mission ${state.missionId}, not ${String(missionId)}`,
      );
    }
    // Terminal state wins: a consumed approval is dead, expiry or not.
    if (state.decision === 'CONSUMED') {
      throw new NexaError('NEXA_E_APPROVAL_USED', `approval ${approvalId} was already consumed`);
    }
    if (compareInstant(formatInstant(this.#now()), state.exp) >= 0) {
      throw new NexaError('NEXA_E_APPROVAL_EXPIRED', `approval ${approvalId} expired at ${state.exp}`);
    }
    if (state.scope === 'once') {
      state.decision = 'CONSUMED';
    }
    this.#append('APPROVAL_CONSUMED', state);
    return {
      approvalId: state.approvalId,
      decision: 'CONSUMED',
      resource: state.resource,
      action: state.action,
      target: state.target,
    };
  }

  /**
   * Re-import a decision log (restore path). Verifies the full chain and
   * reconstructs request state; any tamper throws NEXA_E_APPROVAL_TAMPERED.
   * Pass the head hash you persisted to also detect truncation (a short
   * chain is internally consistent but not the chain you saved).
   * @param {object[]} records
   * @param {{head?: string}} [options] expected final hash
   */
  importRecords(records, { head } = {}) {
    if (!Array.isArray(records)) {
      throw new NexaError('NEXA_E_SCHEMA', 'records must be an array');
    }
    if (head !== undefined && typeof head !== 'string') {
      throw new NexaError('NEXA_E_SCHEMA', 'head must be a string');
    }
    const requests = new Map();
    let prev = GENESIS_PREV;
    for (const [index, record] of records.entries()) {
      const { hash, ...body } = record ?? {};
      if (sha(body) !== hash) {
        throw new NexaError('NEXA_E_APPROVAL_TAMPERED', `approval record #${index} does not commit to its own hash`);
      }
      if (record.prev !== prev) {
        throw new NexaError('NEXA_E_APPROVAL_TAMPERED', `approval record #${index} breaks the chain at seq ${index}`);
      }
      if (!APPROVAL_KINDS.includes(record.kind)) {
        throw new NexaError('NEXA_E_APPROVAL_TAMPERED', `approval record #${index} has unknown kind`);
      }
      if (record.seq !== index) {
        throw new NexaError('NEXA_E_APPROVAL_TAMPERED', `approval record #${index} has wrong seq ${record.seq}`);
      }
      prev = record.hash;
      if (record.kind === 'APPROVAL_REQUEST') {
        requests.set(record.approvalId, this.#stateFromRecord(record));
      } else {
        const existing = requests.get(record.approvalId);
        if (!existing) {
          throw new NexaError('NEXA_E_APPROVAL_TAMPERED', `approval record #${index} references unknown id`);
        }
        existing.decision = record.decision;
        existing.scope = record.scope;
        existing.approverKid = record.approverKid;
      }
    }
    if (head !== undefined && (records.length === 0 || prev !== head)) {
      throw new NexaError(
        'NEXA_E_APPROVAL_TAMPERED',
        'imported chain head does not match the persisted head (truncation or divergence)',
      );
    }
    this.#requests = requests;
    this.#events = records.map((record) => ({ ...record }));
    return { ok: true, length: records.length };
  }

  /**
   * @returns {{ok: true, length: number, head: string}}
   */
  verifyChain() {
    let prev = GENESIS_PREV;
    for (const [index, record] of this.#events.entries()) {
      const { hash, ...body } = record;
      if (sha(body) !== hash) {
        throw new NexaError('NEXA_E_APPROVAL_TAMPERED', `approval record #${index} does not commit to its own hash`);
      }
      if (record.prev !== prev) {
        throw new NexaError('NEXA_E_APPROVAL_TAMPERED', `approval record #${index} breaks the chain at seq ${index}`);
      }
      prev = record.hash;
    }
    return { ok: true, length: this.#events.length, head: prev };
  }

  /** @returns {object[]} defensive copy of the decision log */
  events() {
    return this.#events.map((record) => ({ ...record }));
  }

  /** @returns {object} counters for the dashboard */
  stats() {
    const decisions = { REQUESTED: 0, APPROVED_ONCE: 0, APPROVED_MISSION: 0, DENIED: 0, CONSUMED: 0 };
    for (const state of this.#requests.values()) decisions[state.decision] += 1;
    return {
      requests: this.#requests.size,
      events: this.#events.length,
      decisions,
      eligibleGates: [...APPROVAL_ELIGIBLE_GATES],
    };
  }

  // --- internals -----------------------------------------------------------

  #stateFromRecord(record) {
    return {
      approvalId: record.approvalId,
      resource: record.resource,
      action: record.action,
      target: record.target,
      missionId: record.missionId,
      requestedBy: record.requestedBy,
      gate: record.gate,
      scope: record.scope,
      approverKid: record.approverKid,
      decision: record.decision,
      createdAt: record.createdAt,
      exp: record.exp,
    };
  }

  #lookup(approvalId) {
    requireString(approvalId, 'approvalId');
    const state = this.#requests.get(approvalId);
    if (!state) {
      throw new NexaError('NEXA_E_APPROVAL_MISSING', `unknown approvalId ${approvalId}`);
    }
    return state;
  }

  /** Shared trust + state + expiry checks for human decisions. */
  #decide(approvalId, approverKid, decision) {
    const state = this.#lookup(approvalId);
    if (typeof approverKid !== 'string' || !this.#trusted.includes(approverKid)) {
      throw new NexaError('NEXA_E_UNTRUSTED', 'approver is not a trusted operator');
    }
    if (state.decision !== 'REQUESTED') {
      throw new NexaError('NEXA_E_APPROVAL_STATE', `approval ${approvalId} is already ${state.decision}`);
    }
    if (compareInstant(formatInstant(this.#now()), state.exp) >= 0) {
      throw new NexaError('NEXA_E_APPROVAL_EXPIRED', `approval ${approvalId} expired before the human decision`);
    }
    state.decision = decision;
    state.scope = decision === 'APPROVED_ONCE' ? 'once' : decision === 'APPROVED_MISSION' ? 'mission' : null;
    state.approverKid = approverKid;
    this.#append(decision === 'DENIED' ? 'APPROVAL_DENIED' : 'APPROVAL_GRANTED', state);
    return state;
  }

  /** Append one chained record (the body is canonicalized before hashing). */
  #append(kind, state) {
    const seq = this.#events.length;
    const prev = seq === 0 ? GENESIS_PREV : this.#events[seq - 1].hash;
    const body = {
      seq,
      ts: formatInstant(this.#now()),
      kind,
      decision: state.decision,
      approvalId: state.approvalId,
      resource: state.resource,
      action: state.action,
      target: state.target,
      missionId: state.missionId,
      scope: state.scope,
      approverKid: state.approverKid,
      requestedBy: state.requestedBy,
      gate: state.gate,
      createdAt: state.createdAt,
      exp: state.exp,
      prev,
    };
    const record = { ...body, hash: sha(body) };
    this.#events.push(record);
    return record;
  }
}
