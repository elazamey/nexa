import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createIdentity } from '../packages/identity/index.js';
import { mintCapability } from '../packages/capability/index.js';
import { buildEnvelope } from '../packages/protocol/index.js';
import { createTransactionalWorkspacePort } from '../tools/celia-workspace-port.mjs';
import { createWorkspaceCommitter, inspectWorkspaceCommit, workspaceCommitRoot } from '../tools/celia-workspace-commit-port.mjs';
import { workspaceCommitIntent, workspaceCommitResource, workspaceCommitConstraints } from '../tools/celia-workspace-commit-auth.mjs';
import { initializeCommitConsumptionStore } from '../tools/celia-commit-consumption-store.mjs';
import { snapshot } from './celia-workspace-auth-helpers.mjs';
import { hardeningFixture } from './celia-commit-hardening-helpers.mjs';

const payloads = tree => new Map([...tree].filter(([name]) => !name.endsWith('::metadata')));
const ioError = () => Object.assign(new Error('injected test disk failure'), { code: 'ENOSPC' });
async function fixture(t, entries) {
  const parent = fs.mkdtempSync(join(tmpdir(), 'nexa-h2-recovery-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'root'), stateDirectory = join(parent, 'authority');
  fs.mkdirSync(root, { mode: 0o700 }); fs.mkdirSync(stateDirectory, { mode: 0o700 });
  const port = createTransactionalWorkspacePort({ root });
  const workspaceId = 'ws_h2_fixture';
  // Trusted fixture setup, not an assertion of authorization on legacy create.
  await port.createWorkspace('h2-fixture', { workspaceId });
  const staging = join(root, '.nexa/staging', workspaceId);
  for (const [path, old, next] of entries) {
    if (old !== null) { fs.mkdirSync(dirname(join(root, path)), { recursive: true }); fs.writeFileSync(join(root, path), old, { mode: 0o640 }); }
    fs.mkdirSync(dirname(join(staging, path)), { recursive: true }); fs.writeFileSync(join(staging, path), next, { mode: 0o600 });
  }
  fs.writeFileSync(join(root, 'untouched.txt'), 'unrelated\n');
  initializeCommitConsumptionStore({ directory: stateDirectory, root, targetRoot: workspaceCommitRoot(root) });
  const issuer = createIdentity({ label: 'h2-test-issuer' }), caller = createIdentity({ label: 'h2-test-caller' }), audience = createIdentity({ label: 'h2-test-audience' });
  const config = { audience: audience.kid, capabilityIssuers: [issuer.kid], rules: [{ id: 'h2-test-grant', effect: 'ALLOW', resource: 'workspace_commit:*', actions: ['commit'], subjects: [caller.kid] }] };
  function request() {
    const { targetRoot, changeSetHash, expectedBaseHash } = inspectWorkspaceCommit({ root, workspaceId });
    const scope = { workspaceId, targetRoot, changeSetHash, expectedBaseHash };
    const token = mintCapability({ issuer, subject: caller.kid, resource: workspaceCommitResource(scope), actions: ['commit'], constraints: workspaceCommitConstraints(scope), caveats: { max_uses: 1, max_depth: 0 } });
    const authorization = buildEnvelope({ sender: caller, to: audience.kid, type: 'CALL', capability: token.id, body: { resource: token.resource, action: 'commit', args: workspaceCommitIntent(scope), capability: token } });
    return { ...scope, authorization };
  }
  const newCommitter = () => createWorkspaceCommitter({ root, workspacePort: port, config, stateDirectory });
  return { root, staging, stateDirectory, request, newCommitter, commit: newCommitter() };
}
function inject(method, wrapper, run) {
  const original = fs[method]; fs[method] = wrapper(original); syncBuiltinESMExports();
  try { return run(); } finally { fs[method] = original; syncBuiltinESMExports(); }
}
function assertRestored(f, before, staged) {
  assert.deepEqual(payloads(snapshot(f.root)), payloads(before), 'payloads and topology must be restored');
  assert.deepEqual(snapshot(f.staging), staged, 'staging including metadata is untouched');
  assert.equal(fs.readFileSync(join(f.root, 'untouched.txt'), 'utf8'), 'unrelated\n');
}
for (const position of [0, 1, 2]) {
  test(`H2 recovery: failure at target ${position + 1} restores only attempted changes`, async t => {
    const paths = ['a.bin', 'b.bin', 'c.bin'];
    const f = await fixture(t, paths.map((p, i) => [p, Buffer.from([0, 255, i, 10]), Buffer.from([1, 254, i])]));
    const req = f.request(), before = snapshot(f.root), staged = snapshot(f.staging);
    let injected = false;
    inject('writeFileSync', original => function(path, ...args) {
      if (!injected && path === join(f.root, paths[position])) { injected = true; throw ioError(); }
      return original.call(fs, path, ...args);
    }, () => assert.throws(() => f.commit(req), { code: 'ENOSPC' }));
    assert.equal(injected, true); assertRestored(f, before, staged);
    for (const path of paths) assert.equal(fs.lstatSync(join(f.root, path)).mode & 0o777, 0o640);
    assert.equal(fs.readFileSync(join(f.stateDirectory, 'journal.jsonl'), 'utf8').trim().split('\n').length, 2);
    t.diagnostic(JSON.stringify({ faultAt: paths[position], restored: true, stagingUnchanged: true, consumptionRetained: true }));
  });
}
test('H2 recovery: partially written failing target is restored, not just successful previous writes', async t => {
  const f = await fixture(t, [['a.txt', 'original A', 'approved A'], ['b.txt', 'original B longer', 'approved B']]);
  const req = f.request(), before = snapshot(f.root), staged = snapshot(f.staging); let fired = false;
  inject('writeFileSync', original => function(path, ...args) {
    if (!fired && path === join(f.root, 'b.txt')) { fired = true; original.call(fs, path, 'partial'); throw ioError(); }
    return original.call(fs, path, ...args);
  }, () => assert.throws(() => f.commit(req), { code: 'ENOSPC' }));
  assert.equal(fired, true); assertRestored(f, before, staged);
});
test('H2 recovery: removes new files and only its own empty directories after apply failure', async t => {
  const f = await fixture(t, [['new/deep/a.txt', null, 'new A'], ['new/b.txt', null, 'new B'], ['z.txt', 'old Z', 'new Z']]);
  const req = f.request(), before = snapshot(f.root), staged = snapshot(f.staging); let fired = false;
  inject('writeFileSync', original => function(path, ...args) {
    if (!fired && path === join(f.root, 'z.txt')) { fired = true; throw ioError(); }
    return original.call(fs, path, ...args);
  }, () => assert.throws(() => f.commit(req), { code: 'ENOSPC' }));
  assert.equal(fired, true); assert.equal(fs.existsSync(join(f.root, 'new')), false); assertRestored(f, before, staged);
});
test('H2 recovery: directory creation fault restores earlier files and removes already-created empty ancestors', async t => {
  const f = await fixture(t, [['a.txt', 'old A', 'new A'], ['new/deep/b.txt', null, 'new B']]);
  const req = f.request(), before = snapshot(f.root), staged = snapshot(f.staging); let fired = false;
  inject('mkdirSync', original => function(path, ...args) {
    if (!fired && path === join(f.root, 'new/deep')) { fired = true; throw ioError(); }
    return original.call(fs, path, ...args);
  }, () => assert.throws(() => f.commit(req), { code: 'ENOSPC' }));
  assert.equal(fired, true); assertRestored(f, before, staged);
});
test('H2 recovery: failed rollback reports 503 and holds later authorized requests in this process', async t => {
  const f = await fixture(t, [['a.txt', 'old A', 'new A'], ['b.txt', 'old B', 'new B']]);
  const req = f.request(), staged = snapshot(f.staging); let fired = false;
  inject('writeFileSync', original => function(path, data, ...args) {
    if (!fired && path === join(f.root, 'b.txt')) { fired = true; throw ioError(); }
    if (fired && path === join(f.root, 'a.txt') && Buffer.from(data).toString() === 'old A') throw ioError();
    return original.call(fs, path, data, ...args);
  }, () => assert.throws(() => f.commit(req), error => error.status === 503 && error.code === 'COMMIT_RECOVERY_REQUIRED' && error.cause.rollbackFailures.length === 1));
  assert.equal(fired, true); assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'new A');
  assert.deepEqual(snapshot(f.staging), staged);
  // A fresh grant bound to the CURRENT (partially changed) base cannot bypass the latch.
  const fresh = f.request(), beforeDenied = snapshot(f.root);
  for (const commit of [f.commit, f.newCommitter()]) assert.throws(() => commit(fresh), error => error.status === 503 && error.code === 'COMMIT_RECOVERY_REQUIRED');
  assert.throws(() => f.commit({ ...fresh, authorization: undefined }), error => error.status === 401);
  assert.deepEqual(snapshot(f.root), beforeDenied);
  t.diagnostic('Recovery latch is process-local, not durable restart quarantine. P03 remains required.');
});
test('H2 recovery: positive authorized control writes real existing and nested new files', async t => {
  const entries = [['a.txt', 'old A', 'new A'], ['new/deep/b.bin', null, Buffer.from([0, 255, 1])]];
  const f = await fixture(t, entries), staged = snapshot(f.staging);
  const result = f.commit(f.request()); assert.equal(result.ok, true); assert.equal(result.changedFiles, 2);
  for (const [path, , content] of entries) assert.deepEqual(fs.readFileSync(join(f.root, path)), Buffer.from(content));
  assert.deepEqual(snapshot(f.staging), staged);
});
test('H2 recovery: original fault fixture rolls back without reviving spent authority after actual restart', { timeout: 35000 }, async t => {
  const f = await hardeningFixture(t), staged = snapshot(f.staging);
  const result = await f.commit('fail-second'); assert.equal(result.code, 'ENOSPC');
  assert.deepEqual(f.contents(), f.original); assert.deepEqual(snapshot(f.staging), staged);
  const oldPid = f.pid; await f.restart(); assert.notEqual(f.pid, oldPid);
  const old = await f.commit(); assert.equal(old.outcome, 'DENY'); assert.equal(old.status, 403);
  assert.deepEqual(f.contents(), f.original);
  const fresh = await f.commitRequest(f.freshRequest()); assert.equal(fresh.outcome, 'ALLOW'); assert.deepEqual(f.contents(), f.approved);
  t.diagnostic(JSON.stringify({ oldPid, newPid: f.pid, rollback: true, oldGrant: 'DENY', freshGrantSameChanges: 'ALLOW' }));
});
test('H2 recovery: restores original permission bits when the operating system clears them on write', async t => {
  const f = await fixture(t, [['a.txt', 'old A', 'new A'], ['b.txt', 'old B', 'new B']]);
  fs.chmodSync(join(f.root, 'a.txt'), 0o4640); // Non-executable owned fixture, not a privileged executable.
  const req = f.request(), before = snapshot(f.root), staged = snapshot(f.staging); let fired = false;
  inject('writeFileSync', original => function(path, ...args) {
    if (!fired && path === join(f.root, 'b.txt')) { fired = true; throw ioError(); }
    return original.call(fs, path, ...args);
  }, () => assert.throws(() => f.commit(req), { code: 'ENOSPC' }));
  assert.equal(fired, true); assertRestored(f, before, staged);
  assert.equal(fs.lstatSync(join(f.root, 'a.txt')).mode & 0o7777, 0o4640);
});
