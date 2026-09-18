#!/usr/bin/env node
/**
 * The Google identity-forgery attacks — the twelfth adversarial category.
 *
 * Eight distinct forgeries, each one a *different question* about the same path. They are not
 * variations on "a bad token is rejected": each one breaks exactly one link in the chain, and
 * each one asserts the step that decided the refusal as well as the code, so a refusal for the
 * wrong reason counts as a failed attack rather than a pass.
 *
 *   1. a real RSA key the pinned source does not publish, wearing a `kid` that it does
 *   2. an issuer that merely reads like Google's
 *   3. a genuine token minted for somebody else's client
 *   4. a genuine token addressed to two parties, authorized for the other one
 *   5. `alg: HS256`, signed with the RSA modulus as the HMAC key
 *   6. a captured token presented with a challenge from another session
 *   7. a captured token replayed into the session that already spent its challenge
 *   8. somebody else's verified account claiming the owner's email, asking to be the owner
 *
 * Every attack runs against the real identity cell, in a real tissue, with a real membrane and a
 * real ledger, and every attack checks afterwards that nothing was granted: no binding, no
 * principal that could act. A forgery that is refused but leaves a binding behind is not a
 * blocked attack, it is a breach with a tidy error message.
 *
 *   node tools/google-attacks.mjs
 */
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createIdentity } from '../packages/identity/index.js';
import { OmegaLedger } from '../packages/runtime/index.js';
import { createAttack, runAttacks } from '../packages/evolution/index.js';
import { createJwksSource } from '../packages/cells/google/gateway/index.js';
import { buildGoogleIdentityTissue, subHash } from '../packages/cells/google/identity/index.js';
import { OFFLINE_CLIENT_ID, OFFLINE_T0, offlineClaims, offlineJwk, offlineJwks, signOfflineToken } from './google-fixtures.mjs';

export const IDENTITY_FORGERY = 'identity-forgery';
export const GOOGLE_ATTACK_COUNT = 8;

const OWNER_SUB = '110169484474386276334';
const ATTACKER_SUB = '107691523809123456789';

/** The organ under attack, rebuilt per attack so nothing leaks between attempts. */
function organ() {
  const clock = () => OFFLINE_T0;
  const operator = createIdentity({ label: 'nexa.operator', kind: 'agent', seed: '11'.repeat(32) });
  const ledger = new OmegaLedger({ actor: operator, clock });
  let issued = 0;
  const google = buildGoogleIdentityTissue({
    clock,
    ledger,
    operator,
    clientId: OFFLINE_CLIENT_ID,
    jwks: createJwksSource({ seed: offlineJwks(['offline-key-1', 'offline-key-2']), clock }),
    generate: () => `challenge-${String((issued += 1)).padStart(12, '0')}`,
  });
  return { google, operator, ledger };
}

/** A session: a challenge this organ issued, and the token the provider would mint for it. */
function session(claims = {}, kid = 'offline-key-1') {
  const value = organ();
  const challenge = value.google.begin();
  return { ...value, challenge, token: signOfflineToken(offlineClaims({ nonce: challenge, ...claims }), { kid }) };
}

/**
 * Judge one attempt. `expect` is the code the refusal must carry and `step` is the check that
 * must be the one to refuse — a forgery refused at the audience check while the signature was
 * also forged would leave the signature check untested.
 *
 * @param {{google: object, ledger: object, outcome: object, expect: string, step: string|null,
 *          after?: Function|null}} input
 * @returns {{blocked: boolean, code: string, detail: object}}
 */
function judge({ google, ledger, outcome, expect, step = null, after = null }) {
  const detail = { step: outcome.step, records: ledger.length, bindings: google.bindings.history().length };
  if (outcome.ok === true) return { blocked: false, code: 'ALLOW', detail: { ...detail, reason: 'the forgery was accepted' } };
  if (after !== undefined && after !== null) {
    const conceded = after({ google, ledger, outcome });
    if (conceded !== null) return { blocked: false, code: outcome.code, detail: { ...detail, conceded } };
  }
  if (outcome.code !== expect || (step !== null && outcome.step !== step)) {
    return { blocked: false, code: outcome.code, detail: { ...detail, expected: expect, expected_step: step } };
  }
  // Nothing was granted: no binding came into existence, and the refusal is on the record.
  if (google.bindings.history().length !== 0) return { blocked: false, code: outcome.code, detail: { ...detail, reason: 'the refusal created a binding' } };
  if (outcome.record === null) return { blocked: false, code: outcome.code, detail: { ...detail, reason: 'the refusal was not recorded' } };
  return { blocked: true, code: outcome.code, detail };
}

/** @returns {object[]} the eight identity-forgery attacks */
export function googleAttackSuite() {
  return [
    createAttack({
      id: 'lookalike-signing-key',
      category: IDENTITY_FORGERY,
      description: 'a token signed by a real RSA key the pinned source does not publish, wearing a kid that it does',
      run() {
        const { google, ledger, challenge } = session();
        // offline-key-3 signs correctly and is published by nobody; the header claims key 1, the
        // key the source trusts. The signature is genuine — the identity of the signer is not.
        const real = signOfflineToken(offlineClaims({ nonce: challenge }), { kid: 'offline-key-3' });
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'offline-key-1' }), 'utf8').toString('base64url');
        const [, payloadPart, signaturePart] = real.split('.');
        return judge({ google, ledger, outcome: google.login({ token: `${header}.${payloadPart}.${signaturePart}`, nonce: challenge }), expect: 'OMEGA_E_IDENTITY_TOKEN', step: 'signature' });
      },
    }),

    createAttack({
      id: 'issuer-lookalike',
      category: IDENTITY_FORGERY,
      description: 'a correctly signed token whose issuer merely reads like Google’s',
      run() {
        const { google, ledger, challenge, token } = session({ iss: 'https://accounts.google.com.evil.example' });
        return judge({ google, ledger, outcome: google.login({ token, nonce: challenge }), expect: 'OMEGA_E_IDENTITY_TOKEN', step: 'issuer' });
      },
    }),

    createAttack({
      id: 'audience-confusion',
      category: IDENTITY_FORGERY,
      description: 'a genuine token minted for another client, presented to this one',
      run() {
        const { google, ledger, challenge, token } = session({ aud: 'attacker-client.apps.googleusercontent.com', azp: 'attacker-client.apps.googleusercontent.com' });
        return judge({ google, ledger, outcome: google.login({ token, nonce: challenge }), expect: 'OMEGA_E_IDENTITY_TOKEN', step: 'audience' });
      },
    }),

    createAttack({
      id: 'authorized-party-confusion',
      category: IDENTITY_FORGERY,
      description: 'a genuine token addressed to two parties, authorized for the other one',
      run() {
        const { google, ledger, challenge, token } = session({ aud: [OFFLINE_CLIENT_ID, 'attacker-client.apps.googleusercontent.com'], azp: 'attacker-client.apps.googleusercontent.com' });
        // The array is legal and our client id is in it; `azp` is what decides who the token is
        // really for, so the refusal names `audience+azp` rather than the plain audience check.
        return judge({ google, ledger, outcome: google.login({ token, nonce: challenge }), expect: 'OMEGA_E_IDENTITY_TOKEN', step: 'audience+azp' });
      },
    }),

    createAttack({
      id: 'algorithm-confusion',
      category: IDENTITY_FORGERY,
      description: 'alg=HS256 with the RSA modulus used as the HMAC key',
      run() {
        const { google, ledger, challenge } = session();
        const key = offlineJwk('offline-key-1');
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'offline-key-1' }), 'utf8').toString('base64url');
        const payload = Buffer.from(JSON.stringify(offlineClaims({ nonce: challenge })), 'utf8').toString('base64url');
        const signature = createHmac('sha256', Buffer.from(key.n, 'base64url')).update(`${header}.${payload}`).digest('base64url');
        // The verifier never *tests* this signature: the algorithm is checked against the one the
        // key source pins, so the confusion has no surface to land on.
        return judge({ google, ledger, outcome: google.login({ token: `${header}.${payload}.${signature}`, nonce: challenge }), expect: 'OMEGA_E_IDENTITY_TOKEN', step: 'shape' });
      },
    }),

    createAttack({
      id: 'nonce-replay-across-sessions',
      category: IDENTITY_FORGERY,
      description: 'a token captured from one session is presented with another session’s challenge',
      run() {
        const { google, ledger } = organ();
        const first = google.begin();
        const captured = signOfflineToken(offlineClaims({ nonce: first }));
        const second = google.begin();
        return judge({
          google,
          ledger,
          outcome: google.login({ token: captured, nonce: second }),
          expect: 'OMEGA_E_NONCE',
          step: 'nonce',
          // The refusal must not burn the session's own challenge, or a captured token becomes a
          // way to deny a legitimate login.
          after: ({ google: organUnderAttack }) => (organUnderAttack.nonces.has(second) ? null : 'the refusal burned the session’s own challenge'),
        });
      },
    }),

    createAttack({
      id: 'nonce-replay-after-login',
      category: IDENTITY_FORGERY,
      description: 'a captured token is replayed into the session that already spent its challenge',
      run() {
        const { google, ledger, challenge, token } = session();
        const first = google.login({ token, nonce: challenge });
        if (first.ok !== true) return { blocked: false, code: first.code, detail: { reason: 'the legitimate login did not succeed, so this attack proves nothing' } };
        const replay = google.login({ token, nonce: challenge });
        if (replay.ok === true) return { blocked: false, code: 'ALLOW', detail: { reason: 'the token logged in twice' } };
        const denials = google.evidence().filter((entry) => entry.kind === 'IDENTITY_VERIFIED' && entry.decision === 'DENY');
        if (replay.code !== 'OMEGA_E_NONCE' || replay.step !== 'nonce' || denials.length !== 1 || denials[0].detail.step !== 'nonce') {
          return { blocked: false, code: replay.code, detail: { reason: 'the replay was refused for another reason, or not recorded', denials: denials.length, step: replay.step } };
        }
        const crossings = google.crossings();
        return {
          blocked: crossings.filter((entry) => entry.decision === 'ALLOW').length === 1 && google.bindings.history().length === 0,
          code: replay.code,
          detail: { crossings: crossings.length, allows: crossings.filter((entry) => entry.decision === 'ALLOW').length, records: ledger.length, bindings: google.bindings.history().length, step: replay.step },
        };
      },
    }),

    createAttack({
      id: 'owner-by-email',
      category: IDENTITY_FORGERY,
      description: 'somebody else’s verified Google account claims the owner’s email and asks to be the owner',
      run() {
        const { google, ledger, challenge } = session();
        // A genuine token: real signature, real issuer, real audience, `email_verified: true`.
        // The only false thing in it is the assumption that the email means ownership.
        const token = signOfflineToken(offlineClaims({ nonce: challenge, sub: ATTACKER_SUB, email: 'canyoudfg@gmail.com', email_verified: true }));
        const login = google.login({ token, nonce: challenge });
        if (login.ok !== true) return { blocked: false, code: login.code, detail: { reason: 'the genuine token did not verify, so the email assumption was never reached' } };
        const attackerHash = login.principal.sub_hash;
        const ownerHash = subHash(OWNER_SUB);
        if (attackerHash === ownerHash) return { blocked: false, code: 'ALLOW', detail: { reason: 'two subjects hashed to the same identity' } };
        // The binding registry is keyed by the subject hash. There is no lookup by email to try,
        // and the three candidates an attacker would reach for all resolve to nothing.
        const bound = [attackerHash, login.principal.email_display, 'canyoudfg@gmail.com']
          .map((key) => google.bindings.activeFor(key))
          .filter((entry) => entry !== null);
        if (bound.length > 0) return { blocked: false, code: 'OMEGA_E_BINDING_EXISTS', detail: { reason: 'an email resolved to a binding', bound: bound.length } };
        // The operator binds the real owner with the same display email: the two live side by
        // side, and the attacker still holds nothing.
        const ownerKid = createIdentity({ label: 'nexa.owner', kind: 'agent', seed: '22'.repeat(32) }).kid;
        const ownerBinding = google.bindOwner({ sub_hash: ownerHash, nexa_kid: ownerKid });
        if (ownerBinding.sub_hash === attackerHash || google.bindings.activeFor(attackerHash) !== null) {
          return { blocked: false, code: 'OMEGA_E_IDENTITY', detail: { reason: 'the attacker inherited the owner’s binding' } };
        }
        return {
          blocked: true,
          code: 'OMEGA_E_IDENTITY',
          detail: {
            attacker_sub_hash: attackerHash.slice(0, 22),
            owner_sub_hash: ownerHash.slice(0, 22),
            email_display: login.principal.email_display,
            bindings_for_attacker: 0,
            bindings: google.bindings.history().length,
            records: ledger.length,
            step: null,
            reason: 'identity is the subject; the email is a claim the attacker typed',
          },
        };
      },
    }),
  ];
}

/** @returns {object[]} the attack reports, executed */
export function runGoogleAttackSuite() {
  return runAttacks(googleAttackSuite());
}

// `node tools/google-attacks.mjs` runs the suite and prints the result.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reports = runGoogleAttackSuite();
  let failed = 0;
  for (const report of reports) {
    if (!report.blocked) failed += 1;
    process.stdout.write(`  ${report.blocked ? 'BLOCKED' : 'FAILED '} ${report.category} ${report.id} ${report.code}\n`);
    if (!report.blocked) process.stdout.write(`          ${JSON.stringify(report.detail)}\n`);
  }
  process.stdout.write(`\n${reports.length - failed}/${reports.length} identity forgeries blocked\n`);
  process.exit(failed === 0 ? 0 : 1);
}
