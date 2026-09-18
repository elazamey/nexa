#!/usr/bin/env node
/**
 * Regenerates `spec/vectors/*.json`.
 *
 * Vectors are pinned so that an implementation change that alters canonical form,
 * signature payloads or capability semantics fails loudly instead of silently
 * changing what a signature covers. Run: `node tools/vectors.mjs`.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize, signaturePayload, NexaError } from '../packages/ast/index.js';
import { KeyPair, sha256Multihash, base64url, base58btc } from '../packages/crypto/index.js';
import { createIdentityDocument } from '../packages/identity/src/document.js';
import { mintCapability, capabilityPayload } from '../packages/capability/src/token.js';
import { attenuate, verifyCapability } from '../packages/capability/src/attenuation.js';
import { buildEnvelope } from '../packages/protocol/src/envelope.js';
import { buildRejectionValue, REJECTION_FACTORIES } from './vector-cases.mjs';

/** [kind, expected error code] — the codes are asserted at generation time. */
const REJECTION_CASES = [
  ['float', 'NEXA_E_C14N_NUMBER'],
  ['float-in-array', 'NEXA_E_C14N_NUMBER'],
  ['nan', 'NEXA_E_C14N_NUMBER'],
  ['infinity', 'NEXA_E_C14N_NUMBER'],
  ['unsafe-integer', 'NEXA_E_C14N_NUMBER'],
  ['undefined', 'NEXA_E_C14N_TYPE'],
  ['bigint', 'NEXA_E_C14N_TYPE'],
  ['function', 'NEXA_E_C14N_TYPE'],
  ['date', 'NEXA_E_C14N_TYPE'],
  ['map', 'NEXA_E_C14N_TYPE'],
  ['set', 'NEXA_E_C14N_TYPE'],
  ['class-instance', 'NEXA_E_C14N_TYPE'],
  ['symbol', 'NEXA_E_C14N_TYPE'],
  ['lone-surrogate', 'NEXA_E_C14N_STRING'],
  ['lone-low-surrogate', 'NEXA_E_C14N_STRING'],
];
if (REJECTION_CASES.length !== Object.keys(REJECTION_FACTORIES).length) {
  throw new Error('every rejection factory must have a pinned error code');
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'spec', 'vectors');
mkdirSync(outDir, { recursive: true });

const SEEDS = {
  operator: '11'.repeat(32),
  agent: '22'.repeat(32),
  delegate: '33'.repeat(32),
};

const FIXED_INSTANT = new Date('2026-09-18T12:00:00Z');
const FIXED_MSG_ID = 'urn:nexa:msg:AAAAAAAAAAAAAAAAAAAAAA';
const FIXED_NONCE = 'AAAAAAAAAAAAAAAAAAAAAA';
const FIXED_CAP_ID = 'urn:nexa:cap:AAAAAAAAAAAAAAAAAAAAAA';
const FIXED_CHILD_ID = 'urn:nexa:cap:BBBBBBBBBBBBBBBBBBBBBB';

function canonicalVectors() {
  const cases = [
    { name: 'empty-object', input: {}, expected: '{}' },
    { name: 'empty-array', input: [], expected: '[]' },
    { name: 'key-order', input: { b: 1, a: 2, c: { z: 1, y: 2 } }, expected: '{"a":2,"b":1,"c":{"y":2,"z":1}}' },
    { name: 'integers', input: [0, -1, 9007199254740991, -9007199254740991], expected: '[0,-1,9007199254740991,-9007199254740991]' },
    { name: 'negative-zero', input: [-0], expected: '[0]' },
    { name: 'booleans-null', input: [true, false, null], expected: '[true,false,null]' },
    { name: 'string-escapes', input: { s: 'a"b\\c\nd\te\u0001' }, expected: '{"s":"a\\"b\\\\c\\nd\\te\\u0001"}' },
    { name: 'unicode-raw', input: { s: 'مرحبا 🚀 é' }, expected: '{"s":"مرحبا 🚀 é"}' },
    { name: 'nfc-normalization', input: { s: 'e\u0301' }, expected: '{"s":"é"}' },
    { name: 'nested', input: { a: [{ b: [1, 2, { c: null }] }] }, expected: '{"a":[{"b":[1,2,{"c":null}]}]}' },
  ];
  const rejections = REJECTION_CASES.map(([kind, code]) => ({ kind, code }));
  // Self-check before writing: a vector file that disagrees with the code is worse
  // than no vector file.
  for (const vector of cases) {
    const actual = canonicalize(vector.input);
    if (actual !== vector.expected) {
      throw new Error(`canonical vector "${vector.name}" drifted: ${actual} !== ${vector.expected}`);
    }
  }
  for (const vector of rejections) {
    try {
      canonicalize(buildRejectionValue(vector.kind));
      throw new Error(`canonical vector "${vector.name}" was expected to be rejected`);
    } catch (cause) {
      if (!(cause instanceof NexaError) || cause.code !== vector.code) {
        throw new Error(`canonical vector "${vector.kind}" produced ${cause.code ?? cause}, expected ${vector.code}`);
      }
    }
  }
  return { nexa: '0.1', generated_by: 'tools/vectors.mjs', cases, rejections };
}

function keyAndSignatureVectors() {
  const operator = KeyPair.fromSeed(SEEDS.operator);
  const agent = KeyPair.fromSeed(SEEDS.agent);
  const message = 'NEXA v0.1 test vector';
  const payload = Buffer.from(message, 'utf8');
  const seeds = Object.entries(SEEDS).map(([label, seed]) => {
    const keys = KeyPair.fromSeed(seed);
    return {
      label,
      seed_hex: seed,
      kid: keys.kid,
      public_key_b64u: keys.publicKeyB64u,
      public_key_multicodec_b58btc: base58btc(Buffer.concat([Buffer.from([0xed, 0x01]), keys.rawPublicKey])),
    };
  });
  const signature = operator.sign(payload);
  if (!operator.verify(payload, signature)) throw new Error('self-verification failed');
  return {
    nexa: '0.1',
    generated_by: 'tools/vectors.mjs',
    note: 'public keys are derived from the seeds; signatures are ed25519 over the raw message bytes',
    seeds,
    signing: [
      { label: 'operator-signs-message', message, kid: operator.kid, signature_b64u: signature },
      { label: 'agent-signs-message', message, kid: agent.kid, signature_b64u: agent.sign(payload) },
    ],
    hashes: [
      { label: 'sha256-of-message', input: message, hash: sha256Multihash(payload) },
      { label: 'sha256-of-empty', input: '', hash: sha256Multihash(Buffer.alloc(0)) },
    ],
  };
}

function envelopeVectors() {
  const operator = KeyPair.fromSeed(SEEDS.operator);
  const agent = KeyPair.fromSeed(SEEDS.agent);
  const envelope = buildEnvelope({
    sender: { keys: operator, kid: operator.kid },
    to: agent.kid,
    type: 'CALL',
    body: { resource: 'tool:echo', action: 'call', args: { text: 'hi' } },
    id: FIXED_MSG_ID,
    nonce: FIXED_NONCE,
    ttlSeconds: 60,
    now: FIXED_INSTANT,
  });
  return {
    nexa: '0.1',
    generated_by: 'tools/vectors.mjs',
    envelope,
    signature_payload: base64url(signaturePayload(envelope)),
    canonical: canonicalize(envelope),
  };
}

function identityVectors() {
  const operator = KeyPair.fromSeed(SEEDS.operator);
  const document = createIdentityDocument({
    identity: { kid: operator.kid },
    label: 'operator',
    kind: 'operator',
    scope: 'nexa:local',
    created: '2026-09-18T12:00:00Z',
    not_before: '2026-09-18T12:00:00Z',
    not_after: '2999-01-01T00:00:00Z',
    keys: operator,
  });
  return { nexa: '0.1', generated_by: 'tools/vectors.mjs', document };
}

function capabilityVectors() {
  const operator = KeyPair.fromSeed(SEEDS.operator);
  const agent = KeyPair.fromSeed(SEEDS.agent);
  const delegate = KeyPair.fromSeed(SEEDS.delegate);
  const parent = mintCapability({
    issuer: { keys: operator, kid: operator.kid },
    subject: agent.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: {
      nbf: '2026-09-18T11:00:00Z',
      exp: '2026-09-18T13:00:00Z',
      max_uses: 5,
      max_depth: 1,
    },
    constraints: { max_args_bytes: 1024, mode: ['safe', 'fast'] },
    id: FIXED_CAP_ID,
  });
  const child = attenuate(parent, {
    delegator: { keys: agent, kid: agent.kid },
    subject: delegate.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: {
      nbf: '2026-09-18T11:30:00Z',
      exp: '2026-09-18T12:30:00Z',
      max_uses: 2,
      max_depth: 0,
    },
    constraints: { max_args_bytes: 512, mode: ['safe'] },
    id: FIXED_CHILD_ID,
  });
  const parentPayload = base64url(capabilityPayload(parent));
  const grant = verifyCapability(parent, {
    presenter: agent.kid,
    now: FIXED_INSTANT,
    action: 'call',
    resource: 'tool:echo',
  }).grant;
  const childGrant = verifyCapability(child, {
    presenter: delegate.kid,
    now: FIXED_INSTANT,
  }).grant;
  return {
    nexa: '0.1',
    generated_by: 'tools/vectors.mjs',
    parent,
    parent_signature_payload: parentPayload,
    child,
    expectations: {
      parent_grant: grant,
      child_grant: childGrant,
    },
  };
}

const files = {
  'canonical.json': canonicalVectors(),
  'keys.json': keyAndSignatureVectors(),
  'envelope.json': envelopeVectors(),
  'identity.json': identityVectors(),
  'capability.json': capabilityVectors(),
};

for (const [name, payload] of Object.entries(files)) {
  writeFileSync(join(outDir, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote spec/vectors/${name}\n`);
}
