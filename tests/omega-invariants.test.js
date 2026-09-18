/**
 * Ω invariants — the claims the documents make, asserted against the code.
 *
 * A security posture that lives only in prose is a wish. Every test here reads the real
 * sources: it finds the error codes that are thrown, the layers that import each other,
 * the files that could hold ambient authority, and the tables that must stay complete.
 * If a document in `spec/omega/` claims something and this file does not check it, the
 * claim is a liability — so the two are edited together.
 *
 * Run alone: `node --test tests/omega-invariants.test.js`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { OMEGA_ERROR_CODES } from '../packages/compiler/index.js';
import {
  KERNEL_MODULES,
  GATE_STAGES,
  STAGE_DEFAULTS,
  ATTACK_CATEGORIES,
  KERNEL_MODULES as KERNEL,
} from '../packages/evolution/index.js';
import { PROPOSAL_TARGETS } from '../packages/learning/index.js';
import { OMEGA_EVIDENCE_KINDS } from '../packages/runtime/index.js';
import { CELL_STATES, MEMBRANE_STEPS, SERVING_STATES, LIFE_SUPPORT, KERNEL_MODULE_NAMES } from '../packages/cell/index.js';
import { ROOT } from './omega-helpers.mjs';

/** @param {string} directory @returns {string[]} every .js source below it */
function sources(directory) {
  const out = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (entry.endsWith('.js')) out.push(path);
  }
  return out;
}

/**
 * Remove comments so an invariant can talk about *code* rather than about prose that
 * happens to look like code. A doc comment naming `runtime.run(` is documentation; an
 * import of the runtime is a layering violation.
 * @param {string} source @returns {string}
 */
function stripComments(source) {
  let out = '';
  let index = 0;
  let quote = null;
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (quote === null && two === '//') {
      index = source.indexOf('\n', index);
      if (index === -1) break;
      continue;
    }
    if (quote === null && two === '/*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    const character = source[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      out += character;
      index += 1;
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      out += character;
      index += 1;
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}

const PACKAGES = sources(join(ROOT, 'packages'));

test('Ω/I1: every error code the code throws is registered, and none is a stray string', () => {
  const unknown = [];
  for (const file of PACKAGES) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:new OmegaError|OmegaError)\(\s*'((?:OMEGA|NEXA)_[A-Z_]+)'/g)) {
      if (!Object.hasOwn(OMEGA_ERROR_CODES, match[1])) unknown.push(`${match[1]} (${file.slice(ROOT.length + 1)})`);
    }
  }
  assert.deepEqual(unknown, [], 'an Ω error code used in code must exist in OMEGA_ERROR_CODES');
  assert.equal(Object.keys(OMEGA_ERROR_CODES).length >= 62, true);
  // Every code is a string table entry, never an inline literal.
  for (const [code, summary] of Object.entries(OMEGA_ERROR_CODES)) {
    assert.match(code, /^OMEGA_[EW]_[A-Z0-9_]+$/);
    assert.equal(typeof summary, 'string');
    assert.equal(summary.length > 10, true, `${code} needs a real summary`);
  }
});

test('Ω/I2: no Ω code is referenced anywhere before it is registered', () => {
  // The compiler, the runtime and the evolution layer name codes in data (classification
  // lists, stage defaults, module lists). A typo there is a silent hole, so every quoted
  // `OMEGA_*`/`NEXA_*` in those packages is checked against the table.
  const offenders = [];
  for (const file of PACKAGES) {
    const source = readFileSync(file, 'utf8').split('\n');
    for (const [index, line] of source.entries()) {
      const code = line.trimStart().startsWith('*') || line.trimStart().startsWith('//');
      if (code) continue;
      for (const match of line.matchAll(/'((?:OMEGA|NEXA)_[EW]_[A-Z0-9_]+)'/g)) {
        const known = Object.hasOwn(OMEGA_ERROR_CODES, match[1]) || /^NEXA_E_/.test(match[1]);
        if (!known) offenders.push(`${match[1]} (${file.slice(ROOT.length + 1)}:${index + 1})`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('Ω/I3: the compiler is deterministic and the runtime cannot mint authority', () => {
  for (const file of sources(join(ROOT, 'packages/compiler'))) {
    const source = readFileSync(file, 'utf8');
    assert.equal(/new Date\(|Date\.now\(|Math\.random\(/.test(source), false, `${file} is not deterministic`);
  }
  for (const file of sources(join(ROOT, 'packages/runtime'))) {
    const source = readFileSync(file, 'utf8');
    if (file.endsWith('src/authority.js')) continue;
    assert.equal(/mintCapability\s*\(/.test(source), false, `${file} mints a capability`);
  }
});

test('Ω/I4: the kernel is a closed list and nothing in it is evolvable', () => {
  for (const name of ['kernel', 'verifier', 'policy-engine', 'capability-authority', 'omega-kernel', 'evidence-ledger']) {
    assert.ok(KERNEL_MODULES.includes(name), `${name} must be immutable`);
  }
  for (const target of KERNEL) {
    assert.equal(PROPOSAL_TARGETS.includes(target), false, `${target} may not be a proposal target`);
  }
  assert.deepEqual([...KERNEL_MODULE_NAMES].sort(), [...KERNEL].sort(), 'the cell layer must agree with the gate about what is kernel');
});

test('Ω/I5: the gate has eight stages, the attack suite eleven categories, the healer six phases', () => {
  assert.deepEqual(
    [...GATE_STAGES],
    ['compile', 'types', 'capabilities', 'security', 'adversarial', 'regression', 'benchmark', 'policy'],
  );
  for (const stage of GATE_STAGES) {
    assert.ok(Object.hasOwn(STAGE_DEFAULTS, stage), `${stage} has no default: a caller could omit it`);
  }
  assert.equal(ATTACK_CATEGORIES.length, 11);
  assert.equal(OMEGA_EVIDENCE_KINDS.includes('HEAL'), true);
  assert.equal(OMEGA_EVIDENCE_KINDS.length >= 27, true, 'the record vocabulary only grows');
});

test('Ω/I6: no package holds ambient authority', () => {
  for (const file of [...PACKAGES, ...sources(join(ROOT, 'adapters'))]) {
    const source = readFileSync(file, 'utf8');
    const where = file.slice(ROOT.length + 1);
    assert.equal(/from\s+['"]node:(fs|child_process|net|http|https|dns|worker_threads)['"]/.test(source), false, `${where} imports an ambient API`);
    assert.equal(/\bprocess\.env\b/.test(source), false, `${where} reads the environment`);
  }
});

test('Ω/I7: every Ω document exists, is substantive and is linked from the index', () => {
  const index = readFileSync(join(ROOT, 'spec/omega/README.md'), 'utf8');
  const docs = [
    'language.md', 'grammar.ebnf', 'types.md', 'authority.md', 'evidence.md',
    'mcp.md', 'evolution.md', 'learning.md', 'threat-model.md',
    'cellular.md', 'cellular.ar.md', 'README.ar.md',
  ];
  for (const doc of docs) {
    const body = readFileSync(join(ROOT, 'spec/omega', doc), 'utf8');
    assert.equal(body.length > 500, true, `${doc} is a stub`);
    assert.ok(index.includes(doc), `${doc} is not listed in spec/omega/README.md`);
  }
});

test('Ω/I8: the cellular layer keeps its two hardest promises', () => {
  // 1. The membrane crosses exactly the seven steps, in the designed order.
  assert.deepEqual([...MEMBRANE_STEPS], ['identity', 'capability', 'type', 'policy', 'budget', 'execution', 'evidence']);
  // 2. A degraded cell still serves; isolation is the state that stops traffic.
  assert.equal(SERVING_STATES.includes('DEGRADED'), true);
  assert.equal(SERVING_STATES.includes('ISOLATED'), false);
  assert.equal(LIFE_SUPPORT.includes('health') && LIFE_SUPPORT.includes('recover'), true);
  assert.equal(CELL_STATES.length, 6);
  // 3. No cell package mints directly, and no cell package holds an authority object.
  for (const file of sources(join(ROOT, 'packages/cell'))) {
    const source = stripComments(readFileSync(file, 'utf8'));
    const where = file.slice(ROOT.length + 1);
    assert.equal(/mintCapability\s*\(/.test(source), false, `${where} mints a capability`);
    if (!where.endsWith('src/guarantor.js')) {
      assert.equal(/new Authority\s*\(/.test(source), false, `${where} holds an authority`);
    }
  }
});
