import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as dsl from '../packages/cells/celia/dsl/src/index.js';

test('celia dsl index exposes DSL_REGISTRY with compile+validate per DSL', () => {
  assert.equal(typeof dsl, 'object');
  assert.ok(dsl !== null);
  assert.ok(dsl.DSL_REGISTRY, 'DSL_REGISTRY must be exported');
  assert.ok(Object.keys(dsl.DSL_REGISTRY).length >= 10, 'at least 10 DSLs registered');
  for (const [name, entry] of Object.entries(dsl.DSL_REGISTRY)) {
    assert.equal(typeof entry.compile, 'function', name + ' must have compile()');
    assert.equal(typeof entry.validate, 'function', name + ' must have validate()');
  }
});

test('celia dsl index re-exports namespace modules', () => {
  for (const name of ['AIR', 'CtxQL', 'FlowDSL', 'CapLang', 'GuardDSL', 'NanoDSL', 'Speculative']) {
    assert.ok(dsl[name] !== undefined, name + ' namespace should be re-exported');
  }
});
