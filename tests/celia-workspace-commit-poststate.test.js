/**
 * P02.x — Post-State Verification.
 *
 * The executor used to return { ok: true } because writeFileSync did not throw.
 * A successful syscall is not proof that the intended effect exists on disk.
 * These tests require the committer to re-read every target it wrote and prove
 * the bytes match the verified change set before any success is reported.
 *
 * What passing means: the state the system re-read at the verification point
 * matched the authorized change set, and a failed effect is rolled back with
 * the rollback itself re-read and proven.
 *
 * What it does NOT mean: independent verification of the execution trace,
 * protection against an A -> B -> A mutation that is reverted before the
 * read-back, or crash recovery. Those remain H3-adjacent and P03.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createIdentity } from '../packages/identity/index.js';
import { mintCapability } from '../packages/capability/index.js';
import { buildEnvelope } from '../packages/protocol/index.js';
import { createTransactionalWorkspacePort } from '../tools/celia-workspace-port.mjs';
import { createWorkspaceCommitter, inspectWorkspaceCommit, workspaceCommitRoot } from '../tools/celia-workspace-commit-port.mjs';
import { workspaceCommitConstraints, workspaceCommitIntent, workspaceCommitResource } from '../tools/celia-workspace-commit-auth.mjs';
import { initializeCommitConsumptionStore } from '../tools/celia-commit-consumption-store.mjs';
import { snapshot } from './celia-workspace-auth-helpers.mjs';

const payloads = tree => new Map([...tree].filter(([name]) => !name.endsWith('::metadata')));

async function fixture(t, entries) {
  const parent = fs.mkdtempSync(join(tmpdir(), 'nexa-poststate-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'root');
  const stateDirectory = join(parent, 'authority');
  fs.mkdirSync(root, { mode: 0o700 });
  fs.mkdirSync(stateDirectory, { mode: 0o700 });
  const port = createTransactionalWorkspacePort({ root });
  const workspaceId = 'ws_poststate_fixture';
  await port.createWorkspace('poststate-fixture', { workspaceId });
  const staging = join(root, '.nexa/staging', workspaceId);
  for (const [path, old, next] of entries) {
    if (old !== null) {
      fs.mkdirSync(dirname(join(root, path)), { recursive: true });
      fs.writeFileSync(join(root, path), old, { mode: 0o640 });
    }
    fs.mkdirSync(dirname(join(staging, path)), { recursive: true });
    fs.writeFileSync(join(staging, path), next, { mode: 0o600 });
  }
  fs.writeFileSync(join(root, 'untouched.txt'), 'unrelated\n');
  initializeCommitConsumptionStore({ directory: stateDirectory, root, targetRoot: workspaceCommitRoot(root) });
  const issuer = createIdentity({ label: 'ps-issuer' });
  const caller = createIdentity({ label: 'ps-caller' });
  const audience = createIdentity({ label: 'ps-audience' });
  const config = {
    audience: audience.kid, capabilityIssuers: [issuer.kid],
    rules: [{ id: 'ps-grant', effect: 'ALLOW', resource: 'workspace_commit:*', actions: ['commit'], subjects: [caller.kid] }],
  };
  function request() {
    const { targetRoot, changeSetHash, expectedBaseHash } = inspectWorkspaceCommit({ root, workspaceId });
    const scope = { workspaceId, targetRoot, changeSetHash, expectedBaseHash };
    const token = mintCapability({
      issuer, subject: caller.kid, resource: workspaceCommitResource(scope), actions: ['commit'],
      constraints: workspaceCommitConstraints(scope), caveats: { max_uses: 1, max_depth: 0 },
    });
    const authorization = buildEnvelope({
      sender: caller, to: audience.kid, type: 'CALL', capability: token.id,
      body: { resource: token.resource, action: 'commit', args: workspaceCommitIntent(scope), capability: token },
    });
    return { ...scope, authorization };
  }
  const newCommitter = () => createWorkspaceCommitter({ root, workspacePort: port, config, stateDirectory });
  return { root, staging, stateDirectory, request, newCommitter, commit: newCommitter() };
}

/**
 * Corrupt a target AFTER the executor's write of it returns, which is exactly
 * the gap post-state verification must close. The syscall succeeded; the bytes
 * on disk are still wrong.
 */
function corruptAfterWrite(root, file, bytes, { alsoOnRestore = false } = {}) {
  const original = fs.writeFileSync;
  let fired = false;
  fs.writeFileSync = function (path, ...args) {
    const result = original.call(fs, path, ...args);
    if (path === join(root, file) && (alsoOnRestore || !fired)) {
      fired = true;
      original.call(fs, path, bytes);
    }
    return result;
  };
  syncBuiltinESMExports();
  return () => { fs.writeFileSync = original; syncBuiltinESMExports(); };
}

test('RED1/GREEN: ok:true is only returned after the written bytes are re-read and proven', async t => {
  const f = await fixture(t, [['a.txt', 'old A\n', 'new A\n'], ['b.txt', 'old B\n', 'new B\n']]);
  // Record the ordered stream of filesystem operations so we can require a read
  // of each target that happens strictly AFTER that target's apply write. The
  // H3 claim probe reads before the write, so it cannot satisfy this.
  const events = [];
  const originalRead = fs.readFileSync;
  const originalWrite = fs.writeFileSync;
  fs.readFileSync = function (path, ...args) { events.push(['read', String(path)]); return originalRead.call(fs, path, ...args); };
  fs.writeFileSync = function (path, ...args) {
    const out = originalWrite.call(fs, path, ...args);
    events.push(['write', String(path)]);
    return out;
  };
  syncBuiltinESMExports();
  let result;
  try { result = f.commit(f.request()); }
  finally { fs.readFileSync = originalRead; fs.writeFileSync = originalWrite; syncBuiltinESMExports(); }
  const reads = events.filter(([kind]) => kind === 'read').map(([, path]) => path);
  assert.equal(result.ok, true);
  // A declared postState field is not proof. Require that each target was read
  // from disk AFTER the staging read that produced its content, i.e. that a
  // genuine read-back happened rather than a reused capture.
  assert.equal(result.postState.verified, 2, 'every changed target must be proven');
  for (const path of ['a.txt', 'b.txt']) {
    const target = join(f.root, path);
    const applyWrite = events.findIndex(([kind, p]) => kind === 'write' && p === target);
    const readBack = events.findIndex(([kind, p], i) => kind === 'read' && p === target && i > applyWrite);
    assert.ok(applyWrite >= 0, `${path} must actually be written`);
    assert.ok(readBack > applyWrite,
      `${path} must be re-read from disk AFTER its apply write; a pre-write probe is not post-state proof`);
    assert.equal(fs.readFileSync(target, 'utf8'), path === 'a.txt' ? 'new A\n' : 'new B\n');
  }
  assert.ok(reads.length > 0);
  t.diagnostic(JSON.stringify(result.postState));
});

test('RED2: a target whose bytes differ after a successful write must not report success', async t => {
  const f = await fixture(t, [['a.txt', 'old A\n', 'new A\n'], ['b.txt', 'old B\n', 'new B\n']]);
  const req = f.request();
  const before = snapshot(f.root);
  const staged = snapshot(f.staging);
  const restore = corruptAfterWrite(f.root, 'b.txt', 'silently corrupted\n');
  try {
    assert.throws(() => f.commit(req), error => error.status === 503 && error.code === 'COMMIT_EFFECT_UNVERIFIED');
  } finally { restore(); }
  // The unverified effect must be rolled back, not left on disk as a half commit.
  assert.deepEqual(payloads(snapshot(f.root)), payloads(before), 'an unverified effect must be fully restored');
  assert.deepEqual(snapshot(f.staging), staged, 'staging is untouched');
  assert.equal(fs.readFileSync(join(f.root, 'untouched.txt'), 'utf8'), 'unrelated\n');
});

test('RED3: when the rollback of an unverified effect cannot itself be proven, recovery is unverified', async t => {
  const f = await fixture(t, [['a.txt', 'old A\n', 'new A\n']]);
  const req = f.request();
  // Corrupt on every write to this target, so the restore write is also wrong.
  const restore = corruptAfterWrite(f.root, 'a.txt', 'corrupted\n', { alsoOnRestore: true });
  try {
    assert.throws(() => f.commit(req), error => error.status === 503 && error.code === 'COMMIT_RECOVERY_UNVERIFIED');
  } finally { restore(); }
  // The latch must hold further authorized work in this process.
  const fresh = f.request();
  for (const commit of [f.commit, f.newCommitter()]) {
    assert.throws(() => commit(fresh), error => error.status === 503);
  }
  t.diagnostic('RECOVERY_UNVERIFIED is distinct from EFFECT_UNVERIFIED: the restore itself was not proven.');
});

test('post-state: a new file removed during rollback is proven gone, not assumed gone', async t => {
  const f = await fixture(t, [['fresh.txt', null, 'created\n'], ['a.txt', 'old A\n', 'new A\n']]);
  const req = f.request();
  const restore = corruptAfterWrite(f.root, 'a.txt', 'corrupted\n');
  try {
    assert.throws(() => f.commit(req), error => error.status === 503);
  } finally { restore(); }
  assert.equal(fs.existsSync(join(f.root, 'fresh.txt')), false, 'the created file must be proven removed');
});

test('post-state: the verification reads real bytes, not the in-memory buffer', async t => {
  const f = await fixture(t, [['a.txt', 'old A\n', 'new A\n']]);
  const req = f.request();
  // Truncate the file after the write returns; the buffer the executor holds is
  // still correct, so only a genuine disk read can catch this.
  const original = fs.writeFileSync;
  let truncated = false;
  fs.writeFileSync = function (path, ...args) {
    const out = original.call(fs, path, ...args);
    // Only the executor's apply write is sabotaged, so the rollback can succeed
    // and this stays a test of read-back, not of recovery failure.
    if (!truncated && path === join(f.root, 'a.txt')) { truncated = true; fs.truncateSync(path, 0); }
    return out;
  };
  syncBuiltinESMExports();
  try {
    assert.throws(() => f.commit(req), error => error.status === 503 && error.code === 'COMMIT_EFFECT_UNVERIFIED');
  } finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
  assert.equal(truncated, true, 'the sabotage must actually have run');
  assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old A\n', 'restored after the unverified effect');
});

test('post-state: positive control — an uncontended commit still succeeds and reports its proof', async t => {
  const entries = [['a.txt', 'old A\n', 'new A\n'], ['new/deep/b.bin', null, Buffer.from([0, 255, 1])]];
  const f = await fixture(t, entries);
  const staged = snapshot(f.staging);
  const result = f.commit(f.request());
  assert.equal(result.ok, true);
  assert.equal(result.changedFiles, 2);
  assert.equal(result.postState.verified, 2);
  for (const [path, , content] of entries) assert.deepEqual(fs.readFileSync(join(f.root, path)), Buffer.from(content));
  assert.deepEqual(snapshot(f.staging), staged);
});

test('post-state: verification does not refund the consumed authorization', async t => {
  const f = await fixture(t, [['a.txt', 'old A\n', 'new A\n']]);
  const req = f.request();
  const restore = corruptAfterWrite(f.root, 'a.txt', 'corrupted\n');
  try { assert.throws(() => f.commit(req), error => error.status === 503); }
  finally { restore(); }
  assert.throws(() => f.newCommitter()(req), error => error.status === 403 || error.status === 503);
});
