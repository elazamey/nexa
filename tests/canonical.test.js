import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { canonicalize, canonicalBytes, parseCanonical, NexaError } from '../packages/ast/index.js';
import { REJECTION_FACTORIES } from '../tools/vector-cases.mjs';
import { throwsCode } from './helpers.mjs';

const vectors = JSON.parse(readFileSync(new URL('../spec/vectors/canonical.json', import.meta.url), 'utf8'));

test('canonical vectors: accepted cases produce the pinned bytes', () => {
  for (const vector of vectors.cases) {
    assert.equal(canonicalize(vector.input), vector.expected, `vector ${vector.name}`);
  }
});

test('canonical vectors: rejected cases raise the pinned code', () => {
  for (const vector of vectors.rejections) {
    throwsCode(assert, () => canonicalize(REJECTION_FACTORIES[vector.kind]()), vector.code);
  }
});

test('keys are sorted by code unit, not by locale', () => {
  const value = { Z: 1, a: 2, A: 3, 'é': 4, _: 5 };
  assert.equal(canonicalize(value), '{"A":3,"Z":1,"_":5,"a":2,"é":4}');
});

test('canonicalization is idempotent and stable across re-parsing', () => {
  const value = { b: [1, { c: '\u00e9', d: 'x' }], a: 'y' };
  const once = canonicalize(value);
  const twice = canonicalize(JSON.parse(once));
  assert.equal(twice, once);
});

test('canonicalization output is UTF-8 encoded', () => {
  const bytes = canonicalBytes({ s: 'é' });
  assert.deepEqual([...bytes], [...Buffer.from('{"s":"é"}', 'utf8')]);
});

test('parseCanonical accepts canonical text and rejects everything else', () => {
  assert.deepEqual(parseCanonical('{"a":1,"b":[2,3]}'), { a: 1, b: [2, 3] });
  throwsCode(assert, () => parseCanonical('{"b":1,"a":2}'), 'NEXA_E_C14N_FORM');
  throwsCode(assert, () => parseCanonical('{"a": 1}'), 'NEXA_E_C14N_FORM');
  // `1.0` parses to the integer 1, so the failure is a form mismatch, not a type error.
  throwsCode(assert, () => parseCanonical('{"a":1.0}'), 'NEXA_E_C14N_FORM');
  throwsCode(assert, () => parseCanonical('{"a":1.5}'), 'NEXA_E_C14N_NUMBER');
  throwsCode(assert, () => parseCanonical('not json'), 'NEXA_E_PARSE');
  throwsCode(assert, () => parseCanonical('{"a":1,"a":2}'), 'NEXA_E_C14N_FORM');
});

test('nesting beyond 64 levels is refused instead of overflowing', () => {
  let deep = {};
  const root = deep;
  for (let index = 0; index < 70; index += 1) {
    deep.next = {};
    deep = deep.next;
  }
  throwsCode(assert, () => canonicalize(root), 'NEXA_E_C14N_TYPE');
});

test('NexaError refuses unknown codes', () => {
  assert.throws(() => new NexaError('NEXA_E_MADE_UP', 'nope'), /unknown NEXA error code/);
});
