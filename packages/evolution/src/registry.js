/**
 * The version registry — immutable versions, canary windows, explicit activation.
 *
 * The active version of a module is a *pointer*, not a mutated process. Ω never patches
 * itself in place: it proposes, proves, canaries and — on an explicit call by an allowed
 * identity — switches. The previous version is never deleted, so a rollback is a pointer
 * move rather than a restore.
 */
import { formatInstant } from '../../ast/index.js';
import { OmegaError } from '../../compiler/index.js';
import { describeVerdict, evaluateGate } from './gate.js';
import { refOf, verifyManifest } from './manifest.js';

export const VERSION_STATES = Object.freeze(['proposed', 'canary', 'active', 'quarantined', 'rejected']);

export class VersionRegistry {
  #modules = new Map();

  /**
   * @param {object} [input]
   * @param {{module: string, version: number, active?: boolean, manifest?: object}[]} [input.versions] seed versions
   * @param {string[]} [input.activators] key ids allowed to activate or roll back
   * @param {string[]|null} [input.evolvers] key ids allowed to propose
   * @param {number} [input.requiredObservations] clean canary samples before activation
   * @param {{append: Function}|null} [input.ledger] optional Ω ledger to record into
   */
  constructor({
    versions = [],
    activators = [],
    evolvers = null,
    requiredObservations = 2,
    ledger = null,
  } = {}) {
    if (!Number.isSafeInteger(requiredObservations) || requiredObservations < 1) {
      throw new OmegaError('OMEGA_E_CANARY_INCOMPLETE', 'requiredObservations must be a positive integer');
    }
    this.activators = [...activators].sort();
    this.evolvers = evolvers === null ? null : [...evolvers].sort();
    this.requiredObservations = requiredObservations;
    this.ledger = ledger;
    for (const version of versions) {
      const ref = refOf(version.module, version.version);
      const entry = this.#module(version.module);
      entry.versions.set(ref, {
        ref,
        manifest: version.manifest ?? null,
        state: version.active === true ? 'active' : 'proposed',
        observations: [],
        verdict: null,
        notes: [],
      });
      if (version.active === true) entry.active = ref;
    }
  }

  #module(name) {
    if (!this.#modules.has(name)) {
      this.#modules.set(name, { name, active: null, versions: new Map() });
    }
    return this.#modules.get(name);
  }

  #entry(ref) {
    const at = ref.indexOf('@');
    const moduleName = at === -1 ? ref : ref.slice(0, at);
    const entry = this.#modules.get(moduleName)?.versions.get(ref);
    if (entry === undefined) {
      throw new OmegaError('OMEGA_E_VERSION_UNKNOWN', `${ref} is not in the registry`, {
        known: [...this.#modules.values()].flatMap((module) => [...module.versions.keys()]).sort(),
      });
    }
    return entry;
  }

  #record(kind, decision, detail) {
    if (this.ledger === null || typeof this.ledger.append !== 'function') return null;
    return this.ledger.append({ kind, decision, mission: '-', detail });
  }

  /**
   * Registers a proposal. Immutable: a version that already exists is never replaced.
   * @param {object} manifest a signed manifest
   * @returns {{ref: string, state: string, verification: object}}
   */
  propose(manifest) {
    const verification = verifyManifest(manifest, { evolvers: this.evolvers });
    if (!verification.ok) {
      throw new OmegaError(verification.code, verification.reason);
    }
    const entry = this.#module(manifest.module);
    if (entry.versions.has(verification.ref)) {
      throw new OmegaError('OMEGA_E_VERSION_DUPLICATE', `${verification.ref} already exists; versions are immutable`, {
        ref: verification.ref,
      });
    }
    entry.versions.set(verification.ref, {
      ref: verification.ref,
      manifest,
      state: 'proposed',
      observations: [],
      verdict: null,
      notes: [],
    });
    this.#record('PROPOSAL', 'INFO', {
      ref: verification.ref,
      parent: manifest.parent === null ? null : refOf(manifest.module, manifest.parent),
      hypothesis: manifest.notes?.hypothesis ?? null,
      capabilities: manifest.capabilities,
      evolver: manifest.evolver,
    });
    return { ref: verification.ref, state: 'proposed', verification };
  }

  /**
   * Runs the deterministic gate for one candidate.
   * @param {object} input
   * @param {string} input.ref
   * @param {object} input.checks
   * @param {Date} input.now
   */
  evaluate({ ref, checks, now = new Date('1970-01-01T00:00:00Z') }) {
    const entry = this.#entry(ref);
    if (entry.manifest === null) {
      throw new OmegaError('OMEGA_E_VERSION_UNKNOWN', `${ref} has no manifest to evaluate`);
    }
    const parentManifest = entry.manifest.parent === null
      ? null
      : this.#entry(refOf(entry.manifest.module, entry.manifest.parent)).manifest;
    const verdict = evaluateGate({ candidate: entry.manifest, parent: parentManifest, checks, evolvers: this.evolvers, now });
    entry.verdict = verdict;
    entry.state = verdict.verdict === 'PASS' ? 'canary' : 'quarantined';
    this.#record('GATE', verdict.verdict === 'PASS' ? 'ALLOW' : 'DENY', {
      ref,
      verdict: verdict.verdict,
      failed: verdict.failed,
      reason: verdict.reason,
      action: verdict.action,
      summary: describeVerdict(verdict),
    });
    if (verdict.verdict !== 'PASS') {
      this.#record('QUARANTINE', 'DENY', { ref, reason: verdict.reason, failed: verdict.failed });
    }
    return verdict;
  }

  /**
   * Records one canary observation. A sample that violates a declared expectation fails
   * the candidate; only an allowed activator may move it back into canary.
   * @param {{ref: string, sample: Record<string, number>}} input
   */
  observe({ ref, sample }) {
    const entry = this.#entry(ref);
    if (entry.state !== 'canary') {
      throw new OmegaError('OMEGA_E_GATE_STAGE', `${ref} is ${entry.state}; only a candidate in canary may be observed`);
    }
    const violated = (entry.manifest.expectations ?? []).filter((expectation) => {
      const value = sample?.[expectation.metric];
      if (typeof value !== 'number') return true;
      switch (expectation.op) {
        case '==': return value !== expectation.value;
        case '!=': return value === expectation.value;
        case '<': return !(value < expectation.value);
        case '<=': return !(value <= expectation.value);
        case '>': return !(value > expectation.value);
        case '>=': return !(value >= expectation.value);
        default: return true;
      }
    });
    const clean = violated.length === 0;
    // Every sample is stored with its verdict, because a window is only green if the
    // samples in it were: counting samples instead of *clean* samples is how a failed
    // canary gets activated.
    entry.observations.push({ sample: { ...sample }, clean });
    this.#record('CANARY', clean ? 'INFO' : 'DENY', {
      ref,
      sample,
      clean,
      observations: entry.observations.length,
      required: this.requiredObservations,
      ...(clean ? {} : { violated: violated.map((expectation) => expectation.metric) }),
    });
    if (!clean) {
      entry.state = 'quarantined';
      this.#record('QUARANTINE', 'DENY', {
        ref,
        reason: 'a canary sample violated a declared expectation',
        violated: violated.map((expectation) => expectation.metric),
      });
    }
    return { ref, clean, observations: entry.observations.length, required: this.requiredObservations, state: entry.state };
  }

  /**
   * The only way a version becomes active. Explicit, attributed, and refused until the
   * canary window is satisfied.
   * @param {{ref: string, by: string, now?: Date}} input
   */
  activate({ ref, by, now = new Date('1970-01-01T00:00:00Z') }) {
    const entry = this.#entry(ref);
    if (!this.activators.includes(by)) {
      throw new OmegaError('OMEGA_E_NOT_ACTIVATOR', `${by} may not activate versions`, { allowed: this.activators });
    }
    if (entry.verdict?.verdict !== 'PASS') {
      throw new OmegaError('OMEGA_E_GATE_STAGE', `${ref} has no passing gate verdict`);
    }
    if (entry.state === 'active') {
      throw new OmegaError('OMEGA_E_VERSION_DUPLICATE', `${ref} is already active`);
    }
    if (entry.state === 'quarantined' || entry.state === 'rejected') {
      // A quarantine is not a warning. Without this check a candidate that violated its
      // own declared expectations could still be activated once it had enough samples.
      throw new OmegaError('OMEGA_E_QUARANTINED', `${ref} is ${entry.state}: it violated a declared expectation in canary`);
    }
    const clean = entry.observations.filter((observation) => observation.clean === true).length;
    if (clean < this.requiredObservations) {
      throw new OmegaError(
        'OMEGA_E_CANARY_INCOMPLETE',
        `${ref} has ${clean} clean observation(s); ${this.requiredObservations} are required`,
        { observations: clean, total: entry.observations.length, required: this.requiredObservations },
      );
    }
    const moduleEntry = this.#module(entry.manifest.module);
    const previous = moduleEntry.active;
    if (previous !== null) {
      const previousEntry = moduleEntry.versions.get(previous);
      previousEntry.state = 'proposed';
    }
    moduleEntry.active = ref;
    entry.state = 'active';
    entry.notes.push({ at: formatInstant(now), by, action: 'activate' });
    this.#record('ACTIVATION', 'ALLOW', { ref, by, previous, observations: clean });
    return { ref, active: ref, previous };
  }

  /**
   * Roll a version back to its parent (or to a named version). Always available, always
   * recorded.
   * @param {{ref: string, by: string, reason: string, to?: string|null, now?: Date}} input
   */
  rollback({ ref, by, reason, to = null, now = new Date('1970-01-01T00:00:00Z') }) {
    const entry = this.#entry(ref);
    if (!this.activators.includes(by)) {
      throw new OmegaError('OMEGA_E_NOT_ACTIVATOR', `${by} may not roll versions back`, { allowed: this.activators });
    }
    const moduleEntry = this.#module(entry.manifest.module);
    const target = to ?? (entry.manifest.parent === null ? null : refOf(entry.manifest.module, entry.manifest.parent));
    if (target !== null && !moduleEntry.versions.has(target)) {
      throw new OmegaError('OMEGA_E_VERSION_UNKNOWN', `cannot roll back to ${target}: it is not in the registry`);
    }
    entry.state = 'quarantined';
    entry.notes.push({ at: formatInstant(now), by, action: 'rollback', reason });
    if (moduleEntry.active === ref) moduleEntry.active = target;
    if (target !== null) moduleEntry.versions.get(target).state = 'active';
    this.#record('ROLLBACK', 'DENY', { ref, by, reason, restored: target });
    return { ref, restored: target, state: entry.state };
  }

  /** @param {string} moduleName @returns {string|null} */
  active(moduleName) {
    return this.#module(moduleName).active;
  }

  /** @param {string} ref @returns {object} */
  state(ref) {
    const entry = this.#entry(ref);
    return {
      ref,
      state: entry.state,
      manifest: entry.manifest,
      observations: entry.observations.length,
      verdict: entry.verdict === null ? null : { verdict: entry.verdict.verdict, failed: entry.verdict.failed, action: entry.verdict.action },
      notes: entry.notes.map((note) => ({ ...note })),
    };
  }

  /** @returns {object[]} every version, sorted by module then version */
  history() {
    return [...this.#modules.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((moduleEntry) => [...moduleEntry.versions.values()]
        .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
        .map((entry) => ({
          ref: entry.ref,
          state: entry.state,
          active: moduleEntry.active === entry.ref,
          parent: entry.manifest === null || entry.manifest.parent === null
            ? null
            : refOf(entry.manifest.module, entry.manifest.parent),
          capabilities: entry.manifest?.capabilities ?? [],
          observations: entry.observations.length,
          verdict: entry.verdict?.verdict ?? null,
        })));
  }
}
