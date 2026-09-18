/**
 * The cell — the unit of composition.
 *
 * Identity, Nucleus, Membrane, Receptors, Ports, Local Memory, Capabilities (as proposals
 * it cannot mint), Policy, Budget, Health, Lifecycle, Evidence, Version.
 *
 * Two things a cell cannot be given, by construction:
 *
 *   · **an authority** — the membrane verifies through a port; there is no minting here;
 *   · **another cell** — cells are reached through a tissue, never imported.
 *
 * The nucleus is a plain frozen value. No method of this object writes to it, which is the
 * mechanical meaning of "the nucleus is not on the self-modifying surface".
 */
import { OmegaError } from '../../compiler/index.js';
import { Health } from './health.js';
import { CELL_STATES, DIAGNOSTIC_STATES, SERVING_STATES, TRANSITIONS, transition } from './lifecycle.js';
import { createMembrane } from './membrane.js';

export const CELL_KINDS = Object.freeze(['agent', 'service', 'composite', 'identity']);

/** Nuclei of the six kernel modules can never be a cell: the kernel is not programmable. */
export const KERNEL_MODULE_NAMES = Object.freeze(['kernel', 'verifier', 'policy-engine', 'capability-authority', 'omega-kernel', 'evidence-ledger']);

/**
 * @param {{module: string, invariants?: string[]}} nucleus
 * @returns {object} the validated nucleus
 */
export function validateNucleus(nucleus) {
  if (typeof nucleus !== 'object' || nucleus === null) {
    throw new OmegaError('OMEGA_E_SCHEMA', 'a cell needs a nucleus: the invariants it may not change');
  }
  if (typeof nucleus.module !== 'string' || !/^[a-z][a-z0-9._-]*@[1-9][0-9]*$/.test(nucleus.module)) {
    throw new OmegaError('OMEGA_E_SCHEMA', 'a nucleus names its module and version, e.g. planner@1');
  }
  if (KERNEL_MODULE_NAMES.includes(nucleus.module.split('@')[0])) {
    throw new OmegaError('OMEGA_E_KERNEL_IMMUTABLE', `${nucleus.module} is kernel: the kernel is immutable by construction`);
  }
  const invariants = nucleus.invariants ?? [];
  if (!Array.isArray(invariants) || invariants.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new OmegaError('OMEGA_E_SCHEMA', 'nucleus invariants are non-empty strings');
  }
  return Object.freeze({ module: nucleus.module, invariants: Object.freeze([...invariants].sort()) });
}

/**
 * @param {object} input
 * @param {string} input.name
 * @param {string} [input.kind]
 * @param {object} input.identity a `createIdentity()` result, created by the host
 * @param {{module: string, invariants?: string[]}} input.nucleus
 * @param {Record<string, {handler: Function, accepts?: string[]|null, requires?: string[], description?: string}>} input.receptors
 * @param {{max_payload_bytes?: number, max_calls?: number, max_failures?: number}} [input.budget]
 * @param {{verify: Function, record: Function}} input.port wired by the tissue to the authority
 * @param {{store: Function, load: Function}} [input.memory] local memory: digests, not values
 * @param {() => Date} [input.clock]
 */
export function createCell({
  name,
  kind = 'agent',
  identity,
  nucleus,
  receptors = {},
  budget = {},
  port,
  memory = null,
  clock = () => new Date(),
}) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(name)) {
    throw new OmegaError('OMEGA_E_SCHEMA', 'a cell name is a lowercase identifier');
  }
  if (!CELL_KINDS.includes(kind)) {
    throw new OmegaError('OMEGA_E_SCHEMA', `unknown cell kind: ${kind}`, { known: [...CELL_KINDS] });
  }
  if (typeof identity?.kid !== 'string') {
    throw new OmegaError('OMEGA_E_IDENTITY', 'a cell needs an identity the host created for it');
  }
  for (const [receptor, definition] of Object.entries(receptors)) {
    if (typeof definition?.handler !== 'function') {
      throw new OmegaError('OMEGA_E_RECEPTOR', `receptor ${name}.${receptor} needs a handler`);
    }
  }

  const nucleusValue = validateNucleus(nucleus);
  const health = new Health({ threshold: budget.max_failures ?? 3, clock });
  const localMemory = memory ?? { store: (key) => key, load: () => null };
  let state = 'DEFINED';
  let degradeCode = null;
  let retiredAt = null;

  const setState = (to) => {
    state = transition(state, to);
    return state;
  };

  const membrane = createMembrane({
    self: { name, kid: identity.kid, kind },
    receptors,
    port,
    budget,
    health,
    clock,
    lifecycle: {
      state: () => state,
      degrade: (code) => {
        degradeCode = code;
        if (state === 'ACTIVE') state = transition(state, 'DEGRADED');
      },
    },
  });

  const cell = {
    name,
    kind,
    kid: identity.kid,
    identity,
    nucleus: nucleusValue,
    receptors: Object.keys(receptors).sort(),

    /** @returns {string} the lifecycle state */
    get state() {
      return state;
    },

    /**
     * A cell proposes; the tissue asks the authority. There is no `issue()` here, and
     * adding one would make this object an authority, which is the one thing a cell may
     * never be.
     * @param {{to: string, receptor: string, payload?: object}} intent
     * @returns {object} an inert proposal
     */
    propose({ to, receptor, payload = {} }) {
      if (typeof to !== 'string' || typeof receptor !== 'string') {
        throw new OmegaError('OMEGA_E_MEMBRANE', 'a proposal names a target cell and a receptor');
      }
      return { kind: 'CellProposal', from: name, to, receptor, payload };
    },

    /** @param {object} message @returns {object} the membrane's verdict */
    receive(message) {
      return membrane.receive(message);
    },

    /** @param {object} input @returns {object} the membrane's verdict, recorded either way */
    call(input) {
      return membrane.receive(input);
    },

    /**
     * `state` is the lifecycle; `health_state` is what the breaker thinks. They are not the
     * same question, and collapsing them once already produced an organism that reported
     * itself healthy while a cell was down.
     * @returns {object}
     */
    metrics() {
      const body = health.metrics(`cell:${name}`);
      return { ...body, cell: name, state, health_state: body.state, degrade_code: degradeCode };
    },

    /** @returns {object} the cell as data — the form that goes in evidence */
    describe() {
      return {
        name,
        kind,
        kid: identity.kid,
        state,
        nucleus: { module: nucleusValue.module, invariants: [...nucleusValue.invariants] },
        receptors: Object.keys(receptors).sort(),
        budget: membrane.budget,
        steps: membrane.steps,
        memory_entries: typeof localMemory.size === 'function' ? localMemory.size() : null,
      };
    },

    /** Local memory, exposed as digests. `store` refuses anything that is not a string. */
    memory: {
      store(key, digest) {
        return localMemory.store(key, digest);
      },
      load(key) {
        return localMemory.load(key);
      },
    },

    activate() {
      if (state === 'DEFINED') setState('READY');
      setState('ACTIVE');
      return state;
    },

    /** @param {string} code @returns {string} */
    degrade(code = 'OMEGA_E_HANDLER') {
      degradeCode = code;
      if (state === 'ACTIVE') setState('DEGRADED');
      return state;
    },

    isolate() {
      if (state !== 'ISOLATED') setState('ISOLATED');
      return state;
    },

    /**
     * Recovery is verified, not assumed: `recover()` is the only path from ISOLATED or
     * DEGRADED back to serving, and it requires a passed check.
     * @param {{check?: () => boolean}} [input]
     */
    recover({ check = () => true } = {}) {
      if (typeof check !== 'function') throw new OmegaError('OMEGA_E_SCHEMA', 'recover() takes a check function');
      // Only an isolated or degraded cell can be recovered. A retired cell is not "recovered"
      // by anything, and reporting success for a state change that never happened would make
      // the recovery record lie.
      if (state !== 'ISOLATED' && state !== 'DEGRADED') return { state, recovered: false, reason: `${name} is ${state}` };
      if (check() !== true) return { state, recovered: false, reason: 'the verification did not pass' };
      health.clear();
      degradeCode = null;
      if (state === 'ISOLATED') setState('READY');
      if (state === 'READY' || state === 'DEGRADED') setState('ACTIVE');
      return { state, recovered: true };
    },

    retire() {
      setState('RETIRED');
      retiredAt = clock().toISOString();
      return state;
    },

    /** @returns {object} the version history: a cell is immutable, changes are new versions */
    version() {
      return { module: nucleusValue.module, state, retired_at: retiredAt };
    },
  };

  return cell;
}

export { CELL_STATES, DIAGNOSTIC_STATES, SERVING_STATES, TRANSITIONS };
