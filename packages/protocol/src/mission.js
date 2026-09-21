/**
 * @nexa/protocol — event-sourced mission log (v13-3).
 *
 * The directed-mission backbone (v13 map §2C, doc §35/§41). A mission is a
 * plan of steps; every step independently climbs four layers:
 *
 *   PLANNED → AUTHORIZED → EXECUTED → VERIFIED
 *
 * Mission state is NEVER mutated in place: it is derived, deterministically,
 * by the pure reducer `reduceMissionEvents` over a hash-chained event log
 * (same construction as the evidence and approval chains: sha256 over the
 * canonical record, committing to the previous hash). Editing, deleting or
 * reordering any event breaks verification with NEXA_E_MISSION_TAMPERED.
 *
 * Rules encoded here (each a vector in tests/mission-security.test.js):
 * - layer order is strict per step, and steps authorize sequentially: step N
 *   cannot authorize while step N-1 is unverified (no "probably completed");
 * - protected steps bind exactly one approval id at authorize time, and the
 *   executed id must equal the authorized id; unprotected steps bind none;
 * - VERIFIED exists only when every step verified; FAILED / DENIED /
 *   CANCELLED / VERIFIED are all terminal — nothing moves afterwards;
 * - completion seals the chain: MISSION_COMPLETED carries verificationHash,
 *   which IS the chain head (checked by the reducer, not asserted).
 *
 * Pure module: deps limited to @nexa/ast and @nexa/crypto, no fs, no net,
 * no real time (the clock is injected). Approval *validity* is not checked
 * here — the ApprovalLedger enforces it at consume time; this log records
 * the binding as evidence.
 */
import { NexaError, canonicalBytes, formatInstant } from '../../ast/index.js';
import { sha256Multihash, randomId } from '../../crypto/index.js';

/** Mission/step layer vocabulary (frozen). */
export const MISSION_LAYERS = Object.freeze([
  'PLANNED',
  'AUTHORIZED',
  'EXECUTED',
  'VERIFIED',
  'FAILED',
  'DENIED',
  'CANCELLED',
]);

/** Event kinds the reducer accepts (frozen). */
export const MISSION_EVENTS = Object.freeze([
  'MISSION_PLANNED',
  'STEP_AUTHORIZED',
  'STEP_EXECUTED',
  'STEP_VERIFIED',
  'STEP_FAILED',
  'MISSION_COMPLETED',
  'MISSION_DENIED',
  'MISSION_CANCELLED',
]);

const TERMINAL_LAYERS = Object.freeze(['FAILED', 'DENIED', 'CANCELLED', 'VERIFIED']);
const GENESIS_PREV = 'mission:genesis';
const MAX_PLAN_STEPS = 64;
const MAX_TARGET_BYTES = 512;
const KIND_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

function sha(recordBody) {
  return sha256Multihash(canonicalBytes(recordBody));
}

function requireString(value, name, max = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new NexaError('NEXA_E_SCHEMA', `${name} must be a non-empty string of ≤ ${max} chars`);
  }
  return value;
}

function tampered(message) {
  throw new NexaError('NEXA_E_MISSION_TAMPERED', message);
}

function badState(message) {
  throw new NexaError('NEXA_E_MISSION_STATE', message);
}

function validatePlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0 || plan.length > MAX_PLAN_STEPS) {
    throw new NexaError('NEXA_E_SCHEMA', `plan must be an array of 1..${MAX_PLAN_STEPS} steps`);
  }
  return plan.map((step, index) => {
    if (step === null || typeof step !== 'object' || Array.isArray(step)) {
      throw new NexaError('NEXA_E_SCHEMA', `plan[${index}] must be an object`);
    }
    const { kind, target, protected: isProtected, label = '' } = step;
    if (typeof kind !== 'string' || !KIND_PATTERN.test(kind)) {
      throw new NexaError('NEXA_E_SCHEMA', `plan[${index}].kind must match ${KIND_PATTERN}`);
    }
    requireString(target, `plan[${index}].target`, MAX_TARGET_BYTES);
    if (typeof isProtected !== 'boolean') {
      throw new NexaError('NEXA_E_SCHEMA', `plan[${index}].protected must be a boolean`);
    }
    if (typeof label !== 'string' || label.length > 128) {
      throw new NexaError('NEXA_E_SCHEMA', `plan[${index}].label must be a string of ≤ 128 chars`);
    }
    return { kind, target, protected: isProtected, label };
  });
}

/**
 * Pure deterministic reducer: events in, state out. No clock, no random, no I/O.
 * Structural breaks throw NEXA_E_MISSION_TAMPERED; illegal-but-chained
 * sequences throw NEXA_E_MISSION_STATE; unknown steps throw NEXA_E_MISSION_MISSING.
 * @param {object[]} events
 * @returns {{missionId: string, name: string, layer: string, steps: object[],
 *   verificationHash: string|null, terminal: object|null, head: string, length: number}}
 */
export function reduceMissionEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new NexaError('NEXA_E_SCHEMA', 'cannot reduce an empty mission log');
  }
  let prev = GENESIS_PREV;
  let missionId = null;
  let name = null;
  let steps = null;
  let verificationHash = null;
  let terminal = null;

  const stepAt = (stepIndex, position) => {
    if (!Number.isSafeInteger(stepIndex) || stepIndex < 0 || stepIndex >= steps.length) {
      throw new NexaError('NEXA_E_MISSION_MISSING', `event #${position} names unknown step ${String(stepIndex)}`);
    }
    return steps[stepIndex];
  };

  for (const [index, record] of events.entries()) {
    // --- structural checks (tamper-evidence) ---
    if (record === null || typeof record !== 'object') tampered(`mission record #${index} is not an object`);
    const { hash, verificationHash: seal, ...body } = record;
    if (typeof hash !== 'string' || sha(body) !== hash) {
      tampered(`mission record #${index} does not commit to its own hash`);
    }
    if (record.seq !== index) tampered(`mission record #${index} has wrong seq ${String(record.seq)}`);
    if (record.prev !== prev) tampered(`mission record #${index} breaks the chain`);
    if (!MISSION_EVENTS.includes(record.kind)) tampered(`mission record #${index} has unknown kind`);
    if (missionId === null) {
      if (record.kind !== 'MISSION_PLANNED') tampered('mission log does not start with MISSION_PLANNED');
      missionId = record.missionId;
    } else if (record.missionId !== missionId) {
      tampered(`mission record #${index} splices foreign mission ${String(record.missionId)}`);
    }
    prev = record.hash;

    // --- semantic checks (transitions) ---
    if (terminal !== null) badState(`mission record #${index} arrives after the terminal ${terminal.layer}`);
    switch (record.kind) {
      case 'MISSION_PLANNED': {
        if (index !== 0) badState('a mission has exactly one genesis');
        name = record.name;
        steps = record.plan.map((entry, stepIndex) => ({
          index: stepIndex,
          kind: entry.kind,
          target: entry.target,
          protected: entry.protected,
          label: entry.label,
          layer: 'PLANNED',
          approvalId: null,
          digest: null,
          verification: null,
        }));
        break;
      }
      case 'STEP_AUTHORIZED': {
        const step = stepAt(record.stepIndex, index);
        if (step.layer !== 'PLANNED') badState(`step ${step.index} is ${step.layer}, not authorizable`);
        for (let prior = 0; prior < step.index; prior += 1) {
          if (steps[prior].layer !== 'VERIFIED') {
            badState(`step ${step.index} cannot authorize while step ${prior} is ${steps[prior].layer}`);
          }
        }
        if (step.protected) {
          if (typeof record.approvalId !== 'string' || record.approvalId.length === 0) {
            badState(`protected step ${step.index} requires an approval binding`);
          }
          step.approvalId = record.approvalId;
        } else if (record.approvalId !== null) {
          badState(`unprotected step ${step.index} must not carry an approval binding`);
        }
        step.layer = 'AUTHORIZED';
        break;
      }
      case 'STEP_EXECUTED': {
        const step = stepAt(record.stepIndex, index);
        if (step.layer !== 'AUTHORIZED') badState(`step ${step.index} is ${step.layer}, not executable`);
        if (record.approvalId !== step.approvalId) {
          badState(`step ${step.index} executes with a different approval than authorized`);
        }
        if (typeof record.digest !== 'string' || record.digest.length === 0) {
          badState(`step ${step.index} execution carries no result digest`);
        }
        step.digest = record.digest;
        step.layer = 'EXECUTED';
        break;
      }
      case 'STEP_VERIFIED': {
        const step = stepAt(record.stepIndex, index);
        if (step.layer !== 'EXECUTED') badState(`step ${step.index} is ${step.layer}, not verifiable`);
        if (typeof record.verification !== 'string' || record.verification.length === 0) {
          badState(`step ${step.index} verification carries no digest`);
        }
        step.verification = record.verification;
        step.layer = 'VERIFIED';
        break;
      }
      case 'STEP_FAILED': {
        const step = stepAt(record.stepIndex, index);
        if (step.layer === 'VERIFIED') badState(`verified step ${step.index} cannot fail retroactively`);
        step.layer = 'FAILED';
        terminal = { layer: 'FAILED', code: record.code ?? null, reason: record.reason ?? null };
        break;
      }
      case 'MISSION_COMPLETED': {
        if (!steps.every((step) => step.layer === 'VERIFIED')) {
          badState('a mission completes only when every step is VERIFIED');
        }
        if (seal !== hash) tampered('MISSION_COMPLETED seal is not the chain head');
        verificationHash = seal;
        terminal = { layer: 'VERIFIED', code: null, reason: null };
        break;
      }
      case 'MISSION_DENIED':
      case 'MISSION_CANCELLED': {
        terminal = {
          layer: record.kind === 'MISSION_DENIED' ? 'DENIED' : 'CANCELLED',
          code: null,
          reason: record.reason ?? null,
        };
        break;
      }
      default:
        tampered(`mission record #${index} has unknown kind`);
    }
  }

  let layer;
  if (terminal !== null) {
    layer = terminal.layer;
  } else if (steps.some((step) => step.layer === 'EXECUTED' || step.layer === 'VERIFIED')) {
    layer = 'EXECUTED';
  } else if (steps.some((step) => step.layer === 'AUTHORIZED')) {
    layer = 'AUTHORIZED';
  } else {
    layer = 'PLANNED';
  }
  return { missionId, name, layer, steps, verificationHash, terminal, head: prev, length: events.length };
}

export class MissionLog {
  #now = () => new Date();
  /** @type {object[]} hash-chained mission events */
  #events = [];

  /** @param {{now?: () => Date}} [options] injected clock (deterministic in tests) */
  constructor({ now = () => new Date() } = {}) {
    this.#now = now;
  }

  /**
   * Genesis: plan the mission. Exactly one per log.
   * @returns {{missionId: string, layer: string, steps: number, head: string}}
   */
  create({ missionId = randomId('mission:'), name, plan } = {}) {
    if (this.#events.length > 0) badState('this log already holds a mission — create a new log');
    requireString(missionId, 'missionId', 128);
    requireString(name, 'name', 128);
    const clean = validatePlan(plan);
    const record = this.#append('MISSION_PLANNED', { missionId, name, plan: structuredClone(clean) });
    return { missionId, layer: 'PLANNED', steps: clean.length, head: record.hash };
  }

  /**
   * Authorize one step (the frontier). Protected steps bind an approval id.
   * @returns {{stepIndex: number, layer: string, approvalId: string|null, missionLayer: string}}
   */
  authorizeStep({ stepIndex, approvalId = null } = {}) {
    const state = this.#live();
    const step = this.#step(state, stepIndex);
    if (step.layer !== 'PLANNED') badState(`step ${step.index} is ${step.layer}, not authorizable`);
    for (let prior = 0; prior < step.index; prior += 1) {
      if (state.steps[prior].layer !== 'VERIFIED') {
        badState(`step ${step.index} cannot authorize while step ${prior} is ${state.steps[prior].layer}`);
      }
    }
    if (step.protected) {
      if (typeof approvalId !== 'string' || approvalId.length === 0) {
        badState(`protected step ${step.index} requires an approval binding`);
      }
      if (approvalId.length > 256) {
        throw new NexaError('NEXA_E_SCHEMA', 'approvalId must be a string of ≤ 256 chars');
      }
    } else if (approvalId !== null) {
      badState(`unprotected step ${step.index} must not carry an approval binding`);
    }
    this.#append('STEP_AUTHORIZED', { missionId: state.missionId, stepIndex: step.index, approvalId });
    return {
      stepIndex: step.index,
      layer: 'AUTHORIZED',
      approvalId: step.protected ? approvalId : null,
      missionLayer: this.#live().layer,
    };
  }

  /**
   * Record one execution. The approval id must equal the authorized binding.
   * @returns {{stepIndex: number, layer: string, missionLayer: string}}
   */
  executeStep({ stepIndex, approvalId = null, digest } = {}) {
    const state = this.#live();
    const step = this.#step(state, stepIndex);
    if (step.layer !== 'AUTHORIZED') badState(`step ${step.index} is ${step.layer}, not executable`);
    if (approvalId !== step.approvalId) {
      badState(`step ${step.index} executes with a different approval than authorized`);
    }
    requireString(digest, 'digest');
    this.#append('STEP_EXECUTED', { missionId: state.missionId, stepIndex: step.index, approvalId, digest });
    return { stepIndex: step.index, layer: 'EXECUTED', missionLayer: this.#live().layer };
  }

  /**
   * Verify one execution. Verifying the final step seals the mission:
   * MISSION_COMPLETED is appended and its seal IS the chain head.
   * @returns {{stepIndex: number, layer: string, missionLayer: string, verificationHash: string|null}}
   */
  verifyStep({ stepIndex, verification } = {}) {
    const state = this.#live();
    const step = this.#step(state, stepIndex);
    if (step.layer !== 'EXECUTED') badState(`step ${step.index} is ${step.layer}, not verifiable`);
    requireString(verification, 'verification');
    this.#append('STEP_VERIFIED', { missionId: state.missionId, stepIndex: step.index, verification });
    const after = this.state();
    let verificationHash = null;
    if (after.steps.every((entry) => entry.layer === 'VERIFIED')) {
      const sealed = this.#appendSealed('MISSION_COMPLETED', { missionId: after.missionId });
      verificationHash = sealed.verificationHash;
    }
    return {
      stepIndex: step.index,
      layer: 'VERIFIED',
      missionLayer: this.state().layer,
      verificationHash,
    };
  }

  /**
   * Fail one step — terminal for the whole mission.
   * @returns {{stepIndex: number, missionLayer: string}}
   */
  failStep({ stepIndex, code, reason = null } = {}) {
    const state = this.#live();
    const step = this.#step(state, stepIndex);
    if (step.layer === 'VERIFIED') badState(`verified step ${step.index} cannot fail retroactively`);
    requireString(code, 'code', 64);
    if (reason !== null && (typeof reason !== 'string' || reason.length > 512)) {
      throw new NexaError('NEXA_E_SCHEMA', 'reason must be a string of ≤ 512 chars or null');
    }
    this.#append('STEP_FAILED', { missionId: state.missionId, stepIndex: step.index, code, reason });
    return { stepIndex: step.index, missionLayer: 'FAILED' };
  }

  /**
   * Deny the mission (human refusal) — terminal.
   * @returns {{missionLayer: string}}
   */
  denyMission({ reason = null } = {}) {
    const state = this.#live();
    if (reason !== null && (typeof reason !== 'string' || reason.length > 512)) {
      throw new NexaError('NEXA_E_SCHEMA', 'reason must be a string of ≤ 512 chars or null');
    }
    this.#append('MISSION_DENIED', { missionId: state.missionId, reason });
    return { missionLayer: 'DENIED' };
  }

  /**
   * Cancel the mission (operator withdrawal) — terminal.
   * @returns {{missionLayer: string}}
   */
  cancelMission({ reason = null } = {}) {
    const state = this.#live();
    if (reason !== null && (typeof reason !== 'string' || reason.length > 512)) {
      throw new NexaError('NEXA_E_SCHEMA', 'reason must be a string of ≤ 512 chars or null');
    }
    this.#append('MISSION_CANCELLED', { missionId: state.missionId, reason });
    return { missionLayer: 'CANCELLED' };
  }

  /**
   * Re-import an event log (restore path). Verifies structure, transitions
   * and — when a head is given — truncation. Any break throws TAMPERED.
   * @param {object[]} events
   * @param {{head?: string}} [options] expected final hash
   */
  importEvents(events, { head } = {}) {
    if (!Array.isArray(events) || events.length === 0) {
      throw new NexaError('NEXA_E_SCHEMA', 'events must be a non-empty array');
    }
    if (head !== undefined && typeof head !== 'string') {
      throw new NexaError('NEXA_E_SCHEMA', 'head must be a string');
    }
    const copies = structuredClone(events);
    const reduced = reduceMissionEvents(copies); // throws on any break
    if (head !== undefined && reduced.head !== head) {
      tampered('imported chain head does not match the persisted head (truncation or divergence)');
    }
    this.#events = copies;
    return { ok: true, length: copies.length, missionId: reduced.missionId };
  }

  /** Structural chain check. @returns {{ok: true, length: number, head: string}} */
  verifyChain() {
    let prev = GENESIS_PREV;
    for (const [index, record] of this.#events.entries()) {
      const { hash, verificationHash: _seal, ...body } = record;
      if (typeof hash !== 'string' || sha(body) !== hash) {
        tampered(`mission record #${index} does not commit to its own hash`);
      }
      if (record.seq !== index) tampered(`mission record #${index} has wrong seq ${String(record.seq)}`);
      if (record.prev !== prev) tampered(`mission record #${index} breaks the chain`);
      prev = record.hash;
    }
    return { ok: true, length: this.#events.length, head: prev };
  }

  /** Derive current state through the pure reducer (never stored). */
  state() {
    if (this.#events.length === 0) badState('mission has no events yet — create it first');
    return reduceMissionEvents(this.#events);
  }

  /** Verify, then reduce from scratch. @returns {{ok: true, state: object, head: string, length: number}} */
  replay() {
    const chain = this.verifyChain();
    return { ok: true, state: this.state(), head: chain.head, length: chain.length };
  }

  /** @returns {object[]} deep copy of the event log */
  events() {
    return structuredClone(this.#events);
  }

  // --- internals -----------------------------------------------------------

  /** Current derived state, refusing terminal logs. */
  #live() {
    const state = this.state();
    if (TERMINAL_LAYERS.includes(state.layer)) {
      badState(`mission ${state.missionId} is terminal (${state.layer}) — no further transitions`);
    }
    return state;
  }

  #step(state, stepIndex) {
    if (!Number.isSafeInteger(stepIndex) || stepIndex < 0 || stepIndex >= state.steps.length) {
      throw new NexaError('NEXA_E_MISSION_MISSING', `unknown step ${String(stepIndex)}`);
    }
    return state.steps[stepIndex];
  }

  /** Append one chained record (the body is canonicalized before hashing). */
  #append(kind, fields) {
    const seq = this.#events.length;
    const prev = seq === 0 ? GENESIS_PREV : this.#events[seq - 1].hash;
    const body = { seq, ts: formatInstant(this.#now()), kind, prev, ...fields };
    const record = { ...body, hash: sha(body) };
    this.#events.push(record);
    return record;
  }

  /** Append MISSION_COMPLETED with verificationHash defined as the chain head. */
  #appendSealed(kind, fields) {
    const seq = this.#events.length;
    const prev = seq === 0 ? GENESIS_PREV : this.#events[seq - 1].hash;
    const body = { seq, ts: formatInstant(this.#now()), kind, prev, ...fields };
    const hash = sha(body);
    const record = { ...body, hash, verificationHash: hash };
    this.#events.push(record);
    return record;
  }
}
