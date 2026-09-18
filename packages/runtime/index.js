/**
 * @nexa/runtime — the NEXA Ω runtime.
 *
 * The mission machine, the kernel host, the authority, memory, the world model,
 * providers and the circuit breaker. No I/O: every port (clock, world, memory,
 * providers, planner) is injected, so a run is reproducible and a test needs nothing
 * but the module it compiles.
 */
export {
  OMEGA_EVIDENCE_DOMAIN,
  OMEGA_GENESIS_PREV,
  OMEGA_EVIDENCE_KINDS,
  OMEGA_DECISIONS,
  OmegaLedger,
  omegaRecordPayload,
  computeOmegaHash,
  validateOmegaRecord,
  verifyOmegaChain,
  assertOmegaChain,
} from './src/ledger.js';
export { MEMORY_TIER_NAMES, Memory } from './src/memory.js';
export { World } from './src/world.js';
export { Vault, ProviderRegistry, DEFAULT_ADAPTERS } from './src/providers.js';
export { CircuitBreaker } from './src/breaker.js';
export { SelfHealer, HEAL_PHASES, HEAL_ACTIONS, classify } from './src/healer.js';
export { Authority, MAX_TOKEN_TTL_MS, DEFAULT_MAX_ARGS_BYTES } from './src/authority.js';
export { createKernel } from './src/kernel.js';
export { Runtime } from './src/machine.js';
export { openSession } from './src/session.js';
