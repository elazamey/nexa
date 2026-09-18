/**
 * Single-use challenges.
 *
 * Step 6 of the verification order is not "the token has a nonce": it is "the token carries the
 * challenge *this session* issued, and that challenge has never been seen before". That makes a
 * stolen token useless outside the session it was minted for, and it makes a replay a refusal
 * rather than a second success.
 *
 * A challenge is spent exactly once. Spending is atomic in the sense that matters here: the
 * entry is removed as part of the check, so a second spend cannot find it.
 *
 * The generator is injectable. Production uses `randomNonce()` (128 bits from `node:crypto`);
 * the offline suites inject a deterministic one so a pinned vector is reproducible. Injecting a
 * generator changes *who chooses the nonce*, never whether it is single-use.
 */
import { randomNonce } from '../../../../crypto/index.js';
import { OmegaError } from '../../../../compiler/index.js';
import { challengeId } from './domains.js';

/**
 * @param {{clock: () => Date, ttlMs?: number, generate?: () => string, max?: number}} input
 */
export function createNonceStore({ clock, ttlMs = 300_000, generate = () => randomNonce(), max = 1024 }) {
  /** @type {Map<string, {expires: number}>} challenge → expiry. The challenge is never persisted. */
  const live = new Map();
  let issued = 0;
  let spent = 0;

  const prune = () => {
    const now = clock().getTime();
    for (const [challenge, entry] of [...live.entries()]) {
      if (entry.expires <= now) live.delete(challenge);
    }
  };

  return {
    /** @returns {string} a fresh challenge for one session */
    issue() {
      prune();
      if (live.size >= max) {
        throw new OmegaError('OMEGA_E_NONCE', `too many outstanding challenges (${max}); the store refuses to grow without bound`);
      }
      const challenge = generate();
      if (typeof challenge !== 'string' || challenge.length < 16) {
        throw new OmegaError('OMEGA_E_NONCE', 'a challenge must be at least 16 characters of entropy');
      }
      live.set(challenge, { expires: clock().getTime() + ttlMs });
      issued += 1;
      return challenge;
    },

    /**
     * Spend a challenge. Absent, expired and already-spent are the same answer: refused.
     * @param {string} challenge
     * @returns {{nonce_id: string}}
     */
    spend(challenge) {
      if (typeof challenge !== 'string' || challenge.length === 0) {
        throw new OmegaError('OMEGA_E_NONCE', 'the token carries no nonce');
      }
      const id = challengeId(challenge);
      const entry = live.get(challenge);
      if (entry === undefined) {
        throw new OmegaError('OMEGA_E_NONCE', 'the challenge was never issued by this session, or it was already spent', { nonce_id: id });
      }
      live.delete(challenge);
      if (entry.expires <= clock().getTime()) {
        throw new OmegaError('OMEGA_E_NONCE', 'the challenge expired before it was spent', { nonce_id: id });
      }
      spent += 1;
      return { nonce_id: id };
    },

    /** @param {string} challenge @returns {boolean} */
    has(challenge) {
      return live.has(challenge);
    },

    /** @returns {object} counts only — a challenge is never in a report */
    metrics() {
      return { issued, spent, live: live.size };
    },
  };
}
