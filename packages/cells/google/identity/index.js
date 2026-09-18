/**
 * @nexa/google-identity — the Google Identity Cell.
 *
 * An **external organ** of the NEXA organism: a cell, in a tissue, behind a membrane, with a
 * nucleus, an identity of its own and no authority whatsoever. Google is the identity provider;
 * NEXA decides authority, and nothing in this package can mint, widen or delegate a capability.
 *
 * The whole phase in one line:
 *
 *     Google proves who you are.        NEXA decides what you can do.
 */
export {
  SUBJECT_DOMAIN,
  EMAIL_DOMAIN,
  NONCE_DOMAIN,
  AUDIENCE_DOMAIN,
  subHash,
  emailHash,
  challengeId,
  audienceHash,
} from './src/domains.js';
export { createNonceStore } from './src/nonces.js';
export { verifyIdToken, MAX_TOKEN_BYTES } from './src/verify.js';
export { GOOGLE_EVIDENCE_KINDS, createRecorder } from './src/recorder.js';
export {
  BINDING_DOMAIN,
  BINDING_FIELDS,
  BINDING_METHODS,
  BINDING_ROLES,
  BREAK_GLASS_MAX_MS,
  bindingPayload,
  assertBreakGlassShape,
  createBindingRecord,
  verifyBinding,
  createBindingRegistry,
} from './src/bindings.js';
export { IDENTITY_NUCLEUS, VERIFICATION_STEPS, verificationStep, buildGoogleIdentityTissue } from './src/tissue.js';
