/**
 * @nexa/ast — NEXA data model.
 * No dependencies, no I/O, no clock: pure structure + canonical form.
 */
export { NexaError, ERROR_CODES, asNexaError } from './src/errors.js';
export { canonicalize, canonicalBytes, parseCanonical } from './src/canonical.js';
export { parseInstant, formatInstant, addSeconds, compareInstant } from './src/time.js';
export {
  NEXA_VERSION,
  ENVELOPE_SIGNATURE_DOMAIN,
  MESSAGE_TYPES,
  ENVELOPE_FIELDS,
  REQUIRED_ENVELOPE_FIELDS,
  KID_PATTERN,
  MESSAGE_ID_PATTERN,
  CAPABILITY_ID_PATTERN,
  NONCE_PATTERN,
  RESOURCE_PATTERN,
  ACTION_PATTERN,
  assertKid,
  assertMessageId,
  assertCapabilityId,
  assertNonce,
  assertResource,
  assertAction,
  validateSignature,
  validateEnvelope,
  signaturePayload,
  isCall,
  isDenial,
} from './src/schema.js';
export { buildUnsignedMessage } from './src/message.js';
