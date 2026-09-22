/**
 * Guard against counterfeit proof claims.
 *
 * principles.md P1: "a proof that is subtly wrong verifies successfully and
 * means nothing." The Z3 endpoint was exactly that -- it advertised
 * "Z3 SMT v4.12", returned verified:true for the contradiction x>0 |- x<0 and
 * for syntactic garbage, and its own comment said "Mock Z3 solving".
 *
 * These tests do not chase individual strings. They assert two structural
 * rules, so the next instance is caught without anyone remembering this one:
 *
 *   1. No module may name a real verifier product it does not run.
 *   2. Anything self-described as a mock must not emit verdict-shaped fields.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function sourceFiles(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (/\.(js|mjs|jsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}

const files = sourceFiles(ROOT).filter(f => !f.includes('/tests/'));

test('no module claims to run a solver this repository does not have', () => {
  // Zero runtime dependencies: there is no Z3, no CVC5, no SMT solver here.
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    // A version string is the giveaway: naming a product AND a version is a
    // claim to be running it, not a reference to the concept.
    if (/Z3 SMT v[\d.]+|CVC5 v[\d.]+|solver:\s*['"`]Z3/.test(source)
        // "Z3 proved X" asserts a solver produced the result, version or not.
        || /\b(Z3|CVC5|Coq|Isabelle|Lean)\s+(proved|verified|checked)\b/.test(source)) {
      offenders.push(file.replace(ROOT + '/', ''));
    }
  }
  assert.deepEqual(offenders, [],
    `these files claim to run a solver that is not installed:\n${offenders.join('\n')}`);
});

test('modules that describe themselves as mocks do not emit verdict fields', () => {
  // A mock is honest. A mock that returns `verified: true` is not a mock, it is
  // a counterfeit: callers read the field, never the comment beside it.
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const admitsMock = /\bMock (Z3|SMT|solver|solving)\b|Mock pass for demo/i.test(source);
    if (!admitsMock) continue;
    const emitsVerdict = /\bverified:\s*(true|allPassed|[a-zA-Z_$][\w$]*)/.test(source)
      || /_VERIFIED_|VERIFIED_SAT/.test(source);
    if (emitsVerdict) offenders.push(file.replace(ROOT + '/', ''));
  }
  assert.deepEqual(offenders, [],
    `these files admit to being mocks yet emit verdict-shaped fields:\n${offenders.join('\n')}`);
});

test('the removed z3 endpoint stays removed', () => {
  const server = fs.readFileSync(join(ROOT, 'tools/celia-dashboard-server.mjs'), 'utf8');
  assert.equal(/url\.pathname === '\/api\/v1\/omega\/z3\/verify'/.test(server), false,
    'the fake proof endpoint must not come back without a real verifier');
});

test('the screening engine reports no verdict at all', async () => {
  const { HeuristicCodeScreeningEngine } = await import(
    '../packages/cells/celia/omega/src/formal-z3-verification.js');
  const engine = new HeuristicCodeScreeningEngine();
  // The exact input that used to return verified:true.
  const result = engine.screen({ code: 'x=1', preconditions: ['x>0'], postconditions: ['x<0'] });
  for (const field of ['verified', 'proof', 'result', 'solver', 'counterExample']) {
    assert.equal(field in result, false, `'${field}' must not exist: it is read as a verdict`);
  }
  assert.equal(result.flagged, false, 'a substring scan finds nothing here, and says only that');
  assert.match(result.limits, /not evidence|Not verification/i, 'the limits must travel with the result');
});
