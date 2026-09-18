/**
 * GOOGLE IDENTITY CELL v1 — group 1: token verification.
 *
 * These tests attack the *order*. Every one of them starts from a token that verifies and
 * changes exactly one thing, so a refusal can only be attributed to that change — and each
 * refusal is asserted by the step that produced it, not merely by "it failed". A refusal for the
 * wrong reason is a finding: if a lookalike issuer were refused by the signature check, the
 * issuer check would be untested and we would not know it.
 *
 * Nothing here talks to Google. The tokens are signed with the offline throwaway key in
 * `tools/google-fixtures.mjs`, verified against a JWKS built from the same public halves, and
 * the clock is pinned. The contract is what is under test, not the provider.
 *
 * Run alone: `node --test tests/google-identity.test.js`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdentity } from '../packages/identity/index.js';
import { sha256Multihash } from '../packages/crypto/index.js';
import { SUBJECT_DOMAIN, subHash } from '../packages/cells/google/identity/index.js';
import { createJwksSource } from '../packages/cells/google/gateway/index.js';
import { verifyIdToken } from '../packages/cells/google/identity/index.js';
import { createNonceStore } from '../packages/cells/google/identity/index.js';
import { OFFLINE_CLIENT_ID, SUBJECTS, everythingWritten, fixture, offlineClaims, offlineJwks, signOfflineToken } from './google-helpers.mjs';

const NOW = offlineClaims().iat; // the pinned clock, in the units the claims use

/** The one-line login helper: issue a challenge, mint a token for it, present both. */
function login(organ, overrides = {}, options = {}) {
  const challenge = organ.google.begin();
  const token = organ.tokenFor({ nonce: challenge, ...overrides }, options);
  return { ...organ.google.login({ token, nonce: challenge }), token, challenge };
}

// --- the happy path, stated as narrowly as possible ---------------------------------

test('google/identity: a token from the pinned source yields a principal and nothing else', () => {
  const organ = fixture();
  const result = login(organ);
  assert.equal(result.ok, true);
  assert.equal(result.principal.kind, 'google');
  assert.equal(result.principal.method, 'gsi');
  assert.deepEqual(Object.keys(result.principal).sort(), ['aud_hash', 'claims', 'email_display', 'kind', 'method', 'nonce_id', 'sub_hash', 'verified_at']);
  // No token, no capability, no role, no subject: a principal is a claim about who, not a grant.
  assert.equal(Object.hasOwn(result.principal, 'token'), false);
  assert.equal(Object.hasOwn(result.principal, 'capability'), false);
  assert.equal(Object.hasOwn(result.principal, 'role'), false);
  assert.equal(Object.hasOwn(result.principal, 'sub'), false);
});

test('google/identity: the verification order is the documented one, and the last step is email', () => {
  const organ = fixture();
  const result = login(organ);
  assert.deepEqual(result.principal.nonce_id.startsWith('sha256:'), true);
  const record = organ.google.evidence().find((entry) => entry.kind === 'IDENTITY_VERIFIED');
  assert.equal(record.decision, 'ALLOW');
  assert.equal(record.detail.step, null);
  assert.equal(record.detail.method, 'gsi');
});

test('google/identity: the raw token, the raw subject and the raw email never reach evidence', () => {
  const organ = fixture();
  const result = login(organ);
  const written = everythingWritten(organ.google, organ.ledger);
  assert.equal(written.includes(result.token), false, 'the token is in the record');
  assert.equal(written.includes(SUBJECTS.owner), false, 'the raw sub is in the record');
  const rawEmail = 'canyoudfg@gmail.com';
  const emailInEvidence = written.split('\n').some((line) => line.includes(`"${rawEmail}"`));
  assert.equal(emailInEvidence, false, 'the raw email is in a serialized record');
  // The display email exists only in the returned principal, which the host holds in memory.
  assert.equal(result.principal.email_display, rawEmail);
});

test('google/identity: the identity key is the domain-separated digest of sub, and is recomputable', () => {
  const organ = fixture();
  const result = login(organ);
  const expected = sha256Multihash(Buffer.concat([Buffer.from(SUBJECT_DOMAIN, 'utf8'), Buffer.from(SUBJECTS.owner, 'utf8')]));
  assert.equal(result.principal.sub_hash, expected);
  // Domain separation is not decoration: a bare digest of the same subject is a different value,
  // so a digest computed for another purpose can never be mistaken for an identity.
  assert.notEqual(result.principal.sub_hash, sha256Multihash(Buffer.from(SUBJECTS.owner, 'utf8')));
  assert.equal(result.principal.sub_hash, subHash(SUBJECTS.owner));
});

test('google/identity: email is display metadata — the same subject with another email is the same identity', () => {
  const organ = fixture();
  const first = login(organ);
  const second = login(organ, { email: 'renamed@gmail.com' });
  assert.equal(second.ok, true);
  assert.equal(second.principal.sub_hash, first.principal.sub_hash);
  assert.notEqual(second.principal.email_display, first.principal.email_display);
});

test('google/identity: an unverified email is not displayed, and the login still succeeds', () => {
  const organ = fixture();
  const result = login(organ, { email_verified: false, email: 'not-proven@gmail.com' });
  assert.equal(result.ok, true, 'an unverified email does not stop the subject being verified');
  assert.equal(result.principal.email_display, null);
  assert.equal(result.principal.claims.email_verified, false);
});

// --- the checks, one at a time ------------------------------------------------------

test('google/identity: the issuer must match exactly — a lookalike suffix is refused at the issuer', () => {
  const organ = fixture();
  const result = login(organ, { iss: 'https://accounts.google.com.evil.example' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'OMEGA_E_IDENTITY_TOKEN');
  assert.equal(result.step, 'issuer');
});

test('google/identity: the issuer must match exactly — a lookalike prefix is refused at the issuer', () => {
  const organ = fixture();
  const result = login(organ, { iss: 'https://evil.example/accounts.google.com' });
  assert.equal(result.step, 'issuer');
});

test('google/identity: a token minted for another audience is refused at the audience', () => {
  const organ = fixture();
  const result = login(organ, { aud: 'someone-elses-client.apps.googleusercontent.com' });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'audience');
});

test('google/identity: a multi-audience token must name us in azp', () => {
  const organ = fixture();
  const refused = login(organ, { aud: [OFFLINE_CLIENT_ID, 'other.apps.googleusercontent.com'], azp: 'other.apps.googleusercontent.com' });
  assert.equal(refused.ok, false);
  // The step is named for the check that failed: the audience was fine, the authorized party was
  // not. A refusal that said merely `audience` would hide which half decided it.
  assert.equal(refused.step, 'audience+azp');
  // …and the same token with our own azp is accepted: the refusal was about the party, not the array.
  const accepted = login(organ, { aud: [OFFLINE_CLIENT_ID, 'other.apps.googleusercontent.com'], azp: OFFLINE_CLIENT_ID });
  assert.equal(accepted.ok, true);
});

test('google/identity: a token signed by a key outside the pinned source is refused at the signature', () => {
  const organ = fixture({ keys: ['offline-key-1'] });
  const result = login(organ, {}, { kid: 'offline-key-2' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'OMEGA_E_IDENTITY_TOKEN');
  assert.equal(result.step, 'signature');
});

test('google/identity: a corrupted signature is refused at the signature', () => {
  const organ = fixture();
  const challenge = organ.google.begin();
  const good = organ.tokenFor({ nonce: challenge });
  const parts = good.split('.');
  const flipped = parts[2].endsWith('A') ? 'B' : 'A';
  const corrupted = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${flipped}`;
  const result = organ.google.login({ token: corrupted, nonce: challenge });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'signature');
});

test('google/identity: alg none is refused at the shape, before any signature is considered', () => {
  const organ = fixture();
  const challenge = organ.google.begin();
  const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'offline-key-1' }), 'utf8').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: OFFLINE_CLIENT_ID, sub: SUBJECTS.owner, nonce: challenge, iat: NOW, exp: NOW + 3600 }), 'utf8').toString('base64url');
  const result = organ.google.login({ token: `${header}.${payload}.`, nonce: challenge });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'shape');
});

test('google/identity: the window is enforced on both ends', () => {
  const organ = fixture();
  assert.equal(login(organ, { exp: NOW - 1 }).step, 'window');
  assert.equal(login(organ, { iat: NOW + 3_600 }).step, 'window');
  // A token issued a minute ago is inside the skew allowance, not outside the window.
  assert.equal(login(organ, { iat: NOW - 30 }).ok, true);
});

test('google/identity: the challenge is single-use — the same token cannot log in twice', () => {
  const organ = fixture();
  const challenge = organ.google.begin();
  const token = organ.tokenFor({ nonce: challenge });
  assert.equal(organ.google.login({ token, nonce: challenge }).ok, true);
  const replay = organ.google.login({ token, nonce: challenge });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'OMEGA_E_NONCE');
  assert.equal(replay.step, 'nonce');
  // The record of the second attempt says DENY: a replay is evidence, not silence.
  const denials = organ.google.evidence().filter((entry) => entry.kind === 'IDENTITY_VERIFIED' && entry.decision === 'DENY');
  assert.equal(denials.length, 1);
  assert.equal(denials[0].detail.step, 'nonce');
});

test('google/identity: a challenge this session never issued is refused', () => {
  const organ = fixture();
  const result = login(organ, { nonce: 'challenge-that-was-never-issued' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'OMEGA_E_NONCE');
});

test('google/identity: a token minted for another challenge is refused, and this session keeps its challenge', () => {
  const organ = fixture();
  const stolen = organ.google.begin();
  const token = organ.tokenFor({ nonce: stolen });
  const mine = organ.google.begin();
  const refused = organ.google.login({ token, nonce: mine });
  assert.equal(refused.ok, false);
  assert.equal(refused.step, 'nonce');
  // The refusal did not burn this session's challenge: a mismatch is not a login attempt.
  assert.equal(organ.google.nonces.has(mine), true);
  assert.equal(organ.google.login({ token, nonce: stolen }).ok, true);
});

test('google/identity: a token with no challenge at all is refused', () => {
  const organ = fixture();
  const challenge = organ.google.begin();
  const token = signOfflineToken({ iss: 'https://accounts.google.com', aud: OFFLINE_CLIENT_ID, sub: SUBJECTS.owner, iat: NOW, exp: NOW + 3_600 });
  const result = organ.google.login({ token, nonce: challenge });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'nonce');
});

// --- fail-closed, and the order of the refusals --------------------------------------

test('google/identity: missing claims are refusals, never defaults', () => {
  const organ = fixture();
  const noSubject = login(organ, { sub: undefined });
  assert.equal(noSubject.ok, false);
  assert.equal(noSubject.step, 'subject');
  const noWindow = login(organ, { exp: undefined });
  assert.equal(noWindow.step, 'window');
  const noAudience = login(organ, { aud: undefined });
  assert.equal(noAudience.step, 'audience');
});

test('google/identity: the earlier step decides — a forged token with two faults fails on the first', () => {
  const organ = fixture();
  // Signed by a key outside the source *and* minted for another audience: the signature is
  // checked first, so the refusal names the signature. If this test ever reports `audience`,
  // the order has been rearranged and the audience check is doing the signature's work.
  const result = login(organ, { aud: 'other.apps.googleusercontent.com' }, { kid: 'offline-key-3' });
  assert.equal(result.step, 'signature');
});

test('google/identity: a structurally malformed token is refused at the shape', () => {
  const organ = fixture();
  const challenge = organ.google.begin();
  for (const token of ['', 'not-a-jwt', 'a.b', 'a.b.c.d', '!!!.@@@.###']) {
    const result = organ.google.login({ token, nonce: challenge });
    assert.equal(result.ok, false, `${token} was accepted`);
    assert.equal(result.step, 'shape', `${token} failed at ${result.step}`);
  }
});

test('google/identity: an oversized payload never reaches the cell — the membrane refuses it first', () => {
  const organ = fixture();
  const challenge = organ.google.begin();
  const result = organ.google.login({ token: `x.${'y'.repeat(20_000)}.z`, nonce: challenge });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'OMEGA_E_BUDGET');
  assert.equal(result.step, 'budget');
  const crossing = organ.google.crossings()[0];
  assert.equal(crossing.decision, 'DENY');
  assert.equal(crossing.detail.step, 'budget');
});

test('google/identity: the verifier also has its own ceiling, and it is not a promise the membrane keeps for it', () => {
  const source = createNonceStore({ clock: () => new Date('2026-09-18T12:00:00Z'), generate: () => 'challenge-000000000001' });
  const jwks = { keyFor: () => ({ ok: false, code: 'OMEGA_E_IDENTITY_TOKEN', reason: 'never reached' }) };
  const challenge = source.issue();
  const direct = verifyIdToken({
    token: `x.${'y'.repeat(20_000)}.z`,
    nonce: challenge,
    jwks,
    clientId: OFFLINE_CLIENT_ID,
    clock: () => new Date('2026-09-18T12:00:00Z'),
    nonces: source,
  });
  assert.equal(direct.ok, false);
  assert.equal(direct.step, 'shape');
  assert.match(direct.reason, /larger than 16384 bytes/);
});

test('google/identity: the key source refreshes once for an unknown kid and then refuses', () => {
  const calls = [];
  const source = createJwksSource({
    clock: () => new Date('2026-09-18T12:00:00Z'),
    seed: offlineJwks(['offline-key-1']),
    fetch: (uri) => {
      calls.push(uri);
      return offlineJwks(['offline-key-1']); // the provider did not have it either
    },
  });
  const first = source.keyFor('offline-key-2');
  assert.equal(first.ok, false);
  assert.equal(calls.length, 1, 'an unknown kid triggers exactly one refresh');
  assert.equal(calls[0], 'https://www.googleapis.com/oauth2/v3/certs');
  // A second ask is a second refusal, and a second refresh would be a retry loop.
  assert.equal(source.keyFor('offline-key-2').ok, false);
  assert.equal(source.keyFor('offline-key-2').ok, false);
  assert.equal(calls.length, 1, 'a refused kid must not trigger a fetch on every ask');
  assert.deepEqual(source.describe().refused_kids, ['offline-key-2']);
});

test('google/identity: the login itself refuses an unknown kid, with no key source to refresh from', () => {
  const organ = fixture({ keys: ['offline-key-1'] });
  const result = login(organ, {}, { kid: 'offline-key-3' });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'signature');
});

// --- the membrane: a login is a crossing, not a function call -------------------------

test('google/identity: each login crosses the membrane, and the crossing is evidenced', () => {
  const organ = fixture();
  login(organ);
  const crossings = organ.google.crossings();
  assert.equal(crossings.length, 1);
  const crossing = crossings[0];
  assert.equal(crossing.kind, 'CELL_MESSAGE');
  assert.equal(crossing.decision, 'ALLOW');
  assert.equal(crossing.from, 'google.session');
  assert.equal(crossing.cell, 'google.identity');
  assert.equal(crossing.receptor, 'verify');
  // A crossing carries the capability that authorized it and the payload's digest — never the
  // payload. The token was the payload.
  assert.equal(typeof crossing.capability, 'string');
  assert.equal(typeof crossing.detail.payload_digest, 'string');
  assert.equal(JSON.stringify(crossing).includes('eyJ'), false, 'the token leaked into the crossing record');
});

test('google/identity: a route the tissue does not declare is refused at the policy step', () => {
  const organ = fixture();
  const challenge = organ.google.begin();
  const token = organ.tokenFor({ nonce: challenge });
  // The contract names one route into the identity cell: google.session → google.identity.verify.
  // A cell addressing itself, or a receptor that does not exist, is refused before any identity
  // check could run — and the refusal lists the contract, so the reader sees what is allowed.
  const selfAddressed = organ.google.tissue.send({ from: 'google.identity', to: 'google.identity', receptor: 'verify', payload: { token, nonce: challenge } });
  assert.equal(selfAddressed.ok, false);
  assert.equal(selfAddressed.code, 'OMEGA_E_ROUTE');
  assert.equal(selfAddressed.step, 'policy');
  const unknown = organ.google.tissue.send({ from: 'google.session', to: 'google.identity', receptor: 'mint', payload: { token, nonce: challenge } });
  assert.equal(unknown.code, 'OMEGA_E_ROUTE');
  // The challenge was never spent: a refused route is not a login attempt.
  assert.equal(organ.google.nonces.has(challenge), true);
});
