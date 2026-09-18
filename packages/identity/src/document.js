/**
 * Identity documents.
 *
 * A NEXA identity is a self-signed statement: "this key id belongs to this label,
 * within this scope". The document is useless without the corresponding private
 * key, and it is self-verifying: no CA, no registry. Trust is a *local* decision,
 * made by the verifier's trust store — never claimed by the document itself.
 */
import { NexaError, canonicalBytes, formatInstant, parseInstant, validateSignature } from '../../ast/index.js';
import { KeyPair, publicKeyFromKeyId, rawFromKeyId, verifyBytes } from '../../crypto/index.js';

export const IDENTITY_DOMAIN = 'NEXA/0.1 identity document\u0000';
export const IDENTITY_FIELDS = Object.freeze([
  'nexa',
  'kid',
  'label',
  'kind',
  'scope',
  'created',
  'not_before',
  'not_after',
  'keys',
  'sig',
]);
export const IDENTITY_KINDS = Object.freeze(['operator', 'agent', 'service', 'peer']);

const LABEL_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._@:-]{0,63}$/u;
const SCOPE_PATTERN = /^[a-z][a-z0-9]*(:[a-z0-9._*-]+){0,4}$/;

/** @param {object} document @returns {Buffer} */
export function identityPayload(document) {
  const { sig, ...unsigned } = document; // eslint-disable-line no-unused-vars
  return Buffer.concat([Buffer.from(IDENTITY_DOMAIN, 'utf8'), canonicalBytes(unsigned)]);
}

/**
 * @param {{identity: {kid: string}, label: string, kind?: string, scope?: string,
 *          created?: string, not_before?: string, not_after?: string, keys: KeyPair}} input
 * @returns {object} signed identity document
 */
export function createIdentityDocument({
  identity,
  label,
  kind = 'operator',
  scope = 'nexa:local',
  created,
  not_before,
  not_after,
  keys,
}) {
  if (!(keys instanceof KeyPair)) {
    throw new NexaError('NEXA_E_KEY', 'identity documents must be signed by a KeyPair');
  }
  if (keys.kid !== identity.kid) {
    throw new NexaError('NEXA_E_IDENTITY', 'signing key does not match the identity key id');
  }
  const now = created ?? formatInstant(new Date());
  const document = {
    nexa: '0.1',
    kid: identity.kid,
    label,
    kind,
    scope,
    created: now,
    not_before: not_before ?? now,
    not_after: not_after ?? '2999-01-01T00:00:00Z',
    keys: [keys.toPublicKeyRecord()],
  };
  const sig = {
    alg: 'ed25519',
    kid: keys.kid,
    val: keys.sign(identityPayload(document)),
  };
  return { ...document, sig };
}

/**
 * Structural + cryptographic verification. Trust is NOT decided here.
 * @param {unknown} document
 * @returns {{ok: true, kid: string, label: string, kind: string, scope: string}} | never
 */
export function verifyIdentityDocument(document) {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new NexaError('NEXA_E_IDENTITY', 'identity document must be an object');
  }
  for (const key of Object.keys(document)) {
    if (!IDENTITY_FIELDS.includes(key)) {
      throw new NexaError('NEXA_E_IDENTITY', `unknown identity field: ${key}`);
    }
  }
  if (document.nexa !== '0.1') {
    throw new NexaError('NEXA_E_IDENTITY', `unsupported identity version: ${String(document.nexa)}`);
  }
  validateSignature(document.sig);
  if (document.sig.kid !== document.kid) {
    throw new NexaError('NEXA_E_IDENTITY', 'identity is not self-signed');
  }
  if (typeof document.label !== 'string' || !LABEL_PATTERN.test(document.label)) {
    throw new NexaError('NEXA_E_IDENTITY', `invalid label: ${String(document.label)}`);
  }
  if (!IDENTITY_KINDS.includes(document.kind)) {
    throw new NexaError('NEXA_E_IDENTITY', `invalid kind: ${String(document.kind)}`);
  }
  if (typeof document.scope !== 'string' || !SCOPE_PATTERN.test(document.scope)) {
    throw new NexaError('NEXA_E_IDENTITY', `invalid scope: ${String(document.scope)}`);
  }
  parseInstant(document.created);
  const notBefore = parseInstant(document.not_before);
  const notAfter = parseInstant(document.not_after);
  if (notAfter <= notBefore) {
    throw new NexaError('NEXA_E_IDENTITY', 'not_after must be after not_before');
  }
  if (!Array.isArray(document.keys) || document.keys.length === 0) {
    throw new NexaError('NEXA_E_IDENTITY', 'identity must publish at least one key');
  }
  for (const key of document.keys) {
    if (key.kid !== document.kid) {
      throw new NexaError('NEXA_E_IDENTITY', 'published key does not match the identity key id');
    }
    if (key.alg !== 'ed25519') {
      throw new NexaError('NEXA_E_SIG_ALG', `unsupported key algorithm: ${String(key.alg)}`);
    }
    const declared = Buffer.from(String(key.public_key), 'base64url');
    const derived = rawFromKeyId(key.kid);
    if (!declared.equals(derived)) {
      throw new NexaError('NEXA_E_IDENTITY', 'published key material does not match its key id');
    }
  }
  const valid = verifyBytes(
    publicKeyFromKeyId(document.kid),
    identityPayload(document),
    document.sig.val,
  );
  if (!valid) {
    throw new NexaError('NEXA_E_SIG', 'identity document signature is invalid');
  }
  return {
    ok: true,
    kid: document.kid,
    label: document.label,
    kind: document.kind,
    scope: document.scope,
  };
}
