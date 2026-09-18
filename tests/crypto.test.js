import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  KeyPair,
  base58btc,
  fromBase58btc,
  base64url,
  fromBase64url,
  keyIdFromRaw,
  rawFromKeyId,
  publicKeyFromKeyId,
  randomNonce,
  sha256Multihash,
  verifyWithKeyId,
} from '../packages/crypto/index.js';
import { parseInstant, formatInstant, addSeconds, compareInstant } from '../packages/ast/index.js';
import { throwsCode } from './helpers.mjs';

const vectors = JSON.parse(readFileSync(new URL('../spec/vectors/keys.json', import.meta.url), 'utf8'));

test('keys vectors: seeded key pairs reproduce the pinned key ids', () => {
  for (const vector of vectors.seeds) {
    const keys = KeyPair.fromSeed(vector.seed_hex);
    assert.equal(keys.kid, vector.kid, `kid for ${vector.label}`);
    assert.equal(keys.publicKeyB64u, vector.public_key_b64u, `public key for ${vector.label}`);
  }
});

test('keys vectors: signatures verify and are byte-identical to the pinned values', () => {
  const byKid = new Map(vectors.seeds.map((seed) => [seed.label, KeyPair.fromSeed(seed.seed_hex)]));
  for (const vector of vectors.signing) {
    const signer = ['operator', 'agent', 'worker', 'delegate']
      .map((label) => byKid.get(label))
      .find((keys) => keys !== undefined && keys.kid === vector.kid);
    assert.ok(signer, `no seeded key matches ${vector.kid}`);
    assert.equal(signer.sign(vector.message), vector.signature_b64u);
    assert.equal(verifyWithKeyId(vector.message, vector.signature_b64u, vector.kid), true);
  }
  for (const vector of vectors.hashes) {
    assert.equal(sha256Multihash(Buffer.from(vector.input, 'utf8')), vector.hash, `hash of ${vector.label}`);
  }
});

test('a key id is self-certifying: the public key is recoverable from it', () => {
  const keys = KeyPair.generate();
  const raw = rawFromKeyId(keys.kid);
  assert.equal(raw.length, 32);
  assert.equal(keyIdFromRaw(raw), keys.kid);
  assert.deepEqual(publicKeyFromKeyId(keys.kid).export({ format: 'der', type: 'spki' }), keys.publicKeyObject.export({ format: 'der', type: 'spki' }));
});

test('a signature does not verify under a different key', () => {
  const a = KeyPair.generate();
  const b = KeyPair.generate();
  const signature = a.sign('payload');
  assert.equal(b.verify('payload', signature), false);
  assert.equal(verifyWithKeyId('payload', signature, b.kid), false);
  assert.equal(verifyWithKeyId('other payload', signature, a.kid), false);
});

test('malformed signatures are rejected without throwing', () => {
  const keys = KeyPair.generate();
  assert.equal(keys.verify('payload', 'not base64url!!'), false);
  assert.equal(keys.verify('payload', base64url(Buffer.alloc(10))), false);
  assert.equal(verifyWithKeyId('payload', base64url(Buffer.alloc(64)), 'nexa:key:ed25519:zNOPE'), false);
});

test('base58btc round-trips, including leading zeros', () => {
  for (const hex of ['00', '0000ff', 'ed01deadbeef', 'ffffffffffffffff', '01']) {
    const bytes = Buffer.from(hex, 'hex');
    assert.deepEqual(fromBase58btc(base58btc(bytes)), bytes, hex);
  }
  assert.equal(base58btc(Buffer.from([0])), '1');
  assert.equal(base58btc(Buffer.alloc(0)), '');
  assert.throws(() => fromBase58btc('0OIl'), /invalid base58btc character/);
});

test('base64url round-trips and rejects foreign alphabets', () => {
  const bytes = Buffer.from('nexa/0.1', 'utf8');
  assert.deepEqual(fromBase64url(base64url(bytes)), bytes);
  assert.throws(() => fromBase64url('a+b='), /invalid base64url input/);
});

test('random ids and nonces have the expected shape and do not repeat', () => {
  const nonces = new Set();
  for (let index = 0; index < 200; index += 1) {
    const nonce = randomNonce();
    assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
    nonces.add(nonce);
  }
  assert.equal(nonces.size, 200);
});

test('instant helpers are strict about the RFC 3339 UTC shape', () => {
  assert.equal(formatInstant(new Date('2026-09-18T12:00:00.500Z')), '2026-09-18T12:00:00Z');
  assert.equal(addSeconds('2026-09-18T12:00:00Z', 90), '2026-09-18T12:01:30Z');
  assert.equal(compareInstant('2026-09-18T12:00:00Z', '2026-09-18T12:00:01Z'), -1);
  assert.equal(parseInstant('2026-09-18T12:00:00Z'), Date.parse('2026-09-18T12:00:00Z'));
  throwsCode(assert, () => parseInstant('2026-09-18T12:00:00.123Z'), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => parseInstant('2026-09-18T12:00:00+02:00'), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => parseInstant('yesterday'), 'NEXA_E_SCHEMA');
});
