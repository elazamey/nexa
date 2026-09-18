/**
 * Knowledge — beliefs with a lifecycle, not a pile of facts.
 *
 * Two rules make this different from a notes file:
 *
 *   1. **Nothing becomes verified without evidence.** A belief is born `HYPOTHESIZED`
 *      and reaches `VERIFIED` only through `verify()` with a non-empty evidence list.
 *      `HYPOTHESIZED → VERIFIED` is exactly the move the design forbids, so it is the
 *      move the code refuses.
 *   2. **Contradicted knowledge is invalidated, not buried.** `invalidate()` marks an
 *      entry and cascades to everything that depended on it (`STALE`), because a belief
 *      built on a dead premise is not "still probably fine" — it is unknown.
 *
 * Secrets never enter: the store refuses anything that even looks like key material.
 * The real net is `SecretString` in the compiler; this is the cheap one behind it.
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';
import { MEMORY_TIERS } from '../../compiler/index.js';

/** The five epistemic states, and the one direction that is not allowed. */
export const EPISTEMIC_STATES = Object.freeze([
  'OBSERVED', // something was read from the world
  'INFERRED', // something follows from observations
  'HYPOTHESIZED', // a claim about what would happen
  'PREDICTED', // a claim about what will happen
  'VERIFIED', // a claim backed by evidence
]);

/** Which state may follow which. */
const PROMOTIONS = Object.freeze({
  OBSERVED: ['INFERRED', 'HYPOTHESIZED'],
  INFERRED: ['HYPOTHESIZED', 'PREDICTED'],
  HYPOTHESIZED: ['PREDICTED', 'VERIFIED'],
  PREDICTED: ['VERIFIED'],
  VERIFIED: [],
});

/** Verifying anything requires evidence — no exceptions, including for `OBSERVED`. */
const NEEDS_EVIDENCE = Object.freeze(['VERIFIED', 'INFERRED']);

export const KNOWLEDGE_STATUS = Object.freeze(['HYPOTHESIZED', 'VERIFIED', 'INVALIDATED', 'STALE']);

export const OMEGA_KNOWLEDGE_DOMAIN = 'NEXA/omega1 knowledge\u0000';

const SECRET_SHAPES = Object.freeze([
  /AIza[0-9A-Za-z_-]{10,}/, // Google API keys
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI-style keys
  /\bghp_[A-Za-z0-9]{20,}/, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]);

/** @param {unknown} claim @returns {string} */
function assertClaim(claim) {
  if (typeof claim !== 'string' || claim.trim().length === 0) {
    throw new OmegaError('OMEGA_E_KNOWLEDGE', 'a claim must be a non-empty string');
  }
  if (claim.length > 2048) throw new OmegaError('OMEGA_E_KNOWLEDGE', 'a claim must be at most 2048 characters');
  for (const shape of SECRET_SHAPES) {
    if (shape.test(claim)) {
      throw new OmegaError('OMEGA_E_SECRET_LITERAL', 'knowledge may not contain credential-shaped material');
    }
  }
  return claim;
}

/** @param {unknown} id @returns {string} */
function assertRef(id, what) {
  if (typeof id !== 'string' || !/^sha256:[A-Za-z0-9_-]{43}$/.test(id)) {
    throw new OmegaError('OMEGA_E_KNOWLEDGE', `${what} must be a sha256 multihash`);
  }
  return id;
}

/**
 * Confidence is basis points, not a float: NEXA data is canonical-integer by
 * construction, and a number that cannot be hashed cannot be committed to.
 * @param {unknown} value @returns {number}
 */
function assertConfidence(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new OmegaError('OMEGA_E_KNOWLEDGE', 'confidence_bp must be an integer in [0, 10000]');
  }
  return value;
}

/**
 * @param {object} claim a claim in one of the five epistemic states
 * @param {{to: string, evidence?: string[], by?: string}} promotion
 * @returns {object} the promoted claim
 */
export function promoteClaim(claim, { to, evidence = [], by = null } = {}) {
  if (typeof claim !== 'object' || claim === null || typeof claim.state !== 'string') {
    throw new OmegaError('OMEGA_E_KNOWLEDGE', 'a claim object with a state is required');
  }
  if (!EPISTEMIC_STATES.includes(to)) {
    throw new OmegaError('OMEGA_E_EPISTEMIC', `unknown epistemic state: ${String(to)}`, { known: [...EPISTEMIC_STATES] });
  }
  if (!PROMOTIONS[claim.state].includes(to)) {
    throw new OmegaError('OMEGA_E_EPISTEMIC', `${claim.state} does not promote to ${to}`, {
      allowed: [...PROMOTIONS[claim.state]],
    });
  }
  if (NEEDS_EVIDENCE.includes(to) && (!Array.isArray(evidence) || evidence.length === 0)) {
    throw new OmegaError('OMEGA_E_UNPROVEN', `a claim cannot become ${to} without evidence`);
  }
  return {
    ...claim,
    state: to,
    evidence: [...new Set([...(claim.evidence ?? []), ...evidence])],
    promoted_by: by,
    history: [...(claim.history ?? []), { from: claim.state, to, by, evidence: evidence.length }],
  };
}

export class KnowledgeStore {
  #entries = new Map();
  #clock;

  /** @param {{clock?: () => Date, entries?: object[]}} [input] */
  constructor({ clock = () => new Date(), entries = [] } = {}) {
    this.#clock = clock;
    for (const entry of entries) this.#insert({ ...entry });
  }

  #insert(entry) {
    const body = { ...entry };
    delete body.id;
    entry.id = sha256Multihash(Buffer.concat([
      Buffer.from(OMEGA_KNOWLEDGE_DOMAIN, 'utf8'),
      canonicalBytes(body),
    ]));
    this.#entries.set(entry.id, entry);
    return entry;
  }

  /**
   * @param {object} input
   * @param {string} input.claim
   * @param {string} [input.tier] which memory tier this belongs to
   * @param {string} [input.source] where the claim came from (a module, a mission, a human)
   * @param {string[]} [input.evidence] evidence ids; non-empty is required for VERIFIED
   * @param {number} [input.confidence_bp] an integer out of 10000
   * @param {string} [input.created_by]
   * @param {string[]} [input.dependencies] knowledge ids this claim rests on
   * @param {string} [input.state] starting epistemic state
   * @returns {object}
   */
  add({
    claim,
    tier = 'semantic',
    source = null,
    evidence = [],
    confidence_bp = 5_000,
    created_by = null,
    dependencies = [],
    state = 'HYPOTHESIZED',
  } = {}) {
    if (!MEMORY_TIERS.includes(tier)) {
      throw new OmegaError('OMEGA_E_SCHEMA', `unknown memory tier: ${tier}`, { known: [...MEMORY_TIERS] });
    }
    if (!EPISTEMIC_STATES.includes(state)) {
      throw new OmegaError('OMEGA_E_EPISTEMIC', `unknown epistemic state: ${String(state)}`);
    }
    for (const id of evidence) assertRef(id, 'an evidence id');
    for (const id of dependencies) assertRef(id, 'a dependency');
    for (const id of dependencies) {
      // Following a ghost is worse than refusing: a claim that rests on nothing must not
      // be able to look like a claim that rests on something.
      if (this.get(id) === null) {
        throw new OmegaError('OMEGA_E_KNOWLEDGE_UNKNOWN', `dependency ${id} does not exist`);
      }
    }
    const now = this.#clock().toISOString();
    const status = state === 'VERIFIED' ? 'VERIFIED' : 'HYPOTHESIZED';
    if (status === 'VERIFIED' && evidence.length === 0) {
      throw new OmegaError('OMEGA_E_UNPROVEN', 'a verified belief needs evidence');
    }
    return this.#insert({
      nexa: 'omega1',
      kind: 'Knowledge',
      tier,
      claim: assertClaim(claim),
      state,
      status,
      source,
      confidence_bp: assertConfidence(confidence_bp),
      evidence: [...new Set(evidence)],
      counter_evidence: [],
      created_by,
      created: now,
      last_verified: status === 'VERIFIED' ? now : null,
      dependencies: [...new Set(dependencies)],
      invalidated_by: null,
      invalidation_reason: null,
    });
  }

  /** @param {string} id @returns {object|null} */
  get(id) {
    return this.#entries.get(id) ?? null;
  }

  /**
   * @param {string} id
   * @param {{evidence?: string[], by?: string, confidence_bp?: number}} [input]
   * @returns {object} the verified entry
   */
  verify(id, { evidence = [], by = null, confidence_bp = null } = {}) {
    const entry = this.get(id);
    if (entry === null) throw new OmegaError('OMEGA_E_KNOWLEDGE_UNKNOWN', `unknown knowledge: ${String(id)}`);
    if (entry.status === 'INVALIDATED') {
      throw new OmegaError('OMEGA_E_KNOWLEDGE_INVALIDATED', 'an invalidated belief cannot be verified; add a new claim instead');
    }
    for (const ref of evidence) assertRef(ref, 'an evidence id');
    if (evidence.length === 0 && entry.evidence.length === 0) {
      throw new OmegaError('OMEGA_E_UNPROVEN', `knowledge ${id} cannot be verified without evidence`);
    }
    const now = this.#clock().toISOString();
    const updated = {
      ...entry,
      state: 'VERIFIED',
      status: 'VERIFIED',
      evidence: [...new Set([...entry.evidence, ...evidence])],
      confidence_bp: confidence_bp === null ? Math.max(entry.confidence_bp, 9_000) : assertConfidence(confidence_bp),
      last_verified: now,
      verified_by: by,
    };
    this.#entries.set(id, updated);
    return { ...updated };
  }

  /**
   * Contradicted knowledge is invalidated, and everything resting on it goes `STALE`.
   *
   * @param {string} id
   * @param {{by?: string, reason?: string, evidence?: string[]}} [input]
   * @returns {{invalidated: object, stale: string[]}}
   */
  invalidate(id, { by = null, reason = null, evidence = [] } = {}) {
    const entry = this.get(id);
    if (entry === null) throw new OmegaError('OMEGA_E_KNOWLEDGE_UNKNOWN', `unknown knowledge: ${String(id)}`);
    const now = this.#clock().toISOString();
    const updated = {
      ...entry,
      status: 'INVALIDATED',
      invalidated_by: by,
      invalidation_reason: reason,
      counter_evidence: [...new Set([...entry.counter_evidence, ...evidence])],
      invalidated_at: now,
    };
    this.#entries.set(id, updated);

    const stale = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const [candidateId, candidate] of this.#entries) {
        if (candidate.status !== 'VERIFIED' && candidate.status !== 'HYPOTHESIZED') continue;
        if (!candidate.dependencies.includes(id) && !candidate.dependencies.some((dep) => stale.includes(dep))) continue;
        this.#entries.set(candidateId, { ...candidate, status: 'STALE', invalidated_by: id });
        stale.push(candidateId);
        changed = true;
      }
    }
    return { invalidated: { ...updated }, stale: stale.sort() };
  }

  /**
   * @param {{tier?: string, status?: string, state?: string}} [query]
   * @returns {object[]} entries, oldest first
   */
  query({ tier = null, status = null, state = null } = {}) {
    return [...this.#entries.values()]
      .filter((entry) => tier === null || entry.tier === tier)
      .filter((entry) => status === null || entry.status === status)
      .filter((entry) => state === null || entry.state === state)
      .sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id))
      .map((entry) => ({ ...entry }));
  }

  /** @returns {object} */
  summary() {
    const byStatus = {};
    for (const entry of this.#entries.values()) byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
    return { entries: this.#entries.size, by_status: byStatus, digest: this.digest() };
  }

  /** @returns {string} a content address over every belief */
  digest() {
    const ordered = [...this.#entries.values()].sort((a, b) => a.id.localeCompare(b.id));
    return sha256Multihash(canonicalBytes(ordered));
  }
}
