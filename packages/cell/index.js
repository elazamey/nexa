/**
 * @nexa/cell — the Cellular Layer of NEXA Ω∞.
 *
 * Cell → Tissue → Organ → Organism, recursively: an organ is a cell at the next level.
 *
 * The layer sits *above* the Ω foundations and borrows them instead of duplicating them:
 * the compiler's error codes, the runtime's circuit breaker, the capability layer's
 * verification, the evidence ledger, the evolution gate. Nothing in this package mints a
 * capability on its own, and nothing in it is kernel.
 *
 * Wire order, without exception:
 *
 *   Cell A → Membrane → Identity → Capability → Type/Schema → Policy → Budget → Execution → Evidence → Cell B
 */
export { createCell, CELL_KINDS, validateNucleus, KERNEL_MODULE_NAMES } from './src/cell.js';
export { createMembrane, MEMBRANE_STEPS, LIFE_SUPPORT } from './src/membrane.js';
export {
  CELL_STATES,
  SERVING_STATES,
  DIAGNOSTIC_STATES,
  TRANSITIONS,
  transition,
} from './src/lifecycle.js';
export { Health, HEALTH_STATES } from './src/health.js';
export { createGuarantor, CELL_RESOURCE, routeName } from './src/guarantor.js';
export { createTissue, seedFor } from './src/tissue.js';
export { createOrgan } from './src/organ.js';
export { createOrganism, SYSTEM_STATES } from './src/organism.js';
export { createHomeostat, DEFAULT_HOMEOSTASIS } from './src/homeostasis.js';
export { buildCodingOrganism } from './src/examples.js';
