import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createIdentity,
  createIdentityDocument,
  verifyIdentityDocument,
  identityFingerprint,
  TrustStore,
} from '../packages/identity/index.js';
import { KeyPair } from '../packages/crypto/index.js';
import { canonicalize, NexaError } from '../packages/ast/index.js';
import { throwsCode, SEEDS } from './helpers.mjs';

const vectors = JSON.parse(readFileSync(new URL('../spec/vectors/identity.json', import.meta.url), 'utf8'));

test('identity vectors: the pinned document still verifies', () => {
  const verified = verifyIdentityDocument(vectors.document);
  assert.equal(verified.ok, true);
  assert.equal(verified.kid, vectors.document.kid);
  assert.equal(verified.kind, 'operator');
});

test('an identity document is self-signed and tamper-evident', () => {
  const document = structuredClone(vectors.document);
  document.label = 'someone else';
  throwsCode(assert, () => verifyIdentityDocument(document), 'NEXA_E_SIG');

  const reordered = JSON.parse(canonicalize({ ...vectors.document }));
  assert.equal(verifyIdentityDocument(reordered).ok, true);
});

test('an identity cannot vouch for another key', () => {
  const other = KeyPair.fromSeed(SEEDS.outsider);
  const document = { ...structuredClone(vectors.document), kid: other.kid };
  throwsCode(assert, () => verifyIdentityDocument(document), 'NEXA_E_IDENTITY');
});

test('published key material must re-derive its own key id', () => {
  const document = structuredClone(vectors.document);
  document.keys[0].public_key = KeyPair.generate().publicKeyB64u;
  throwsCode(assert, () => verifyIdentityDocument(document), 'NEXA_E_IDENTITY');
  throwsCode(assert, () => verifyIdentityDocument({ ...structuredClone(vectors.document), extra: 1 }), 'NEXA_E_IDENTITY');
});

test('an identity document must be signed by the identity it describes', () => {
  const identity = createIdentity({ label: 'agent-01', kind: 'agent', seed: SEEDS.agent });
  const impostor = createIdentity({ label: 'impostor', seed: SEEDS.outsider });
  throwsCode(
    assert,
    () => createIdentityDocument({ identity: { kid: identity.kid }, label: 'agent-01', keys: impostor.keys }),
    'NEXA_E_IDENTITY',
  );
});

test('trust store: pin-or-reject, never implicit TOFU', () => {
  const store = new TrustStore();
  const agent = createIdentity({ label: 'agent', kind: 'agent', seed: SEEDS.agent });
  const outsider = createIdentity({ label: 'outsider', kind: 'peer', seed: SEEDS.outsider });

  throwsCode(assert, () => store.require(agent.kid), 'NEXA_E_UNTRUSTED');
  assert.equal(store.isTrusted(agent.kid), false);

  const pinned = store.pin(agent.document);
  assert.equal(pinned.kid, agent.kid);
  assert.equal(store.size, 1);
  assert.equal(store.isTrusted(agent.kid), true);

  throwsCode(assert, () => store.pin(agent.document, { expectKid: outsider.kid }), 'NEXA_E_UNTRUSTED');
  throwsCode(assert, () => store.pin(agent.document, { expectFingerprint: 'nexa:fp:wrong' }), 'NEXA_E_UNTRUSTED');
  assert.equal(store.pin(agent.document, { expectFingerprint: identityFingerprint(agent.document) }).kid, agent.kid);
});

test('revoking an identity keeps it untrusted even if re-presented', () => {
  const store = new TrustStore();
  const agent = createIdentity({ label: 'agent', kind: 'agent', seed: SEEDS.agent });
  store.pin(agent.document);
  store.revoke(agent.kid);
  assert.equal(store.isTrusted(agent.kid), false);
  assert.equal(store.list().length, 0);
  throwsCode(assert, () => store.require(agent.kid), 'NEXA_E_UNTRUSTED');
  // pinning again clears the revocation only because it requires a fresh out-of-band check
  store.pin(agent.document);
  assert.equal(store.isTrusted(agent.kid), true);
  throwsCode(assert, () => store.revoke('nexa:key:ed25519:zNOPE'), 'NEXA_E_UNTRUSTED');
});

test('fingerprints are stable, document-wide, and prefixed', () => {
  const agent = createIdentity({ label: 'agent', kind: 'agent', seed: SEEDS.agent });
  const fingerprint = identityFingerprint(agent.document);
  assert.match(fingerprint, /^nexa:fp:[1-9A-HJ-NP-Za-km-z]{24}$/);
  assert.equal(identityFingerprint(structuredClone(agent.document)), fingerprint);
  // Any change to the document changes the fingerprint — including metadata.
  const relabelled = createIdentityDocument({
    identity: { kid: agent.kid },
    label: 'renamed',
    kind: 'agent',
    seed: undefined,
    keys: agent.keys,
  });
  assert.notEqual(identityFingerprint(relabelled), fingerprint);
  // A tampered document cannot be fingerprinted at all: verification runs first.
  throwsCode(assert, () => identityFingerprint({ ...agent.document, label: 'x' }), 'NEXA_E_SIG');
});

test('NexaError instances carry a code and serialize cleanly', () => {
  const error = new NexaError('NEXA_E_GATE', 'blocked', { gate: 'TERMINAL' });
  assert.deepEqual(error.toJSON(), { code: 'NEXA_E_GATE', message: 'blocked', details: { gate: 'TERMINAL' } });
});
