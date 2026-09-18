/**
 * `openSession` — wiring a compiled module to a kernel, an authority and a runtime.
 *
 * This is the only place the pieces are joined, and it is deliberately explicit: the
 * operator (who may mint), the agents (who may act), the instruments (what the kernel
 * hosts), the world (what may be observed), the memory (what may be remembered) and the
 * providers (where a model call would go) are all parameters of the session, not
 * defaults hidden inside the language.
 */
import { Memory } from './memory.js';
import { World } from './world.js';
import { ProviderRegistry, Vault } from './providers.js';
import { CircuitBreaker } from './breaker.js';
import { SelfHealer } from './healer.js';
import { Authority } from './authority.js';
import { createKernel } from './kernel.js';
import { Runtime } from './machine.js';
import { OmegaError } from '../../compiler/index.js';

/**
 * @param {object} input
 * @param {object} input.compiled the result of `compile()` (must be ok)
 * @param {{identity: object, document: object, keys: object, kid: string}} input.operator
 * @param {() => Date} [input.clock]
 * @param {{name: string, seed?: string}[]} [input.agents]
 * @param {{resource: string, actions?: string[], handler: Function}[]} [input.instruments]
 * @param {World} [input.world]
 * @param {Memory} [input.memory]
 * @param {ProviderRegistry} [input.providers]
 * @param {Vault} [input.vault]
 * @param {Record<string, boolean>|Function} [input.approvals]
 * @param {Function|null} [input.planner]
 * @param {CircuitBreaker} [input.breaker]
 * @param {SelfHealer} [input.healer] when omitted, a healer over the breaker is used
 * @param {string} [input.kernelSeed]
 */
export function openSession({
  compiled,
  operator,
  clock = () => new Date(),
  agents = [],
  instruments = [],
  world = new World(),
  memory = new Memory(),
  providers = null,
  vault = null,
  approvals = {},
  planner = null,
  breaker = null,
  healer = null,
  kernelSeed = undefined,
}) {
  if (compiled === undefined || compiled.ok !== true || compiled.ir === null) {
    throw new OmegaError('OMEGA_E_SCHEMA', 'openSession needs a successful compile() result');
  }
  const ir = compiled.ir;
  const effectiveAgents = agents.length > 0 ? agents : ir.agents.map((agent) => ({ name: agent.name }));
  const effectiveProviders = providers ?? new ProviderRegistry({
    providers: ir.providers,
    ...(vault === null ? {} : { vault }),
  });
  const authority = new Authority({ operator, grants: ir.grants, clock, approvals });
  const kernel = createKernel({
    operator,
    clock,
    agents: effectiveAgents,
    instruments,
    world,
    memory,
    providers: effectiveProviders,
    ...(kernelSeed === undefined ? {} : { kernelSeed }),
  });
  const effectiveBreaker = breaker ?? new CircuitBreaker({ clock });
  const effectiveHealer = healer ?? new SelfHealer({ breaker: effectiveBreaker, clock });
  const runtime = new Runtime({
    ir,
    kernel,
    authority,
    clock,
    planner,
    breaker: effectiveBreaker,
    healer: effectiveHealer,
    moduleHash: compiled.hash,
  });
  return { kernel, authority, runtime, providers: effectiveProviders, memory, world, ir, healer: effectiveHealer };
}
