/**
 * The JWKS source — the only place a Google public key enters NEXA.
 *
 * Three rules, all of them structural:
 *
 *   · **pinned by issuer, not by configuration** — the URI for a Google issuer is a constant
 *     here. A caller supplies a *fetch port*, never a URL, so there is no configuration value
 *     that can redirect key material.
 *   · **untrusted until validated** — what the port returns is `UntrustedData`: a bag of JSON
 *     from the network. Only `validateJwks` promotes it, and it promotes into a frozen copy.
 *     A malformed set is a refusal, not a partial import.
 *   · **one refresh, then refuse** — an unknown `kid` triggers exactly one refresh and then a
 *     refusal. There is no retry loop and no "keep asking until it works".
 *
 * The fetch port is injected and may be `null`: with no port, the keys are whatever the host
 * placed in the cache (`seed`), which is how the whole identity path is exercised offline.
 */
import { createPublicKey, createVerify } from 'node:crypto';
import { fromBase64url } from '../../../../crypto/index.js';
import { OmegaError } from '../../../../compiler/index.js';

/** The provider's own key sources, pinned here by issuer. No configuration widens this map. */
export const GOOGLE_KEY_SOURCES = Object.freeze({
  gsi: Object.freeze({
    uri: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: Object.freeze(['accounts.google.com', 'https://accounts.google.com']),
    alg: 'RS256',
  }),
  // Deferred to G2 with the rest of the Firebase transport (§ A.2.2 of the spec): pinned for
  // the record, not reachable in v1.
  firebase: Object.freeze({
    uri: 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
    issuers: Object.freeze([]),
    alg: 'RS256',
    enabled: false,
  }),
});

const REQUIRED_JWK = Object.freeze(['kid', 'kty', 'n', 'e']);

/** @param {unknown} jwk @returns {Readonly<{kid: string, kty: string, n: string, e: string}>} */
function validateJwk(jwk) {
  if (typeof jwk !== 'object' || jwk === null) throw new OmegaError('OMEGA_E_IDENTITY_TOKEN', 'a JWK must be an object');
  for (const field of REQUIRED_JWK) {
    if (typeof jwk[field] !== 'string' || jwk[field].length === 0) {
      throw new OmegaError('OMEGA_E_IDENTITY_TOKEN', `a JWK is missing ${field}`, { field });
    }
  }
  if (jwk.kty !== 'RSA') throw new OmegaError('OMEGA_E_IDENTITY_TOKEN', `unsupported key type ${jwk.kty}; the identity path accepts RSA`, { kty: jwk.kty });
  if (jwk.alg !== undefined && jwk.alg !== 'RS256') throw new OmegaError('OMEGA_E_IDENTITY_TOKEN', `unsupported key algorithm ${jwk.alg}`, { alg: jwk.alg });
  if (jwk.use !== undefined && jwk.use !== 'sig') throw new OmegaError('OMEGA_E_IDENTITY_TOKEN', `a JWK with use=${jwk.use} is not a signing key`, { use: jwk.use });
  return Object.freeze({ kid: jwk.kid, kty: jwk.kty, alg: 'RS256', n: jwk.n, e: jwk.e });
}

/**
 * Promote network JSON to usable keys. This is the only promotion path, and it returns a
 * frozen value: a caller cannot mutate the store's view of the world after it was validated.
 * @param {unknown} raw
 * @returns {ReadonlyArray<Readonly<object>>}
 */
export function validateJwks(raw) {
  const body = raw?.value ?? raw;
  if (typeof body !== 'object' || body === null || !Array.isArray(body.keys)) {
    throw new OmegaError('OMEGA_E_IDENTITY_TOKEN', 'a JWKS must be an object with a keys array');
  }
  if (body.keys.length === 0) throw new OmegaError('OMEGA_E_IDENTITY_TOKEN', 'a JWKS with no keys can verify nothing');
  const seen = new Set();
  const keys = body.keys.map((jwk) => {
    const validated = validateJwk(jwk);
    if (seen.has(validated.kid)) throw new OmegaError('OMEGA_E_IDENTITY_TOKEN', `two keys share the kid ${validated.kid}`);
    seen.add(validated.kid);
    return validated;
  });
  return Object.freeze(keys);
}

/** @param {object} jwk @returns {import('node:crypto').KeyObject} */
export function publicKeyFromJwk(jwk) {
  try {
    return createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
  } catch (cause) {
    throw new OmegaError('OMEGA_E_IDENTITY_TOKEN', `a JWK could not be turned into a public key: ${cause.message}`);
  }
}

/**
 * RS256 verification over the JWS signing input.
 * @param {object} jwk @param {string} signingInput `header.payload` @param {string} signature base64url
 * @returns {boolean}
 */
export function verifyRs256(jwk, signingInput, signature) {
  let raw;
  try {
    raw = fromBase64url(signature);
  } catch {
    return false;
  }
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingInput);
    verifier.end();
    return verifier.verify(publicKeyFromJwk(jwk), raw);
  } catch {
    return false;
  }
}

/**
 * @param {object} input
 * @param {{fetch?: (uri: string) => unknown, seed?: unknown, clock: () => Date, ttlMs?: number, source?: string}} input
 *   `fetch` is the injected network port — the only way a byte of key material arrives, and it
 *   is optional. `seed` is what the host already has (an offline fixture, a pinned set).
 */
export function createJwksSource({ fetch = null, seed = null, clock, ttlMs = 300_000, source = 'gsi' }) {
  const pinned = GOOGLE_KEY_SOURCES[source];
  if (pinned === undefined) throw new OmegaError('OMEGA_E_IDENTITY_TOKEN', `no pinned key source named ${String(source)}`, { known: Object.keys(GOOGLE_KEY_SOURCES) });
  if (pinned.enabled === false) throw new OmegaError('OMEGA_E_IDENTITY_TOKEN', `the ${source} key source is pinned but disabled in v1`);

  let keys = [];
  let fetchedAt = null;
  let refreshes = 0;
  /** Kids the last refresh did not produce. Asking again must not fetch again: a caller in a
   *  loop would otherwise turn "one refresh, then refuse" into an unbounded retry. */
  const refused = new Set();
  if (seed !== null) {
    keys = validateJwks(seed);
    fetchedAt = clock();
  }

  const ingest = () => {
    if (fetch === null) return false;
    const raw = fetch(pinned.uri);
    // Untrusted input is validated before it is stored; a bad set does not replace a good one.
    const promoted = validateJwks(raw);
    keys = promoted;
    fetchedAt = clock();
    refreshes += 1;
    refused.clear(); // a new key set may well contain the kid that was missing a moment ago
    return true;
  };

  return {
    source,
    issuers: pinned.issuers,
    uri: pinned.uri,

    /**
     * Find a key by `kid`, refreshing **once** when it is unknown.
     * @param {string} kid
     * @returns {{ok: true, key: object, refreshed: boolean} | {ok: false, code: string, reason: string}}
     */
    keyFor(kid) {
      if (typeof kid !== 'string' || kid.length === 0) {
        return { ok: false, code: 'OMEGA_E_IDENTITY_TOKEN', reason: 'the token header carries no kid' };
      }
      const found = keys.find((key) => key.kid === kid);
      if (found !== undefined) return { ok: true, key: found, refreshed: false };
      if (refused.has(kid)) {
        return { ok: false, code: 'OMEGA_E_IDENTITY_TOKEN', reason: `unknown kid ${kid}, already refused once — a second refresh would be a retry loop` };
      }
      if (fetch === null) {
        return { ok: false, code: 'OMEGA_E_IDENTITY_TOKEN', reason: `unknown kid ${kid}, and no key source is wired to refresh from` };
      }
      try {
        ingest();
      } catch (cause) {
        return { ok: false, code: cause.code ?? 'OMEGA_E_IDENTITY_TOKEN', reason: cause.message };
      }
      const after = keys.find((key) => key.kid === kid);
      if (after === undefined) {
        refused.add(kid);
        return { ok: false, code: 'OMEGA_E_IDENTITY_TOKEN', reason: `unknown kid ${kid} after one refresh` };
      }
      return { ok: true, key: after, refreshed: true };
    },

    /** @returns {ReadonlyArray<Readonly<object>>} the validated keys currently held */
    keys() {
      return keys;
    },

    /** @returns {object} what may go in evidence: digests and counts, never key material */
    describe() {
      return { source, uri: pinned.uri, keys: keys.length, kids: keys.map((key) => key.kid), refreshes, refused_kids: [...refused], fetched_at: fetchedAt === null ? null : fetchedAt.toISOString().replace(/\.\d{3}Z$/, 'Z') };
    },
  };
}
