/**
 * @nexa/evolution — proposals, immutable versions, the deterministic Evolution Gate,
 * canary windows, activation and rollback.
 *
 * Self-modifying is not self-authorizing: a candidate is data until the gate passes,
 * runs beside the active version rather than replacing it, and becomes active only on an
 * explicit call by an identity the registry was told to trust.
 */
export {
  OMEGA_MANIFEST_DOMAIN,
  OMEGA_SOURCE_DOMAIN,
  KERNEL_MODULES,
  manifestPayload,
  manifestHash,
  sourceHash,
  capabilitiesOf,
  parseRef,
  refOf,
  createManifest,
  signManifest,
  verifyManifest,
} from './src/manifest.js';
export { GATE_STAGES, STAGE_DEFAULTS, evaluateGate, describeVerdict } from './src/gate.js';
export {
  OMEGA_ADVERSARIAL_DOMAIN,
  ATTACK_CATEGORIES,
  MIN_ATTACKS,
  createAttack,
  runAttacks,
  summarizeAttacks,
  adversarialDigest,
} from './src/adversarial.js';
export { VERSION_STATES, VersionRegistry } from './src/registry.js';
