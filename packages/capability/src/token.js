/**
 * Capability tokens (macaroon-style, but stateless and verifiable offline).
 *
 * A token says: "issuer grants subject these actions on this resource, under these
 * caveats". Caveats can only ever get *tighter* down a delegation chain — the
 * algorithm for that is in `attenuation.js` and it is the security core of NEXA.
 */
import {
  NexaError,
  canonicalBytes,
  formatInstant,
  parseInstant,
  validateSignature,
  assertCapabilityId,
  assertKid,
  assertResource,
  assertAction,
  CAPABILITY_ID_PATTERN,
} from '../../ast/index.js';
import { KeyPair, publicKeyFromKeyId, randomId, sha256Multihash, verifyBytes } from '../../crypto/index.js';

export const CAPABILITY_DOMAIN = 'NEXA/0.1 capability\u0000';
export const DELEGATION_DOMAIN = 'NEXA/0.1 capability delegation\u0000';
export const REVOCATION_DOMAIN = 'NEXA/0.1 capability revocation\u0000';

export const CAVEAT_FIELDS = Object.freeze(['exp', 'nbf', 'max_uses', 'max_depth']);
export const CONSTRAINT_VALUE_TYPES = Object.freeze(['number', 'string', 'array']);

const MAX_LIFETIME_SECONDS = 24 * 60 * 60; // v0.1: no capability lives longer than a day
const MAX_USES_LIMIT = 10_000;
const MAX_DEPTH_LIMIT = 8;

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** @param {string} value @returns {string} */
export function capabilityId(value = randomId('urn:nexa:cap:')) {
  assertCapabilityId(value);
  return value;
}

/** @param {object} token @returns {Buffer} bytes covered by the issuer signature (excludes proof) */
export function capabilityPayload(token) {
  const { proof, ...unsigned } = token; // eslint-disable-line no-unused-vars
  return Buffer.concat([Buffer.from(CAPABILITY_DOMAIN, 'utf8'), canonicalBytes(unsigned)]);
}

/** @param {object} token @returns {Buffer} bytes covered by a delegator signature */
export function delegationPayload(child, parent) {
  const { proof, ...unsignedChild } = child; // eslint-disable-line no-unused-vars
  return Buffer.concat([
    Buffer.from(DELEGATION_DOMAIN, 'utf8'),
    canonicalBytes(unsignedChild),
    canonicalBytes({ parent_hash: sha256Multihash(canonicalBytes(parent)) }),
  ]);
}

/** @param {object} caveats @returns {object} validated caveats */
export function normalizeCaveats(caveats = {}, { now } = {}) {
  if (!isPlainObject(caveats)) {
    throw new NexaError('NEXA_E_CAP_INVALID', 'caveats must be a plain object');
  }
  for (const key of Object.keys(caveats)) {
    if (!CAVEAT_FIELDS.includes(key)) {
      throw new NexaError('NEXA_E_CAP_INVALID', `unknown caveat: ${key}`);
    }
  }
  const base = now ?? new Date();
  const nbf = caveats.nbf ?? formatInstant(base);
  const exp = caveats.exp ?? formatInstant(new Date(parseInstant(nbf) + MAX_LIFETIME_SECONDS * 1000));
  const nbfMs = parseInstant(nbf);
  const expMs = parseInstant(exp);
  if (expMs <= nbfMs) {
    throw new NexaError('NEXA_E_CAP_INVALID', 'caveat exp must be after nbf');
  }
  if ((expMs - nbfMs) / 1000 > MAX_LIFETIME_SECONDS) {
    throw new NexaError('NEXA_E_TTL', 'capability lifetime exceeds the 24h v0.1 maximum');
  }
  const maxUses = caveats.max_uses ?? 1;
  if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > MAX_USES_LIMIT) {
    throw new NexaError('NEXA_E_CAP_INVALID', `max_uses must be an integer in 1..${MAX_USES_LIMIT}`);
  }
  const maxDepth = caveats.max_depth ?? 0;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_DEPTH_LIMIT) {
    throw new NexaError('NEXA_E_CAP_INVALID', `max_depth must be an integer in 0..${MAX_DEPTH_LIMIT}`);
  }
  return { exp, nbf, max_uses: maxUses, max_depth: maxDepth };
}

/** @param {object} constraints @returns {object} validated, sorted constraints */
export function normalizeConstraints(constraints = {}) {
  if (!isPlainObject(constraints)) {
    throw new NexaError('NEXA_E_CAP_INVALID', 'constraints must be a plain object');
  }
  const out = {};
  for (const key of Object.keys(constraints).sort()) {
    if (!/^[a-z][a-z0-9._]{0,63}$/.test(key)) {
      throw new NexaError('NEXA_E_CAP_INVALID', `invalid constraint name: ${key}`);
    }
    const value = constraints[key];
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new NexaError('NEXA_E_CAP_INVALID', `constraint ${key} must be a non-negative safe integer`);
      }
      out[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > 256) {
        throw new NexaError('NEXA_E_CAP_INVALID', `constraint ${key} is too long`);
      }
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0 || value.length > 64) {
        throw new NexaError('NEXA_E_CAP_INVALID', `constraint ${key} must list 1..64 values`);
      }
      const seen = new Set();
      for (const item of value) {
        if (typeof item !== 'string' || item.length === 0 || item.length > 256) {
          throw new NexaError('NEXA_E_CAP_INVALID', `constraint ${key} values must be short strings`);
        }
        seen.add(item);
      }
      out[key] = [...seen].sort();
      continue;
    }
    throw new NexaError(
      'NEXA_E_CAP_INVALID',
      `constraint ${key} must be a number, string, or string array`,
    );
  }
  return out;
}

/**
 * Mints a root capability. Only the issuer's key can create authority;
 * nothing else in NEXA can.
 * @param {object} input
 * @param {{keys: KeyPair, kid: string}} input.issuer
 * @param {string} input.subject
 * @param {string} input.resource
 * @param {string[]} input.actions
 * @param {object} [input.caveats]
 * @param {object} [input.constraints]
 * @param {string} [input.id]
 * @param {Date} [input.now]
 * @param {string} [input.note]
 * @returns {object} signed capability token
 */
export function mintCapability({
  issuer,
  subject,
  resource,
  actions,
  caveats,
  constraints,
  id,
  now,
  note,
}) {
  if (!(issuer?.keys instanceof KeyPair)) {
    throw new NexaError('NEXA_E_KEY', 'issuer must carry a KeyPair');
  }
  assertKid(subject);
  assertResource(resource);
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new NexaError('NEXA_E_CAP_INVALID', 'actions must be a non-empty array');
  }
  for (const action of actions) assertAction(action);
  const uniqueActions = [...new Set(actions)].sort();
  if (uniqueActions.length !== actions.length) {
    throw new NexaError('NEXA_E_CAP_INVALID', 'actions must not repeat');
  }
  const token = {
    nexa: '0.1',
    id: capabilityId(id),
    issuer: issuer.kid,
    subject,
    resource,
    actions: uniqueActions,
    caveats: normalizeCaveats(caveats, { now }),
    constraints: normalizeConstraints(constraints),
    ...(note === undefined ? {} : { note }),
  };
  const proof = {
    kind: 'ed25519',
    parent: null,
    alg: 'ed25519',
    kid: issuer.kid,
    val: issuer.keys.sign(capabilityPayload(token)),
  };
  return { ...token, proof };
}

/**
 * Structural validation only — signatures, time and chain are checked in
 * `attenuation.js#verifyCapability`.
 * @param {unknown} token
 * @returns {object} the token
 */
export function validateCapabilityShape(token) {
  if (!isPlainObject(token)) {
    throw new NexaError('NEXA_E_CAP_INVALID', 'capability must be a plain object');
  }
  const allowed = ['nexa', 'id', 'issuer', 'subject', 'resource', 'actions', 'caveats', 'constraints', 'note', 'proof'];
  for (const key of Object.keys(token)) {
    if (!allowed.includes(key)) {
      throw new NexaError('NEXA_E_CAP_INVALID', `unknown capability field: ${key}`);
    }
  }
  if (token.nexa !== '0.1') {
    throw new NexaError('NEXA_E_CAP_INVALID', `unsupported capability version: ${String(token.nexa)}`);
  }
  assertCapabilityId(token.id);
  assertKid(token.issuer);
  assertKid(token.subject);
  assertResource(token.resource);
  if (!Array.isArray(token.actions) || token.actions.length === 0) {
    throw new NexaError('NEXA_E_CAP_INVALID', 'actions must be a non-empty array');
  }
  for (const action of token.actions) assertAction(action);
  if (!isPlainObject(token.caveats)) {
    throw new NexaError('NEXA_E_CAP_INVALID', 'caveats must be a plain object');
  }
  for (const key of Object.keys(token.caveats)) {
    if (!CAVEAT_FIELDS.includes(key)) {
      throw new NexaError('NEXA_E_CAP_INVALID', `unknown caveat: ${key}`);
    }
  }
  for (const key of CAVEAT_FIELDS) {
    if (key === 'max_depth') continue;
    if (!Object.hasOwn(token.caveats, key)) {
      throw new NexaError('NEXA_E_CAP_INVALID', `missing required caveat: ${key}`);
    }
  }
  parseInstant(token.caveats.nbf);
  parseInstant(token.caveats.exp);
  if (!Number.isSafeInteger(token.caveats.max_uses) || token.caveats.max_uses < 1) {
    throw new NexaError('NEXA_E_CAP_INVALID', 'max_uses must be a positive integer');
  }
  const depth = token.caveats.max_depth ?? 0;
  if (!Number.isSafeInteger(depth) || depth < 0) {
    throw new NexaError('NEXA_E_CAP_INVALID', 'max_depth must be a non-negative integer');
  }
  if (token.caveats.max_depth === undefined) token.caveats.max_depth = 0;
  normalizeConstraints(token.constraints ?? {});
  if (!isPlainObject(token.proof)) {
    throw new NexaError('NEXA_E_CAP_INVALID', 'proof must be an object');
  }
  if (token.proof.kind === 'ed25519') {
    if (token.proof.parent !== null) {
      throw new NexaError('NEXA_E_CAP_INVALID', 'a root capability cannot have a parent');
    }
    validateSignature({ alg: token.proof.alg, kid: token.proof.kid, val: token.proof.val });
    if (token.proof.kid !== token.issuer) {
      throw new NexaError('NEXA_E_SIG', 'a root capability must be signed by its issuer');
    }
  } else if (token.proof.kind === 'chain') {
    if (!isPlainObject(token.proof.parent)) {
      throw new NexaError('NEXA_E_CAP_INVALID', 'a delegated capability must embed its parent');
    }
    validateSignature({ alg: token.proof.alg, kid: token.proof.kid, val: token.proof.val });
  } else {
    throw new NexaError('NEXA_E_CAP_INVALID', `unknown proof kind: ${String(token.proof.kind)}`);
  }
  canonicalBytes(token);
  return token;
}

/** @param {object} token @returns {string} capability id */
export function capabilityIdOf(token) {
  if (!CAPABILITY_ID_PATTERN.test(token?.id ?? '')) {
    throw new NexaError('NEXA_E_CAP_INVALID', 'token has no valid capability id');
  }
  return token.id;
}

/** @param {object} token @returns {object} minimal, log-safe projection */
export function summarizeCapability(token) {
  return {
    id: token.id,
    issuer: token.issuer,
    subject: token.subject,
    resource: token.resource,
    actions: [...token.actions],
    caveats: { ...token.caveats },
    depth: capabilityDepth(token),
  };
}

/** @param {object} token @returns {number} chain length (root = 0) */
export function capabilityDepth(token) {
  let depth = 0;
  let cursor = token;
  while (cursor.proof.kind === 'chain') {
    depth += 1;
    cursor = cursor.proof.parent;
    if (depth > MAX_DEPTH_LIMIT + 1) {
      throw new NexaError('NEXA_E_CAP_INVALID', 'capability chain is too deep');
    }
  }
  return depth;
}

/** @param {object} token @returns {string[]} every id in the chain, child first */
export function capabilityChainIds(token) {
  const ids = [];
  let cursor = token;
  for (;;) {
    ids.push(cursor.id);
    if (cursor.proof.kind !== 'chain') break;
    cursor = cursor.proof.parent;
  }
  return ids;
}

export { publicKeyFromKeyId, verifyBytes };
