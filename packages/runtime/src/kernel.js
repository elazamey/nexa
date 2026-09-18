/**
 * The kernel host: a real NEXA v0.1 endpoint, plus the local resources Ω calls.
 *
 * Nothing here is new authority. The kernel is an `Endpoint` with a policy that allows
 * exactly the resources it hosts, a trust store that pins the agents it was told about,
 * and `capabilityIssuers` naming the operator — so a call it does not recognise is a
 * signed DENY with a receipt, exactly like any other NEXA peer.
 *
 * Three rules the host keeps:
 *
 *   · it never hosts a resource behind a closed gate (the gate table is the kernel's,
 *     and this layer does not get to reinterpret it);
 *   · every handler is pure with respect to the outside world: world reads, memory
 *     tiers, sanitizers and provider adapters are all in-process and deterministic;
 *   · a memory entry is a digest, never a payload.
 */
import { createIdentity } from '../../identity/index.js';
import { Endpoint } from '../../protocol/index.js';
import { Policy, checkGates, gatePosture } from '../../policy/index.js';
import { OmegaError } from '../../compiler/index.js';
import { Memory, MEMORY_TIER_NAMES } from './memory.js';
import { World } from './world.js';
import { ProviderRegistry, Vault } from './providers.js';

const SANITIZER_ACTIONS = Object.freeze(['redact', 'strip_markup', 'to_public']);
const DEFAULT_KERNEL_SEED = 'a0'.repeat(32);

/** @param {string} name @returns {string} */
const seedFor = (name) => {
  const bytes = Buffer.from(name, 'utf8').toString('hex');
  return (bytes + '0'.repeat(64)).slice(0, 64);
};

/**
 * @param {object} input
 * @param {{identity: object, document: object, keys: object, kid: string}} input.operator
 * @param {() => Date} [input.clock]
 * @param {{name: string, seed?: string}[]} [input.agents]
 * @param {{resource: string, actions?: string[], handler: Function}[]} [input.instruments]
 * @param {World} [input.world]
 * @param {Memory} [input.memory]
 * @param {ProviderRegistry} [input.providers]
 * @param {string} [input.kernelSeed]
 * @param {string[]} [input.capabilityIssuers]
 * @param {string} [input.label]
 */
export function createKernel({
  operator,
  clock = () => new Date(),
  agents = [],
  instruments = [],
  world = new World(),
  memory = new Memory(),
  providers = new ProviderRegistry(),
  kernelSeed = DEFAULT_KERNEL_SEED,
  capabilityIssuers = null,
  label = 'nexa-omega-kernel',
}) {
  if (operator?.keys === undefined) {
    throw new OmegaError('OMEGA_E_GRANT_MISSING', 'the kernel needs the operator identity (the authority)');
  }

  /** @type {Map<string, Map<string, Function>>} resource → action → handler */
  const handlers = new Map();
  const rules = [];

  let ruleSeq = 0;

  /**
   * The endpoint keys handlers by *resource*, so one resource with several actions gets
   * one dispatcher that reads the action off the signed envelope — never two competing
   * registrations where the last one silently wins.
   * @param {string} resource @param {string} action @param {Function} handler
   */
  const register = (resource, action, handler) => {
    const verdict = checkGates({ resource, action });
    if (!verdict.allowed) {
      // Not "we refuse to run it later" — a resource behind a gate is never hosted, so
      // it cannot be reached by accident, by a lenient policy, or by a new handler.
      throw new OmegaError('OMEGA_E_SCHEMA', `the kernel does not host ${resource}: ${verdict.reason}`, { gate: verdict.gate });
    }
    if (!handlers.has(resource)) handlers.set(resource, new Map());
    const byAction = handlers.get(resource);
    if (byAction.has(action)) {
      throw new OmegaError('OMEGA_E_DUPLICATE', `the kernel already hosts ${action} on ${resource}`);
    }
    byAction.set(action, handler);
    // Deterministic, pattern-legal rule ids: rules are evaluated in id order, so the
    // kernel's own surface is reproducible byte for byte.
    ruleSeq += 1;
    rules.push({
      id: `kernel-${String(ruleSeq).padStart(3, '0')}`,
      effect: 'ALLOW',
      resource,
      actions: [action],
      description: `kernel hosts ${action} on ${resource}`,
    });
  };

  // --- world model: an observation is capability-gated like everything else
  for (const key of world.keys()) {
    register(`world:${key}`, 'read', () => {
      const observed = world.observe(key);
      return { key: observed.key, present: observed.present, digest: observed.digest };
    });
  }

  // --- memory tiers
  for (const tier of MEMORY_TIER_NAMES) {
    register(`memory:${tier}`, 'store', ({ args }) => memory.write(tier, {
      name: String(args?.name ?? 'unnamed'),
      value_hash: String(args?.value_hash ?? ''),
      value_type: String(args?.value_type ?? 'unknown'),
      mission: String(args?.mission ?? '-'),
    }));
    register(`memory:${tier}`, 'read', () => memory.read(tier));
  }

  // --- sanitizers: deterministic, and the only local resources that may see a secret
  for (const action of SANITIZER_ACTIONS) {
    register(`sanitizer:${action}`, action, ({ args }) => {
      const payload = args ?? {};
      return {
        action,
        redacted: true,
        fields: Object.keys(payload).sort(),
        length: Object.values(payload).reduce((total, value) => total + (typeof value === 'string' ? value.length : 0), 0),
      };
    });
  }

  // --- secrets: a load returns a *handle* and a digest, never the material
  register('secrets:load', 'load', ({ args }) => {
    const name = String(args?.name ?? '');
    return providers.vault.resolve(`vault://${name}`);
  });

  // --- providers: the only place a credential is attached, and never to the result
  const providerNames = [...new Set([...providers.providers.map((provider) => provider.name), 'auto'])];
  for (const name of providerNames) {
    register(`model:${name}`, 'invoke', ({ args }) => {
      const payload = args?.prompt === undefined ? { ...args } : { prompt: args.prompt };
      const handle = args?.secret_handle?.handle;
      return providers.invoke({ provider: name, payload, handle });
    });
  }

  // --- host-provided instruments
  for (const instrument of instruments) {
    const actions = instrument.actions ?? ['call'];
    const action = actions[0] ?? 'call';
    if (typeof instrument.handler !== 'function') {
      throw new OmegaError('OMEGA_E_SCHEMA', `instrument ${instrument.resource} needs a handler`);
    }
    register(instrument.resource, action, instrument.handler);
  }

  const kernelIdentity = createIdentity({ label, kind: 'service', seed: kernelSeed });
  const endpoint = new Endpoint({
    identity: kernelIdentity,
    clock,
    policy: new Policy({ rules }),
    capabilityIssuers: capabilityIssuers ?? [operator.kid],
  });

  for (const [resource, byAction] of handlers) {
    endpoint.registerHandler(resource, ({ args, context }) => {
      const action = context?.envelope?.body?.action;
      const handler = byAction.get(action);
      if (handler === undefined) {
        throw new OmegaError('OMEGA_E_SCHEMA', `the kernel hosts no ${String(action)} on ${resource}`, {
          hosted: [...byAction.keys()].sort(),
        });
      }
      return handler({ args, context });
    });
  }

  // --- agents: one identity each, pinned as correspondents of the kernel
  const agentMap = new Map();
  for (const agent of agents) {
    const identity = createIdentity({
      label: `agent:${agent.name}`,
      kind: 'agent',
      seed: agent.seed ?? seedFor(`agent:${agent.name}`),
    });
    const agentEndpoint = new Endpoint({
      identity,
      clock,
      policy: Policy.denyAll(),
      capabilityIssuers: [],
    });
    agentEndpoint.trust.pin(kernelIdentity.document);
    agentEndpoint.trust.pin(operator.document);
    endpoint.trust.pin(identity.document);
    agentMap.set(agent.name, { ...identity, identity: identity.identity, name: agent.name, endpoint: agentEndpoint });
  }

  return {
    operator,
    endpoint,
    identity: kernelIdentity,
    agents: agentMap,
    memory,
    world,
    providers,
    /** @param {string} name @returns {object} */
    agent(name) {
      const found = agentMap.get(name);
      if (found === undefined) {
        throw new OmegaError('OMEGA_E_SCHEMA', `agent ${name} has no identity in this kernel`, { known: [...agentMap.keys()].sort() });
      }
      return found;
    },
    /** @param {string} name @param {object} identity */
    addAgent(name, identity) {
      if (agentMap.has(name)) throw new OmegaError('OMEGA_E_DUPLICATE', `agent ${name} is already provisioned`);
      const agentEndpoint = new Endpoint({ identity, clock, policy: Policy.denyAll(), capabilityIssuers: [] });
      agentEndpoint.trust.pin(kernelIdentity.document);
      agentEndpoint.trust.pin(operator.document);
      endpoint.trust.pin(identity.document);
      agentMap.set(name, { ...identity, name, endpoint: agentEndpoint });
      return agentMap.get(name);
    },
    /** @returns {object} */
    describe() {
      return {
        kid: endpoint.kid,
        label,
        hosted: endpoint.resources(),
        agents: [...agentMap.keys()].sort(),
        world: world.summary(),
        memory: memory.summary(),
        providers: providers.describe(),
        gates: gatePosture(),
        evidence_length: endpoint.evidence.length,
        capability_issuers: [...endpoint.capabilityIssuers],
      };
    },
  };
}

export { Memory, World, ProviderRegistry, Vault };
