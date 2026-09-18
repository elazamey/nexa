/**
 * GOOGLE IDENTITY CELL v1 — the eight identity-forgery attacks.
 *
 * Each attack is a separate test, deliberately: a suite that ran all eight inside one test would
 * report "the identity path is fine" when one forgery succeeded and seven did not. The names are
 * the attacks, not the code paths, so a failure reads as what it is — someone got in.
 *
 * The suite itself lives in `tools/google-attacks.mjs` because the Evolution Gate and the posture
 * check must see the same eight attacks this file runs. There is one definition and two readers.
 *
 *   node --test tests/google-attacks.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ATTACK_CATEGORIES } from '../packages/evolution/index.js';
import { googleAttackSuite, runGoogleAttackSuite } from '../tools/google-attacks.mjs';

const reports = runGoogleAttackSuite();
const byId = new Map(reports.map((report) => [report.id, report]));

/** @param {string} id @param {string|null} code */
function expectBlocked(id, code = null) {
  const report = byId.get(id);
  assert.notEqual(report, undefined, `${id} is not in the suite`);
  assert.equal(report.blocked, true, `${id} was not blocked: ${JSON.stringify(report.detail)}`);
  if (code !== null) assert.equal(report.code, code);
  return report;
}

test('google/attacks: the suite is eight attacks in its own category', () => {
  assert.equal(googleAttackSuite().length, 8);
  assert.deepEqual([...new Set(reports.map((report) => report.category))], ['identity-forgery']);
  assert.equal(ATTACK_CATEGORIES.includes('identity-forgery'), true, 'the twelfth category is not registered');
  assert.equal(ATTACK_CATEGORIES.length, 12);
});

test('attack: a lookalike signing key — a real key nobody publishes, wearing a kid that is trusted', () => {
  const report = expectBlocked('lookalike-signing-key', 'OMEGA_E_IDENTITY_TOKEN');
  assert.equal(report.detail.step, 'signature');
});

test('attack: an issuer that reads like Google’s is refused at the issuer, not at the signature', () => {
  const report = expectBlocked('issuer-lookalike', 'OMEGA_E_IDENTITY_TOKEN');
  // The distinction is the test: the signature is genuine, so only the issuer check can refuse it.
  assert.equal(report.detail.step, 'issuer');
});

test('attack: a genuine token minted for another client is refused at the audience', () => {
  const report = expectBlocked('audience-confusion', 'OMEGA_E_IDENTITY_TOKEN');
  assert.equal(report.detail.step, 'audience');
});

test('attack: a token addressed to two parties is refused at azp, however valid its audience', () => {
  const report = expectBlocked('authorized-party-confusion', 'OMEGA_E_IDENTITY_TOKEN');
  assert.equal(report.detail.step, 'audience+azp');
});

test('attack: alg confusion — HS256 keyed on the RSA modulus never reaches the verifier', () => {
  const report = expectBlocked('algorithm-confusion', 'OMEGA_E_IDENTITY_TOKEN');
  assert.equal(report.detail.step, 'shape');
});

test('attack: a token captured from one session is refused by another session, and burns nothing', () => {
  const report = expectBlocked('nonce-replay-across-sessions', 'OMEGA_E_NONCE');
  assert.equal(report.detail.step, 'nonce');
});

test('attack: a captured token replayed into its own session logs in exactly once', () => {
  const report = expectBlocked('nonce-replay-after-login', 'OMEGA_E_NONCE');
  assert.equal(report.detail.allows, 1, 'the replay produced a second login');
  assert.equal(report.detail.crossings, 2, 'the replay was not recorded as a crossing');
});

test('attack: somebody else’s verified email does not make them the owner', () => {
  const report = expectBlocked('owner-by-email');
  // The subject hash is what the binding is keyed on, and the attacker's hash is not the owner's.
  assert.notEqual(report.detail.attacker_sub_hash, report.detail.owner_sub_hash);
  assert.equal(report.detail.bindings_for_attacker, 0);
  // The provider said the email was verified. Verification of a claim is not proof of ownership
  // of an account, and the identity anchor is the subject either way.
  assert.equal(report.detail.email_display, 'canyoudfg@gmail.com');
});

test('google/attacks: the eight attacks are eight different questions, not one question eight times', () => {
  const signatures = reports.map((report) => `${report.code}/${report.detail.step ?? 'none'}`);
  assert.equal(new Set(signatures).size >= 6, true, `the attacks are not distinct: ${signatures.join(', ')}`);
  const ids = reports.map((report) => report.id);
  assert.equal(new Set(ids).size, 8);
  // Every one of them was refused, and no forgery produced a binding. `owner-by-email` binds the
  // *real* owner as part of the attack — that is how it shows the attacker gained nothing — so
  // its binding count is asserted from the other side, by `bindings_for_attacker`.
  for (const report of reports) {
    assert.equal(report.blocked, true, `${report.id} got through`);
    if (report.id === 'owner-by-email') {
      assert.equal(report.detail.bindings_for_attacker, 0, 'the forged identity acquired a binding');
      assert.equal(report.detail.bindings, 1, 'the real owner’s binding is missing, so the attack proved nothing');
    } else {
      assert.equal(report.detail.bindings, 0, `${report.id} created a binding`);
    }
  }
});
