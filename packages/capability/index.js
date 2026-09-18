/**
 * @nexa/capability — mint, delegate (attenuate), verify, revoke.
 */
export {
  CAPABILITY_DOMAIN,
  DELEGATION_DOMAIN,
  REVOCATION_DOMAIN,
  CAVEAT_FIELDS,
  CONSTRAINT_VALUE_TYPES,
  capabilityId,
  capabilityPayload,
  delegationPayload,
  normalizeCaveats,
  normalizeConstraints,
  mintCapability,
  validateCapabilityShape,
  capabilityIdOf,
  summarizeCapability,
  capabilityDepth,
  capabilityChainIds,
} from './src/token.js';
export {
  isResourceSubset,
  areActionsSubset,
  isConstraintSubset,
  attenuate,
  verifyCapability,
} from './src/attenuation.js';
export {
  REVOCATION_FIELDS,
  revocationPayload,
  createRevocation,
  verifyRevocation,
  RevocationSet,
} from './src/revocation.js';
