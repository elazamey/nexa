/**
 * @nexa/google-gateway — the trusted provider side of the Google organ.
 *
 * This package holds the things a *cell* must never hold: the pinned key sources, the token
 * vault, the quota discipline, the scope constant, the class ladder and the approval store. It
 * sits outside every membrane and hands the identity cell nothing but decisions.
 *
 * What it deliberately does not contain:
 *
 *   · **no authority** — `authorizeGoogleCall` calls a `verify` port the caller supplies; it
 *     never mints and never imports the authority;
 *   · **no network** — a key source takes an injected fetch port, and with none it uses what
 *     the host already validated. Nothing here imports `node:http`, `node:https` or `node:net`;
 *   · **no policy of its own about the owner** — the owner appears as the author of an
 *     approval, never as the subject of a capability.
 */
export {
  GOOGLE_SCOPE_TABLE,
  SCOPE_TABLE_FIELDS,
  phaseRows,
  scopeRows,
  narrowestScope,
  admitScope,
} from './src/scopes.js';
export {
  RISK_CLASSES,
  ROLE_CEILINGS,
  RECOVERY_OPERATIONS,
  GOOGLE_OPERATIONS,
  classRank,
  googleOperation,
  assertWithinCeiling,
} from './src/classes.js';
export { APPROVAL_FIELDS, operationDigest, createApprovalStore } from './src/approvals.js';
export {
  GOOGLE_KEY_SOURCES,
  validateJwks,
  publicKeyFromJwk,
  verifyRs256,
  createJwksSource,
} from './src/jwks.js';
export { createTokenVault } from './src/vault.js';
export { createLimiter, DEFAULT_LIMITS } from './src/limiter.js';
export { SECRET_PATTERNS, scanForSecretMaterial, payloadDigest } from './src/scan.js';
export { authorizeGoogleCall } from './src/authorize.js';
export { GOOGLE_SERVICE_CELLS, googleGrantTemplates, createGoogleCallPort } from './src/grants.js';
