/**
 * Observations — what actually happened, as data.
 *
 * The learning layer never reads a live runtime. It reads *observations*: small,
 * immutable, content-addressed summaries of finished runs, derived from the Ω ledger.
 * Every observation carries the record hashes it was derived from, so any claim the
 * learning layer later makes can be walked back to evidence.
 *
 * The runtime reads no clock; a deterministic run has no latency and costs nothing to
 * measure. Whatever the host can measure (wall time, tokens, money) is *injected* here
 * as `measurements`. A learning system that invents its own numbers is not measuring.
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';

export const OMEGA_OBSERVATION_DOMAIN = 'NEXA/omega1 observation\u0000';

/** Every call the ledger recorded, in order. */
/**
 * Records that represent a call and its outcome. `CELL_MESSAGE` joined the list with the
 * cellular layer: a crossing of a membrane is a call with a resource (the cell), an action
 * (the receptor) and a decision, so a cell refusal is observable exactly like a tool
 * refusal — that is how cellular learning gets its evidence.
 */
const CALL_KINDS = Object.freeze(['TOOL_RESULT', 'GATE_REFUSAL', 'CIRCUIT_OPEN', 'CELL_MESSAGE']);

/** @param {object} value @returns {string} a content address for an observation */
export function observationId(value) {
  const body = { ...value };
  delete body.id;
  return sha256Multihash(Buffer.concat([
    Buffer.from(OMEGA_OBSERVATION_DOMAIN, 'utf8'),
    canonicalBytes(body),
  ]));
}

/**
 * One *call*, not one record: a call refused by a closed gate writes both a TOOL_RESULT
 * and a GATE_REFUSAL, and counting both would double every failure. The result record
 * wins; the others contribute evidence and detail.
 *
 * @param {object[]} records Ω ledger records from one run
 * @returns {object[]} call-level observations, in ledger order
 */
export function callObservations(records) {
  if (!Array.isArray(records)) throw new OmegaError('OMEGA_E_OBSERVATION', 'records must be an array');
  const order = [];
  const calls = new Map();
  for (const record of records) {
    if (!CALL_KINDS.includes(record.kind)) continue;
    if (typeof record.resource !== 'string') continue;
    const key = `${record.mission}\u0000${record.step}\u0000${record.resource}\u0000${record.action ?? ''}`;
    const existing = calls.get(key);
    const isResult = record.kind === 'TOOL_RESULT' || record.kind === 'CELL_MESSAGE';
    if (existing !== undefined && !isResult) {
      existing.evidence.push(record.hash);
      existing.gate = existing.gate ?? record.detail?.gate ?? null;
      continue;
    }
    const observation = {
      nexa: 'omega1',
      kind: 'CallObservation',
      mission: record.mission,
      step: record.step,
      resource: record.resource,
      action: record.action ?? null,
      decision: record.decision,
      code: record.detail?.code ?? (record.kind === 'CIRCUIT_OPEN' ? 'OMEGA_E_CIRCUIT_OPEN' : null),
      gate: record.detail?.gate ?? null,
      capability: record.capability ?? null,
      receipts: record.detail?.receipt === undefined ? [] : [record.detail.receipt],
      evidence: existing === undefined ? [record.hash] : [...existing.evidence, record.hash],
      at: record.ts,
      kind_of_record: record.kind,
    };
    if (existing === undefined) order.push(key);
    calls.set(key, observation);
  }
  return order.map((key) => {
    const observation = calls.get(key);
    const { id, ...body } = { ...observation }; // eslint-disable-line no-unused-vars
    return { ...body, id: observationId(body) };
  });
}

/**
 * @param {object} outcome what `runtime.run(mission)` returned
 * @param {{latency_ms?: number, cost?: number, tokens?: number}} [measurements] host-side numbers
 * @returns {object} one run observation, with its calls nested
 */
export function observeRun(outcome, measurements = {}) {
  if (typeof outcome !== 'object' || outcome === null) {
    throw new OmegaError('OMEGA_E_OBSERVATION', 'an outcome object is required');
  }
  if (!Array.isArray(outcome.records)) {
    throw new OmegaError('OMEGA_E_OBSERVATION', 'the outcome has no records: the runtime must be run with a ledger');
  }
  for (const key of Object.keys(measurements)) {
    if (!['latency_ms', 'cost', 'tokens'].includes(key)) {
      throw new OmegaError('OMEGA_E_OBSERVATION', `unknown measurement: ${key}`, { known: ['latency_ms', 'cost', 'tokens'] });
    }
    const value = measurements[key];
    if (!Number.isFinite(value) || value < 0) {
      throw new OmegaError('OMEGA_E_OBSERVATION', `${key} must be a non-negative finite number`);
    }
  }
  const calls = callObservations(outcome.records);
  const failures = calls.filter((call) => call.decision === 'DENY').map((call) => call.code ?? 'OMEGA_E_UNKNOWN');
  const body = {
    nexa: 'omega1',
    kind: 'RunObservation',
    mission: outcome.mission,
    agent: outcome.agent,
    module: outcome.records[0]?.module ?? null,
    verdict: outcome.status,
    code: outcome.code ?? null,
    steps: outcome.steps,
    records: outcome.records.length,
    receipts: outcome.receipts.length,
    contracts: outcome.contracts.map((contract) => ({ claim: contract.claim, ok: contract.ok })),
    calls: calls.length,
    failures: [...new Set(failures)].sort(),
    failure_count: failures.length,
    latency_ms: measurements.latency_ms ?? 0,
    cost: measurements.cost ?? 0,
    tokens: measurements.tokens ?? 0,
    measured: Object.keys(measurements).length > 0,
    evidence: outcome.records.map((record) => record.hash),
    calls_detail: calls,
    at: outcome.records.at(-1)?.ts ?? outcome.records[0]?.ts ?? null,
  };
  return { ...body, id: observationId(body) };
}

/** @param {object} observation @returns {object[]} the run's call observations */
export function callsOf(observation) {
  return Array.isArray(observation?.calls_detail) ? observation.calls_detail : [];
}

/** @param {object[]} observations @returns {object[]} just the call observations */
export function flattenCalls(observations) {
  const calls = [];
  for (const observation of observations) calls.push(...callsOf(observation));
  return calls;
}
