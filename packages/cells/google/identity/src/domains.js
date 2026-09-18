/**
 * The identity key, and the only transformations of it that may be stored.
 *
 *     stored identity = sha256("NEXA/google1 subject\0" || sub)
 *
 * `sub` is never written to a ledger, a log, a prompt or an export. What is stored is a digest
 * under a **domain-separated** prefix, so a digest computed here can never collide in meaning
 * with a digest computed for another purpose, and an auditor holding the account can recompute
 * it and match records without the raw identifier existing anywhere in the repository.
 *
 * Email gets the same treatment but a lower status: it is display metadata. It does not bind,
 * does not authorize and does not identify — a changed email changes nothing, and the hash is
 * only produced when policy allows storing it at all.
 */
import { sha256Multihash } from '../../../../crypto/index.js';

/** Domain separators. The trailing NUL is why a prefix cannot be confused with a longer one. */
export const SUBJECT_DOMAIN = 'NEXA/google1 subject\u0000';
export const EMAIL_DOMAIN = 'NEXA/google1 email\u0000';
export const NONCE_DOMAIN = 'NEXA/google1 nonce\u0000';
export const AUDIENCE_DOMAIN = 'NEXA/google1 audience\u0000';

/** @param {string} sub @returns {string} `sha256:<base64url>` */
export function subHash(sub) {
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('sub must be a non-empty string'); // never reached: the verifier checks first
  }
  return sha256Multihash(Buffer.concat([Buffer.from(SUBJECT_DOMAIN, 'utf8'), Buffer.from(sub, 'utf8')]));
}

/** @param {string} email @returns {string} */
export function emailHash(email) {
  if (typeof email !== 'string' || email.length === 0) throw new Error('email must be a non-empty string');
  return sha256Multihash(Buffer.concat([Buffer.from(EMAIL_DOMAIN, 'utf8'), Buffer.from(email, 'utf8')]));
}

/** @param {string} challenge @returns {string} the id of a spent challenge — never the challenge */
export function challengeId(challenge) {
  return sha256Multihash(Buffer.concat([Buffer.from(NONCE_DOMAIN, 'utf8'), Buffer.from(challenge, 'utf8')]));
}

/** @param {string} clientId @returns {string} evidence carries a digest of the audience, not the id */
export function audienceHash(clientId) {
  return sha256Multihash(Buffer.concat([Buffer.from(AUDIENCE_DOMAIN, 'utf8'), Buffer.from(clientId, 'utf8')]));
}
