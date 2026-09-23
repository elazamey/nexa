import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyEnvelope } from '../packages/protocol/index.js';
import { snapshot } from './celia-workspace-auth-helpers.mjs';
import { hardeningFixture } from './celia-commit-hardening-helpers.mjs';

const options = { timeout: 35_000 };
const contentTree = entries => new Map([...entries].filter(([path]) => !path.endsWith('::metadata')));

test('COMMIT H1: a consumed authorization stays denied after restart even when the approved base returns', options, async t => {
  const f = await hardeningFixture(t);
  const firstPid = f.pid;
  const staged = snapshot(f.staging);
  const first = await f.commit();
  assert.equal(first.outcome, 'ALLOW', JSON.stringify(first));
  assert.deepEqual(f.contents(), f.approved, 'control: real first application must succeed');

  // ABA control: after a successful commit the base hash alone would normally
  // deny replay. Restore only base bytes so that H1 measures consumed authority,
  // NOT accidental protection from stale hashes or a missing workspace record.
  f.restoreBase();
  const { authorization, evidence: _evidence, ...approvedDescriptor } = f.request;
  assert.deepEqual(f.describe(), approvedDescriptor);
  const sameProcess = await f.commit();
  assert.equal(sameProcess.outcome, 'DENY', 'control: consumed grant must already fail in the old process');
  assert.equal(sameProcess.status, 403);
  assert.deepEqual(f.contents(), f.original);

  await f.restart();
  assert.notEqual(f.pid, firstPid, 'restart must be an actual new OS process');
  assert.deepEqual(f.describe(), approvedDescriptor, 'disk state and scope must still match the original approval');
  verifyEnvelope(authorization, { skewSeconds: 0 }); // not an expiry test
  const replay = await f.commit(); // exact same signed bytes and grant
  assert.deepEqual(snapshot(f.staging), staged, 'control: replay did not alter staging');
  t.diagnostic(JSON.stringify({ boundary: 'H1', firstPid, restartedPid: f.pid, sameProcess: sameProcess.outcome, afterRestart: replay.outcome, contents: f.contents() }));
  assert.deepEqual({ outcome: replay.outcome, status: replay.status ?? null, contents: f.contents(), staging: snapshot(f.staging) },
    { outcome: 'DENY', status: 403, contents: f.original, staging: staged },
    'restart must not revive an already-consumed COMMIT authorization');
});

test('COMMIT H2: disk failure on the second file cannot leave a half-applied root', options, async t => {
  const f = await hardeningFixture(t);
  const before = contentTree(snapshot(f.root));
  const staged = snapshot(f.staging);
  const result = await f.commit('fail-second');
  // Confirm the injection happened in the intended operation, not startup/auth.
  assert.equal(result.outcome, 'ERROR');
  assert.equal(result.code, 'ENOSPC');
  const appliedA = result.trace.findIndex(event => event.kind === 'write-applied' && event.file === 'a.txt');
  const failedB = result.trace.findIndex(event => event.kind === 'fault' && event.file === 'b.txt' && event.code === 'ENOSPC');
  assert.ok(appliedA >= 0 && failedB > appliedA, 'failure must follow a real first write; later rollback operations are allowed');
  assert.deepEqual(snapshot(f.staging), staged, 'control: I/O failure did not alter staging');
  t.diagnostic(JSON.stringify({ boundary: 'H2', outcome: result.outcome, code: result.code, trace: result.trace, contents: f.contents() }));
  // For failed atomic apply, require original payloads/topology, not impossible
  // restoration of ctime after a rollback. Staging metadata must stay unchanged.
  assert.deepEqual({ contents: f.contents(), tree: contentTree(snapshot(f.root)), staging: snapshot(f.staging) },
    { contents: f.original, tree: before, staging: staged },
    'a failed multi-file commit must not leave A applied while B remains old');
});

test('COMMIT H3: an external writer after hash verification must not be overwritten by stale commit bytes', options, async t => {
  const f = await hardeningFixture(t);
  const staged = snapshot(f.staging);
  const result = await f.commit('external-writer');
  const intervention = result.trace.find(event => event.kind === 'external-writer');
  assert.ok(intervention, 'test must reach the post-verification/pre-write scheduling point');
  assert.notEqual(intervention.pid, f.pid, 'the modifier is a separate OS process');
  assert.notEqual(intervention.pid, process.pid, 'the test runner is not the external writer');
  assert.equal(intervention.before, f.original['a.txt']);
  assert.equal(intervention.after, 'external writer value\n');
  assert.equal(result.trace[0].kind, 'external-writer', 'external mutation precedes any executor target write');
  assert.equal(readFileSync(join(f.root, 'untouched.txt'), 'utf8'), 'unrelated\n');
  assert.deepEqual(snapshot(f.staging), staged, 'control: competing writer/commit did not alter staging');
  t.diagnostic(JSON.stringify({ boundary: 'H3', commitPid: f.pid, outcome: result.outcome, trace: result.trace, contents: f.contents() }));
  assert.deepEqual({ outcome: result.outcome, status: result.status ?? null, contents: f.contents(), staging: snapshot(f.staging) },
    { outcome: 'DENY', status: 403, contents: { ...f.original, 'a.txt': 'external writer value\n' }, staging: staged },
    'a stale COMMIT must preserve the external edit and must not apply other target files');
});
