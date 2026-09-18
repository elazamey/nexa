/**
 * The verification order, in code, once.
 *
 *     shape → signature → issuer → audience → window → nonce → subject → email
 *
 * Every step is fail-closed: a missing claim is a refusal, not a default. The order is part of
 * the contract because it decides *what a caller learns*: a forged signature is refused at step
 * 2, before anyone looks at an issuer or an audience, and a token that never carried a nonce
 * never gets as far as naming a subject.
 *
 * What is deliberately absent: any fallback. There is no "accept if the issuer matches the
 * prefix", no "skip the audience check in development", no caller-supplied switch that makes a
 * step optional. A failure at any step ends verification for that token.
 *
 * The token never leaves this function. What leaves is a `Principal` (§ A.4): it carries no
 * capability, no role and no token — only the hashed subject, the session's display email, the
 * spent challenge id and the claims that were checked.
 */
import { fromBase64url } from '../../../../crypto/index.js';
import { OmegaError } from '../../../../compiler/index.js';
import { GOOGLE_KEY_SOURCES, verifyRs256 } from '../../gateway/index.js';
import { audienceHash, subHash } from './domains.js';

/** The maximum size of a token this path will look at. A megabyte of JWT is an attack. */
export const MAX_TOKEN_BYTES = 16_384;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Thrown by a step; never escapes this module. */
class Refusal extends Error {
  constructor(step, reason, code = 'OMEGA_E_IDENTITY_TOKEN', detail = {}) {
    super(reason);
    this.step = step;
    this.code = code;
    this.detail = detail;
  }
}

/** @param {string} segment @param {string} what @returns {object} */
function decodeSegment(segment, what) {
  if (!BASE64URL.test(segment)) throw new Refusal('shape', `the ${what} segment is not base64url`);
  let text;
  try {
    text = fromBase64url(segment).toString('utf8');
  } catch (cause) {
    throw new Refusal('shape', `the ${what} segment could not be decoded: ${cause.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Refusal('shape', `the ${what} segment is not JSON: ${cause.message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Refusal('shape', `the ${what} segment is not an object`);
  }
  return parsed;
}

/**
 * @param {object} input
 * @param {string} input.token the ID token, exactly as the client sent it
 * @param {object} input.jwks a validated key source (`createJwksSource`)
 * @param {string} input.clientId the configured web client id for this environment
 * @param {() => Date} input.clock
 * @param {string} input.nonce the challenge this session issued, which the token must carry
 * @param {{spend: (challenge: string) => {nonce_id: string}}} input.nonces
 * @param {string} [input.source] which pinned key source to trust (default `gsi`)
 * @returns {{ok: true, principal: object, checks: string[]}
 *          |{ok: false, code: string, step: string, reason: string, detail: object}}
 */
export function verifyIdToken({ token, jwks, clientId, clock, nonces, nonce = undefined, source = 'gsi' }) {
  const checks = [];

  /** @returns {object} the verified principal */
  const attempt = () => {
    // 1. shape — three base64url segments, RS256, and a key id to fetch by.
    if (typeof token !== 'string' || token.length === 0) throw new Refusal('shape', 'the token is not a string');
    if (Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) throw new Refusal('shape', `the token is larger than ${MAX_TOKEN_BYTES} bytes`);
    const parts = token.split('.');
    if (parts.length !== 3) throw new Refusal('shape', `a JWS has three segments; this one has ${parts.length}`);
    const header = decodeSegment(parts[0], 'header');
    const payload = decodeSegment(parts[1], 'payload');
    if (header.alg !== 'RS256') throw new Refusal('shape', `alg=${String(header.alg)} is not RS256`);
    if (typeof header.kid !== 'string' || header.kid.length === 0) throw new Refusal('shape', 'the header carries no kid');
    checks.push('shape');

    // 2. signature — against the pinned source, refreshing once for an unknown kid.
    const found = jwks.keyFor(header.kid);
    if (found.ok !== true) throw new Refusal('signature', found.reason, found.code ?? 'OMEGA_E_IDENTITY_TOKEN', found.detail ?? {});
    if (verifyRs256(found.key, `${parts[0]}.${parts[1]}`, parts[2]) !== true) {
      throw new Refusal('signature', 'the signature does not verify against the pinned key source');
    }
    checks.push('signature');

    // 3. issuer — exact match. No prefix, no suffix, no wildcard.
    const issuers = GOOGLE_KEY_SOURCES[source]?.issuers ?? [];
    if (!issuers.includes(payload.iss)) {
      throw new Refusal('issuer', `iss=${String(payload.iss)} is not an accepted issuer`, 'OMEGA_E_IDENTITY_TOKEN', { accepted: [...issuers] });
    }
    checks.push('issuer');

    // 4. audience — the exact client id, and `azp` whenever the token's semantics require it.
    const audienceIsArray = Array.isArray(payload.aud);
    const audienceMatches = audienceIsArray ? payload.aud.includes(clientId) : payload.aud === clientId;
    if (audienceMatches !== true) throw new Refusal('audience', 'the token was minted for a different audience');
    if (audienceIsArray || payload.azp !== undefined) {
      if (payload.azp !== clientId) {
        // The step is named `audience+azp` because that is the check that failed: a token may
        // name us in `aud` and be addressed to somebody else in `azp`, and a refusal should say
        // which half decided it.
        throw new Refusal('audience+azp', 'azp does not name this client id, and the token is addressed to more than one party', 'OMEGA_E_IDENTITY_TOKEN', { azp_present: payload.azp !== undefined });
      }
    }
    checks.push(audienceIsArray ? 'audience+azp' : 'audience');

    // 5. window — integer seconds, and now inside [iat - 60s, exp].
    if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) {
      throw new Refusal('window', 'iat and exp must both be present as integer seconds');
    }
    const nowSeconds = Math.floor(clock().getTime() / 1000);
    if (nowSeconds > payload.exp) throw new Refusal('window', 'the token expired');
    if (nowSeconds < payload.iat - 60) throw new Refusal('window', 'the token is not valid yet');
    checks.push('window');

    // 6. nonce — the challenge *this session* issued, which the token must carry, spent exactly
    // once. The two halves are different questions: "is this token for my session?" and "has
    // this challenge been used before?". A token that names another challenge is refused
    // *without* spending this session's challenge, so a stolen token cannot deny a login.
    if (typeof nonce !== 'string' || nonce.length === 0) {
      throw new Refusal('nonce', 'the session presented no challenge', 'OMEGA_E_NONCE');
    }
    if (payload.nonce !== nonce) {
      throw new Refusal('nonce', 'the token carries a challenge this session did not issue', 'OMEGA_E_NONCE');
    }
    const { nonce_id: nonceId } = nonces.spend(payload.nonce);
    checks.push('nonce');

    // 7. subject — the identity key, and only this.
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new Refusal('subject', 'the token carries no subject');
    if (Buffer.byteLength(payload.sub, 'utf8') > 255) throw new Refusal('subject', 'the subject is longer than 255 bytes');
    checks.push('subject');

    // 8. email — display metadata, and only when the provider says it is verified.
    const emailVerified = payload.email_verified === true;
    const emailDisplay = emailVerified && typeof payload.email === 'string' && payload.email.length > 0 ? payload.email : null;
    checks.push('email');

    return {
      ok: true,
      checks,
      principal: Object.freeze({
        kind: 'google',
        sub_hash: subHash(payload.sub),
        email_display: emailDisplay,
        method: 'gsi',
        verified_at: clock().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        nonce_id: nonceId,
        aud_hash: audienceHash(clientId),
        claims: Object.freeze({
          hd: typeof payload.hd === 'string' ? payload.hd : null,
          email_verified: emailVerified,
          issuer: payload.iss,
        }),
      }),
    };
  };

  try {
    return attempt();
  } catch (cause) {
    if (cause instanceof Refusal) {
      return { ok: false, code: cause.code, step: cause.step, reason: cause.message, detail: cause.detail };
    }
    if (cause instanceof OmegaError) {
      // A refusal from the nonce store or the key source keeps its own code and its own step.
      const step = cause.code === 'OMEGA_E_NONCE' ? 'nonce' : 'signature';
      return { ok: false, code: cause.code, step, reason: cause.message, detail: cause.details ?? {} };
    }
    throw cause;
  }
}
