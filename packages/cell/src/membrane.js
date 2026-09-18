/**
 * The membrane — the only way into a cell.
 *
 * Every message crosses the same seven steps in the same order:
 *
 *   identity → capability → type → policy → budget → execution → evidence
 *
 * The membrane decides, and it records its own decisions, so a refusal cannot be lost by
 * forgetting to log it somewhere else. What it does **not** do is mint: verification is a
 * port handed in by the tissue, wired to the operator's authority. A cell that loses its
 * mind has no key, no authority object and no path to either.
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';
import { SERVING_STATES, DIAGNOSTIC_STATES } from './lifecycle.js';

export const MEMBRANE_STEPS = Object.freeze(['identity', 'capability', 'type', 'policy', 'budget', 'execution', 'evidence']);

/** Receptors a cell answers outside ACTIVE: life support, nothing else. */
export const LIFE_SUPPORT = Object.freeze(['health', 'recover', 'retire']);

/** A NEXA key id is self-certifying; a label cannot impersonate it. */
const KID = /^nexa:key:ed25519:z[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * @param {object} input
 * @param {{name: string, kid: string, kind: string}} input.self
 * @param {Record<string, {handler: Function, accepts?: string[]|null, requires?: string[], description?: string}>} input.receptors
 * @param {{verify: Function, record: Function}} input.port
 * @param {{max_payload_bytes?: number, max_calls?: number}} [input.budget]
 * @param {{state: () => string, degrade: (code: string) => void}} input.lifecycle
 * @param {object} input.health
 * @param {() => Date} input.clock
 */
export function createMembrane({ self, receptors, port, budget = {}, lifecycle, health, clock }) {
  if (typeof self?.name !== 'string' || typeof self?.kid !== 'string') {
    throw new OmegaError('OMEGA_E_MEMBRANE', 'a membrane needs a cell identity');
  }
  if (typeof port?.verify !== 'function' || typeof port?.record !== 'function') {
    throw new OmegaError('OMEGA_E_MEMBRANE', 'a membrane needs a port: { verify, record }');
  }
  const maxPayloadBytes = budget.max_payload_bytes ?? 16_384;
  const maxCalls = budget.max_calls ?? 1_000;
  let calls = 0;

  const ok = (step, value, detail = {}) => ({ ok: true, code: null, reason: null, step, value, detail });

  /** Refuse, and record the refusal before returning it. */
  const refuse = (code, reason, step, detail = {}, message = null) => {
    const entry = port.record({
      kind: 'CELL_MESSAGE',
      decision: 'DENY',
      cell: self.name,
      from: message?.from ?? null,
      receptor: message?.receptor ?? null,
      capability: message?.capability?.id ?? null,
      detail: { step, code, reason },
    });
    return { ok: false, code, reason, step, detail: { ...detail, record: entry?.hash ?? null } };
  };

  /**
   * @param {{from: string, from_kid: string, receptor: string, payload?: object,
   *          capability?: object|null, audience?: string[]}} message
   * @returns {object} `{ok, code, step, value, detail}`
   */
  function receive(message) {
    if (typeof message !== 'object' || message === null) {
      return refuse('OMEGA_E_MEMBRANE', 'a message must be an object', 'identity');
    }
    const { from, from_kid: fromKid, receptor, payload = {}, capability = null } = message;

    // 1. identity — who is speaking, and to which receptor?
    if (typeof from !== 'string' || from.length === 0) {
      return refuse('OMEGA_E_MEMBRANE', 'a message needs a sender', 'identity', {}, message);
    }
    if (typeof fromKid !== 'string' || !KID.test(fromKid)) {
      return refuse('OMEGA_E_IDENTITY', 'a message must carry the sender key id', 'identity', {}, message);
    }
    if (typeof receptor !== 'string' || !Object.hasOwn(receptors, receptor)) {
      return refuse('OMEGA_E_RECEPTOR', `${self.name} has no receptor ${String(receptor)}`, 'identity', { known: Object.keys(receptors).sort() }, message);
    }
    const state = lifecycle.state();
    const lifeSupport = LIFE_SUPPORT.includes(receptor);
    if (!SERVING_STATES.includes(state) && !(lifeSupport && DIAGNOSTIC_STATES.includes(state))) {
      return refuse('OMEGA_E_ISOLATED', `${self.name} is ${state} and does not serve ${receptor}`, 'identity', { state }, message);
    }

    // 2. capability — checked by a port the cell does not own.
    const verdict = port.verify(capability, { presenter: fromKid, resource: `cell:${self.name}`, action: receptor, at: clock() });
    if (verdict.ok !== true) {
      health.observe({ resource: `cell:${self.name}`, ok: false, code: verdict.code ?? 'OMEGA_E_CAP_MISSING' });
      lifecycle.degrade(verdict.code ?? 'OMEGA_E_CAP_MISSING');
      return refuse(verdict.code ?? 'OMEGA_E_CAP_MISSING', verdict.reason ?? 'the capability did not verify', 'capability', verdict.detail ?? {}, message);
    }

    // 3. type — payloads are canonical data, and only the keys the receptor declares.
    let bytes;
    try {
      canonicalBytes(payload);
      bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    } catch (cause) {
      return refuse('OMEGA_E_SCHEMA', cause.message, 'type', {}, message);
    }
    const accepts = receptors[receptor].accepts ?? null;
    if (accepts !== null) {
      const unknown = Object.keys(payload).filter((key) => !accepts.includes(key));
      if (unknown.length > 0) {
        return refuse('OMEGA_E_SCHEMA', `${self.name}.${receptor} does not accept ${unknown.join(', ')}`, 'type', { accepts }, message);
      }
    }

    // 4. policy — a receptor may require a named audience (owner, tenant, role).
    const required = receptors[receptor].requires ?? [];
    const audience = message.audience ?? null;
    const missing = required.filter((entry) => !Array.isArray(audience) || !audience.includes(entry));
    if (missing.length > 0) {
      return refuse('OMEGA_E_POLICY', `${self.name}.${receptor} requires ${missing.join(', ')}`, 'policy', { required }, message);
    }

    // 5. budget — the cell's own ceiling, checked before any work happens.
    calls += 1;
    if (calls > maxCalls) return refuse('OMEGA_E_BUDGET', `${self.name} exhausted max_calls (${maxCalls})`, 'budget', {}, message);
    if (bytes > maxPayloadBytes) {
      return refuse('OMEGA_E_BUDGET', `${bytes} byte payload exceeds ${maxPayloadBytes}`, 'budget', { bytes, limit: maxPayloadBytes }, message);
    }

    // 6. execution — a thrown error is a refusal, not a crash.
    let value;
    const startedAt = clock().getTime();
    try {
      value = receptors[receptor].handler({ payload, from, from_kid: fromKid, grant: verdict.grant, message });
    } catch (cause) {
      const code = typeof cause?.code === 'string' ? cause.code : 'OMEGA_E_HANDLER';
      const latencyMs = Math.max(0, clock().getTime() - startedAt);
      health.observe({ resource: `cell:${self.name}`, ok: false, code, latency_ms: latencyMs });
      lifecycle.degrade(code);
      return refuse(code, cause?.message ?? String(cause), 'execution', {}, message);
    }
    if (value !== null && typeof value === 'object') canonicalBytes(value);
    const latencyMs = Math.max(0, clock().getTime() - startedAt);
    health.observe({ resource: `cell:${self.name}`, ok: true, latency_ms: latencyMs });

    // 7. evidence — the decision and the payload digest, never the payload.
    const record = port.record({
      kind: 'CELL_MESSAGE',
      decision: 'ALLOW',
      cell: self.name,
      from,
      receptor,
      capability: verdict.grant?.id ?? null,
      detail: {
        step: 'evidence',
        latency_ms: latencyMs,
        bytes,
        payload_digest: sha256Multihash(canonicalBytes(payload)),
      },
    });
    return ok('evidence', value, { record: record?.hash ?? null, latency_ms: latencyMs, bytes, grant: verdict.grant ?? null });
  }

  return { receive, steps: MEMBRANE_STEPS, budget: { max_payload_bytes: maxPayloadBytes, max_calls: maxCalls } };
}
