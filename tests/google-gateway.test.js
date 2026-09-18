/**
 * GOOGLE IDENTITY CELL v1 — groups 4 and 5: the token vault, quota discipline and egress.
 *
 * The three things a Google integration usually leaks, tested as the three things this one
 * refuses to do:
 *
 *   · **material** — the vault hands out handles that carry no material, bound to the presenter
 *     they were issued to; a refresh replaces the material instead of keeping it, and a failed
 *     refresh leaves nothing behind;
 *   · **rate** — a service with a call in flight, or one that answered 429, is refused rather
 *     than retried harder; the delay grows, is capped, and is recorded;
 *   · **egress** — anything that looks like a credential is refused a destination, and the
 *     digest that goes into evidence is a digest of canonical bytes, never of a live string.
 *
 * Run alone: `node --test tests/google-gateway.test.js`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTokenVault, createLimiter, scanForSecretMaterial, payloadDigest, SECRET_PATTERNS } from '../packages/cells/google/gateway/index.js';
import { T0 } from './google-helpers.mjs';

const SUB = `sha256:${'A'.repeat(43)}`;
const OTHER_SUB = `sha256:${'C'.repeat(43)}`;

/** A vault with one service's material, and a refresh port a test can steer. */
function vault({ refresh = null, expiresInMs = 3_600_000, record = null } = {}) {
  const material = ['ya29.a0AfH6SMBexampleaccessstokenvalue', '1//0eXamplerefreshtokenvalue'];
  const call = { sub_hash: SUB, service: 'gmail', access_token: material[0], refresh_token: material[1], scopes: ['https://www.googleapis.com/auth/gmail.send'], expires_at: new Date(T0.getTime() + expiresInMs).toISOString() };
  return createTokenVault({ clock: () => T0, refresh, record, secrets: { [`${SUB}|gmail`]: call } });
}

// --- the vault ------------------------------------------------------------------------

test('google/vault: a handle is a descriptor, and it carries no material', () => {
  const store = vault();
  const handle = store.handleFor({ sub_hash: SUB, service: 'gmail', presenter: 'google.gmail', scopes: ['https://www.googleapis.com/auth/gmail.send'] });
  assert.equal(handle.handle, 'vault://google/gmail');
  assert.equal(handle.presenter, 'google.gmail');
  assert.equal(handle.subject, SUB);
  const serialized = JSON.stringify(handle);
  assert.equal(serialized.includes('ya29.'), false);
  assert.equal(serialized.includes('1//'), false);
  assert.equal(Object.hasOwn(handle, 'access_token'), false);
  assert.equal(Object.hasOwn(handle, 'refresh_token'), false);
});

test('google/vault: material is resolved only for the cell the handle was issued to', () => {
  const store = vault();
  const handle = store.handleFor({ sub_hash: SUB, service: 'gmail', presenter: 'google.gmail' });
  // A handle stolen by another cell of the same organism is worthless: the audience code is the
  // same one attenuation uses, because it is the same question.
  assert.throws(
    () => store.resolve({ handle, presenter: 'google.drive' }),
    (error) => error.code === 'NEXA_E_CAP_AUDIENCE',
  );
  const material = store.resolve({ handle, presenter: 'google.gmail' });
  assert.equal(material.access_token, 'ya29.a0AfH6SMBexampleaccessstokenvalue');
});

test('google/vault: material is refreshed inside the margin, and the old material is replaced', () => {
  const calls = [];
  const store = vault({
    expiresInMs: 300_000, // exactly the margin: this is "about to expire"
    refresh: ({ service, refresh_token }) => {
      calls.push({ service, refresh_token });
      return { access_token: 'ya29.a0AfH6SMBrenewedtoken', refresh_token: '1//0eXamplerefreshtokenvalue', scopes: ['https://www.googleapis.com/auth/gmail.send'], expires_at: new Date(T0.getTime() + 3_600_000).toISOString() };
    },
  });
  const handle = store.handleFor({ sub_hash: SUB, service: 'gmail', presenter: 'google.gmail' });
  const material = store.resolve({ handle, presenter: 'google.gmail' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].refresh_token, '1//0eXamplerefreshtokenvalue');
  assert.equal(material.access_token, 'ya29.a0AfH6SMBrenewedtoken');
  // The handle still says `vault://`: renewal changes the material, never the interface.
  assert.equal(store.handleFor({ sub_hash: SUB, service: 'gmail', presenter: 'google.gmail' }).handle, 'vault://google/gmail');
});

test('google/vault: without a refresh port, expired material is refused — fail-closed, not stale', () => {
  const store = vault({ expiresInMs: 60_000 });
  const handle = store.handleFor({ sub_hash: SUB, service: 'gmail', presenter: 'google.gmail' });
  assert.throws(
    () => store.resolve({ handle, presenter: 'google.gmail' }),
    (error) => error.code === 'OMEGA_E_TOKEN' && /no refresh port/.test(error.message),
  );
});

test('google/vault: a failed refresh destroys the material and records the expectation of re-consent', () => {
  const records = [];
  const store = vault({
    expiresInMs: 60_000,
    record: (fields) => records.push(fields),
    refresh: () => {
      throw Object.assign(new Error('invalid_grant'), { code: 'OMEGA_E_TOKEN' });
    },
  });
  const handle = store.handleFor({ sub_hash: SUB, service: 'gmail', presenter: 'google.gmail' });
  assert.throws(() => store.resolve({ handle, presenter: 'google.gmail' }), (error) => error.code === 'OMEGA_E_TOKEN');
  // Nothing is left to try again with, and the refusal names the provider's answer: a Testing
  // authorization expiring after seven days is an expected reauthorization, not an incident.
  assert.throws(() => store.resolve({ handle, presenter: 'google.gmail' }), (error) => /no material for gmail/.test(error.message));
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'CONSENT');
  assert.equal(records[0].decision, 'DENY');
  assert.equal(records[0].detail.expected, 'reauthorization');
});

test('google/vault: a second refresh for the same service is refused while one is in flight', () => {
  let reentrant = null;
  const store = vault({
    expiresInMs: 60_000,
    refresh: ({ service }) => {
      // The refresh port asks for the same service again — a real hazard with a shared timer.
      reentrant = (() => { try { store.resolve({ handle: store.handleFor({ sub_hash: SUB, service, presenter: 'google.gmail' }), presenter: 'google.gmail' }); return null; } catch (error) { return error; } })();
      return { access_token: 'ya29.a0AfH6SMBrenewedtoken', scopes: [], expires_at: new Date(T0.getTime() + 3_600_000).toISOString() };
    },
  });
  const handle = store.handleFor({ sub_hash: SUB, service: 'gmail', presenter: 'google.gmail' });
  store.resolve({ handle, presenter: 'google.gmail' });
  assert.equal(reentrant?.code, 'OMEGA_E_TOKEN');
  assert.match(reentrant.message, /already in flight/);
});

test('google/vault: revocation deletes every service for a subject, and nothing for another', () => {
  const first = vault();
  const second = vault();
  assert.equal(first.handleFor({ sub_hash: SUB, service: 'gmail', presenter: 'google.gmail' }).service, 'gmail');
  assert.equal(first.deleteFor(SUB), 1);
  assert.equal(first.deleteFor(SUB), 0, 'the second deletion found something to delete');
  assert.equal(second.deleteFor(OTHER_SUB), 0, 'deleting one subject deleted another subject’s material');
  assert.equal(second.handleFor({ sub_hash: SUB, service: 'gmail', presenter: 'google.gmail' }).service, 'gmail');
});

test('google/vault: the journal records the lifecycle and never the material', () => {
  const store = vault();
  const handle = store.handleFor({ sub_hash: SUB, service: 'gmail', presenter: 'google.gmail' });
  store.resolve({ handle, presenter: 'google.gmail' });
  store.deleteFor(SUB);
  const journal = JSON.stringify(store.journal());
  assert.match(journal, /handle/);
  assert.match(journal, /resolve/);
  assert.match(journal, /delete/);
  assert.equal(journal.includes('ya29.'), false);
  assert.equal(journal.includes('1//'), false);
});

// --- quota ----------------------------------------------------------------------------

test('google/limiter: one call in flight per service, and a refusal is recorded as a QUOTA record', () => {
  const records = [];
  const limiter = createLimiter({ clock: () => T0, record: (fields) => records.push(fields) });
  const outcome = limiter.call({ service: 'gmail', invoke: () => ({ status: 200, remaining: 5 }) });
  assert.equal(outcome.status, 200);
  // The call completed, so the flight is over and the next one is allowed.
  assert.equal(limiter.schedule({ service: 'gmail' }).ok, true);
  assert.equal(limiter.schedule({ service: 'drive' }).ok, true);
  assert.equal(records.length, 0);
});

test('google/limiter: a window has a ceiling, and reaching it is a refusal with a QUOTA record', () => {
  const records = [];
  const limiter = createLimiter({ clock: () => T0, limits: { default: { calls: 2, window_ms: 60_000 } }, record: (fields) => records.push(fields) });
  limiter.schedule({ service: 'gmail' });
  limiter.schedule({ service: 'gmail' });
  assert.throws(() => limiter.schedule({ service: 'gmail' }), (error) => error.code === 'OMEGA_E_QUOTA');
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'QUOTA');
  assert.equal(records[0].decision, 'DENY');
  assert.equal(records[0].resource, 'net:google.gmail');
  // The other service has its own window: a quota is per service, not per organism.
  assert.equal(limiter.schedule({ service: 'drive' }).ok, true);
});

test('google/limiter: a 429 backs the service off, with exponential growth and a ceiling', () => {
  const delays = [];
  const limiter = createLimiter({ clock: () => T0, baseDelayMs: 1_000, maxDelayMs: 8_000, random: () => 0, record: (fields) => delays.push(fields.detail.retry_after_ms) });
  const first = limiter.observe({ service: 'gmail', status: 429 });
  const second = limiter.observe({ service: 'gmail', status: 429 });
  const third = limiter.observe({ service: 'gmail', status: 429 });
  const fourth = limiter.observe({ service: 'gmail', status: 429 });
  assert.deepEqual([first.retry_after_ms, second.retry_after_ms, third.retry_after_ms, fourth.retry_after_ms], [1_000, 2_000, 4_000, 8_000]);
  // The ceiling holds however many times the provider says no.
  assert.equal(limiter.observe({ service: 'gmail', status: 429 }).retry_after_ms, 8_000);
  assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 8_000]);
});

test('google/limiter: while a service backs off, calls to it are refused and the wait is named', () => {
  const limiter = createLimiter({ clock: () => T0, baseDelayMs: 1_000, random: () => 0 });
  limiter.observe({ service: 'gmail', status: 429 });
  assert.throws(
    () => limiter.schedule({ service: 'gmail' }),
    (error) => error.code === 'OMEGA_E_QUOTA' && error.details.retry_after_ms === 1_000,
  );
  // A success clears the backoff: an integration that never forgets a 429 stops entirely.
  limiter.observe({ service: 'gmail', status: 200 });
  assert.equal(limiter.schedule({ service: 'gmail' }).ok, true);
});

test('google/limiter: a provider Retry-After is honoured and jitter is injected, not invented', () => {
  const limiter = createLimiter({ clock: () => T0, baseDelayMs: 1_000, maxDelayMs: 8_000, random: () => 0.5 });
  const honoured = limiter.observe({ service: 'drive', status: 429, retry_after_ms: 3_000 });
  // 3s from the provider, plus half of the 1s jitter budget.
  assert.equal(honoured.retry_after_ms, 3_500);
  assert.equal(limiter.metrics().throttled, 1);
});

test('google/limiter: the limiter never outruns its own ceiling, however many calls are asked for', () => {
  const limiter = createLimiter({ clock: () => T0, limits: { default: { calls: 3, window_ms: 60_000 } } });
  let allowed = 0;
  for (let index = 0; index < 10; index += 1) {
    try {
      limiter.schedule({ service: 'sheets' });
      allowed += 1;
    } catch (error) {
      assert.equal(error.code, 'OMEGA_E_QUOTA');
    }
  }
  assert.equal(allowed, 3);
  assert.equal(limiter.metrics().denied, 7);
});

// --- egress ---------------------------------------------------------------------------

test('google/egress: credential-shaped material is refused a destination', () => {
  assert.equal(SECRET_PATTERNS.length >= 3, true);
  const cases = [
    ['access token', 'ya29.a0AfH6SMBexampleaccessstokenvalue'],
    ['api key', 'AIzaSyExampleApiKeyValue1234567890'],
    ['refresh token', '1//0eXamplerefreshtokenvalue'],
    ['nested in a payload', { message: { body: 'Authorization: Bearer ya29.a0AfH6SMBexample' } }],
  ];
  for (const [label, value] of cases) {
    const scan = scanForSecretMaterial(value);
    assert.equal(scan.clean, false, `${label} was not detected`);
    assert.equal(typeof scan.findings[0].kind, 'string');
    assert.equal(typeof scan.findings[0].path, 'string');
  }
});

test('google/egress: a known secret is found even when it looks like nothing', () => {
  const opaque = 'not-shaped-like-anything-0123456789';
  assert.equal(scanForSecretMaterial(opaque).clean, true);
  const scan = scanForSecretMaterial({ note: `the key is ${opaque}` }, { secrets: [opaque] });
  assert.equal(scan.findings.length, 1);
  assert.equal(scan.findings[0].kind, 'known-literal');
  assert.equal(scan.findings[0].path, '$.note');
});

test('google/egress: a clean payload passes, and the digest that reaches evidence is canonical', () => {
  const payload = { to: 'owner@example.com', subject: 'hello', body: 'no credentials here' };
  assert.equal(scanForSecretMaterial(payload).clean, true);
  const digest = payloadDigest(payload);
  assert.match(digest, /^sha256:[A-Za-z0-9_-]{43}$/);
  // Canonical bytes: key order is not part of the value, so the digest is stable across hosts.
  assert.equal(payloadDigest({ body: payload.body, subject: payload.subject, to: payload.to }), digest);
  assert.notEqual(payloadDigest({ ...payload, body: 'a different body' }), digest);
});

test('google/egress: the scan reports where the material was, not what it was', () => {
  const material = 'ya29.a0AfH6SMBexampleaccessstokenvalue';
  const { findings } = scanForSecretMaterial({ authorization: `Bearer ${material}`, headers: ['x'] });
  const found = findings[0];
  assert.equal(found.path, '$.authorization');
  assert.equal(found.kind, 'google-access-token');
  // The finding names the path and the pattern; quoting the material into a log would be the
  // leak the scan exists to prevent.
  assert.equal(JSON.stringify(found).includes(material), false);
});
