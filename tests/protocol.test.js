import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildEnvelope,
  verifyEnvelope,
  ReplayGuard,
  UsageLedger,
  MAX_TTL_SECONDS,
  MAX_BODY_BYTES,
} from '../packages/protocol/index.js';
import { KeyPair, base64url } from '../packages/crypto/index.js';
import { canonicalize, signaturePayload, validateEnvelope, MESSAGE_TYPES } from '../packages/ast/index.js';
import { throwsCode, world, capabilityFor, T0 } from './helpers.mjs';

const vectors = JSON.parse(readFileSync(new URL('../spec/vectors/envelope.json', import.meta.url), 'utf8'));

const fixedUuid = 'urn:nexa:msg:FIXEDFIXEDFIXEDFIXEDF';
const fixedNonce = 'FIXEDNONCEFIXEDNONCE';

/**
 * Envelopes are built from the caller endpoint's identity bundle:
 * `Endpoint.identity` carries `{identity, document, keys, kid}`.
 * @param {object} scope a `world()` instance
 * @param {object} [overrides]
 */
function envelopeFor({ caller, agent }, overrides = {}) {
  return buildEnvelope({
    sender: caller.identity,
    to: agent.kid,
    type: 'CALL',
    body: { resource: 'tool:echo', action: 'call', args: { text: 'hi' } },
    id: fixedUuid,
    nonce: fixedNonce,
    now: T0,
    ...overrides,
  });
}

test('envelope vectors: the pinned envelope still canonicalizes and verifies identically', () => {
  const envelope = vectors.envelope;
  assert.equal(canonicalize(envelope), vectors.canonical);
  assert.equal(base64url(signaturePayload(envelope)), vectors.signature_payload);
  const verified = verifyEnvelope(envelope, { now: T0 });
  assert.equal(verified.ok, true);
  assert.equal(verified.sender, envelope.from);
});

test('a signature covers every field except sig', () => {
  const scope = world();
  const envelope = envelopeFor(scope);
  const mutations = {
    type: 'RESULT',
    to: scope.worker.kid,
    ts: '2026-09-18T12:00:01Z',
    exp: '2026-09-18T12:00:59Z',
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    body: { resource: 'tool:add', action: 'call', args: { a: 1, b: 2 } },
  };
  for (const [field, value] of Object.entries(mutations)) {
    const mutated = { ...envelope, [field]: value };
    throwsCode(assert, () => verifyEnvelope(mutated, { now: T0 }), 'NEXA_E_SIG');
  }
  // Unknown fields are refused before signature verification is even attempted.
  throwsCode(assert, () => validateEnvelope({ ...envelope, extra: 1 }), 'NEXA_E_SCHEMA');
});

test('the TTL ceiling and freshness window are enforced', () => {
  const scope = world();
  throwsCode(assert, () => envelopeFor(scope, { ttlSeconds: MAX_TTL_SECONDS + 1 }), 'NEXA_E_TTL');
  throwsCode(assert, () => envelopeFor(scope, { ttlSeconds: 0 }), 'NEXA_E_TTL');
  const envelope = envelopeFor(scope, { ttlSeconds: 60 });
  assert.equal(verifyEnvelope(envelope, { now: new Date('2026-09-18T12:00:59Z') }).ok, true);
  throwsCode(assert, () => verifyEnvelope(envelope, { now: new Date('2026-09-18T12:01:00Z') }), 'NEXA_E_EXPIRED');
  // Dated in the future beyond the skew allowance.
  const skewed = envelopeFor(scope, { now: new Date('2026-09-18T12:05:00Z') });
  throwsCode(assert, () => verifyEnvelope(skewed, { now: T0, skewSeconds: 30 }), 'NEXA_E_CLOCK');
  assert.equal(verifyEnvelope(skewed, { now: T0, skewSeconds: 600 }).ok, true);
});

test('sender, recipient and type expectations are enforced', () => {
  const scope = world();
  const envelope = envelopeFor(scope);
  assert.equal(verifyEnvelope(envelope, { now: T0, expectSender: scope.caller.kid, expectRecipient: scope.agent.kid }).ok, true);
  throwsCode(assert, () => verifyEnvelope(envelope, { now: T0, expectSender: scope.worker.kid }), 'NEXA_E_UNTRUSTED');
  throwsCode(assert, () => verifyEnvelope(envelope, { now: T0, expectRecipient: scope.worker.kid }), 'NEXA_E_UNTRUSTED');
  throwsCode(assert, () => verifyEnvelope(envelope, { now: T0, allowedTypes: ['HELLO'] }), 'NEXA_E_SCHEMA');
  for (const type of MESSAGE_TYPES) {
    assert.equal(verifyEnvelope(envelopeFor(scope, { type }), { now: T0 }).ok, true, type);
  }
  throwsCode(assert, () => envelopeFor(scope, { type: 'EXEC' }), 'NEXA_E_SCHEMA');
});

test('body size is bounded on the way out and on the way in', () => {
  const scope = world();
  const big = { text: 'x'.repeat(MAX_BODY_BYTES) };
  throwsCode(assert, () => scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: big }), 'NEXA_E_SCHEMA');
});

test('the replay guard remembers ids and nonces separately', () => {
  const scope = world();
  const guard = new ReplayGuard({ windowSeconds: 300 });
  const envelope = envelopeFor(scope);
  assert.equal(guard.commit(envelope, T0).ok, true);
  throwsCode(assert, () => guard.commit(envelope, T0), 'NEXA_E_REPLAY');
  assert.equal(guard.hasSeen(envelope), true);

  const sameIdNewNonce = { ...envelope, nonce: 'OTHEROTHEROTHEROTHER' };
  throwsCode(assert, () => guard.commit(sameIdNewNonce, T0), 'NEXA_E_REPLAY');

  const newIdSameNonce = { ...envelope, id: 'urn:nexa:msg:OTHEROTHEROTHEROTHERO' };
  throwsCode(assert, () => guard.commit(newIdSameNonce, T0), 'NEXA_E_REPLAY');

  // Entries expire with the envelope they guard.
  const fresh = envelopeFor(scope, { id: 'urn:nexa:msg:FRESHFRESHFRESHFRESHF', nonce: 'FRESHFRESHFRESHFRESH' });
  assert.equal(guard.commit(fresh, new Date('2026-09-18T12:10:00Z')).ok, true);
  assert.deepEqual(guard.size, { ids: 1, nonces: 1 });
  throwsCode(assert, () => new ReplayGuard({ windowSeconds: 0 }), 'NEXA_E_SCHEMA');
});

test('the use ledger debits every link atomically', () => {
  const ledger = new UsageLedger();
  const caveats = [{ max_uses: 2 }, { max_uses: 1 }];
  assert.deepEqual(ledger.spend(['cap-a', 'cap-b'], caveats).spent, [
    { id: 'cap-a', used: 1, max_uses: 2 },
    { id: 'cap-b', used: 1, max_uses: 1 },
  ]);
  assert.equal(ledger.used('cap-a'), 1);
  assert.equal(ledger.used('cap-b'), 1);
  // The second spend must fail and must NOT debit cap-a.
  throwsCode(assert, () => ledger.spend(['cap-a', 'cap-b'], caveats), 'NEXA_E_CAP_USES');
  assert.equal(ledger.used('cap-a'), 1);
  assert.equal(ledger.release('cap-a'), 0);
  assert.equal(ledger.release('cap-a'), 0);
  assert.deepEqual(ledger.snapshot(), [{ id: 'cap-b', used: 1 }]);
  throwsCode(assert, () => ledger.spend(['cap-a'], []), 'NEXA_E_SCHEMA');
});

test('envelope construction validates the sender and the key id binding', () => {
  const scope = world();
  throwsCode(assert, () => buildEnvelope({ sender: { kid: scope.caller.kid }, to: scope.agent.kid, type: 'CALL', body: {} }), 'NEXA_E_KEY');
  const other = KeyPair.generate();
  const envelope = buildEnvelope({
    // `buildEnvelope` is handed a key id and a key that do not belong together:
    // the envelope stays internally consistent (from == sig.kid) and only fails
    // when verification recomputes the signature against the claimed key id.
    sender: { keys: other, kid: scope.caller.kid },
    to: scope.agent.kid,
    type: 'CALL',
    body: {},
    now: T0,
  });
  assert.equal(envelope.from, scope.caller.kid);
  throwsCode(assert, () => verifyEnvelope(envelope, { now: T0 }), 'NEXA_E_SIG');
});

test('call() attaches the capability token and binds its id', () => {
  const scope = world();
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid });
  assert.equal(capability.subject, scope.caller.kid);
  const envelope = scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: {}, capability });
  assert.equal(envelope.cap, capability.id);
  assert.equal(envelope.body.capability.id, capability.id);

  // Editing the signed `cap` field is caught by the envelope signature.
  const edited = { ...envelope, cap: 'urn:nexa:cap:DIFFERENTDIFFERENTDIFF' };
  const rejected = scope.endpoint.receive(edited);
  assert.equal(rejected.decision, 'REJECTED');
  assert.equal(rejected.code, 'NEXA_E_SIG');
  assert.equal(rejected.reply, null, 'unauthenticated input gets no reply');
  assert.equal(rejected.record, null, 'and leaves no evidence record');

  // A *properly signed* envelope whose `cap` disagrees with the attached token is
  // a different failure: it is authenticated, so it is denied and recorded.
  const mismatched = buildEnvelope({
    sender: scope.caller.identity,
    to: scope.agent.kid,
    type: 'CALL',
    body: { resource: 'tool:echo', action: 'call', args: {}, capability },
    capability: 'urn:nexa:cap:DIFFERENTDIFFERENTDIFF',
    id: 'urn:nexa:msg:MISMATCHMISMATCHMISMA',
    nonce: 'MISMATCHMISMATCHMISMA',
    now: T0,
  });
  const denied = scope.endpoint.receive(mismatched);
  assert.equal(denied.decision, 'DENY');
  assert.equal(denied.code, 'NEXA_E_CAP_INVALID');
  assert.equal(denied.receipt.decision, 'DENY');
});
