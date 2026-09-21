/**
 * P02 — H3: external-writer concurrency.
 *
 * The boundary under test is the window between hash verification and target
 * mutation. These tests use REAL files, REAL signed authorizations and a REAL
 * allow policy; the competing writer is injected at the executor's own write
 * call site, which is the only scheduling point that matters. Nothing here
 * simulates the ALLOW/DENY decision itself.
 *
 * What passing means: a stale COMMIT refuses instead of overwriting, preserves
 * the competing edit, and applies none of its other targets. What it does NOT
 * mean: crash consistency, cross-process locking, or protection for a writer
 * that lands after the probe succeeds. Those remain P03.
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
  const parent = fs.mkdtempSync(join(tmpdir(), 'nexa-h3-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'root');
  const stateDirectory = join(parent, 'authority');
  fs.mkdirSync(root, { mode: 0o700 });
  fs.mkdirSync(stateDirectory, { mode: 0o700 });
  const port = createTransactionalWorkspacePort({ root });
  const workspaceId = 'ws_h3_fixture';
  await port.createWorkspace('h3-fixture', { workspaceId });
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
  const issuer = createIdentity({ label: 'h3-issuer' });
  const caller = createIdentity({ label: 'h3-caller' });
  const audience = createIdentity({ label: 'h3-audience' });
  const config = {
    audience: audience.kid, capabilityIssuers: [issuer.kid],
    rules: [{ id: 'h3-grant', effect: 'ALLOW', resource: 'workspace_commit:*', actions: ['commit'], subjects: [caller.kid] }],
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

/** Replace a competing writer at the executor's own write call site. */
function interpose(handler, run) {
  const original = fs.writeFileSync;
  fs.writeFileSync = function (path, ...args) { handler(path, original); return original.call(fs, path, ...args); };
  syncBuiltinESMExports();
  try { return run(); } finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
}

const concurrent = error => error.status === 403 && error.code === 'COMMIT_CONCURRENT_MODIFICATION';

test('H3: a competing edit to the first target is preserved and no other target is applied', async t => {
  const f = await fixture(t, [['a.txt', 'base A\n', 'approved A\n'], ['b.txt', 'base B\n', 'approved B\n']]);
  const req = f.request();
  const staged = snapshot(f.staging);
  let fired = false;
  interpose((path, original) => {
    if (fired || path !== join(f.root, 'a.txt')) return;
    fired = true;
    original.call(fs, path, 'external writer value\n');
  }, () => assert.throws(() => f.commit(req), concurrent));
  assert.equal(fired, true, 'the competing write must actually have happened');
  assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'external writer value\n', 'competing edit survives');
  assert.equal(fs.readFileSync(join(f.root, 'b.txt'), 'utf8'), 'base B\n', 'no other target may be applied');
  assert.deepEqual(snapshot(f.staging), staged, 'staging is untouched');
});

test('H3: a competing edit to a LATER target rolls back the already-applied earlier target', async t => {
  const f = await fixture(t, [['a.txt', 'base A\n', 'approved A\n'], ['b.txt', 'base B\n', 'approved B\n']]);
  const req = f.request();
  const before = snapshot(f.root);
  let fired = false;
  interpose((path, original) => {
    if (fired || path !== join(f.root, 'b.txt')) return;
    fired = true;
    original.call(fs, path, 'external writer value\n');
  }, () => assert.throws(() => f.commit(req), concurrent));
  assert.equal(fired, true);
  assert.equal(fs.readFileSync(join(f.root, 'b.txt'), 'utf8'), 'external writer value\n', 'competing edit survives');
  assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'base A\n', 'the earlier applied target must be rolled back');
  // Everything except the contended file must be byte-identical to the base.
  // b.txt is EXPECTED to differ: it holds the competing edit we refused to erase.
  const expected = payloads(before);
  expected.delete('b.txt');
  const after = payloads(snapshot(f.root));
  after.delete('b.txt');
  assert.deepEqual(after, expected, 'rollback must restore a.txt and touch nothing else');
  assert.equal(fs.lstatSync(join(f.root, 'a.txt')).mode & 0o7777, 0o640, 'rollback restores the original mode');
});

test('H3: deletion of a verified target during the window refuses and leaves no resurrected file', async t => {
  const f = await fixture(t, [['a.txt', 'base A\n', 'approved A\n'], ['b.txt', 'base B\n', 'approved B\n']]);
  const req = f.request();
  let fired = false;
  interpose((path) => {
    if (fired || path !== join(f.root, 'a.txt')) return;
    fired = true;
    fs.unlinkSync(path);
  }, () => assert.throws(() => f.commit(req), concurrent));
  assert.equal(fired, true);
  assert.equal(fs.existsSync(join(f.root, 'a.txt')), false, 'the probe must not resurrect a deleted target');
  assert.equal(fs.readFileSync(join(f.root, 'b.txt'), 'utf8'), 'base B\n');
});

test('H3: a same-size competing edit is caught by bytes, not by length or mtime', async t => {
  const f = await fixture(t, [['a.txt', 'base A\n', 'approved A\n']]);
  const req = f.request();
  let fired = false;
  interpose((path, original) => {
    if (fired || path !== join(f.root, 'a.txt')) return;
    fired = true;
    original.call(fs, path, 'BASE a\n'); // identical length to 'base A\n'
  }, () => assert.throws(() => f.commit(req), concurrent));
  assert.equal(fired, true);
  assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'BASE a\n');
});

test('H3: a competing mode change on verified bytes is refused', async t => {
  const f = await fixture(t, [['a.txt', 'base A\n', 'approved A\n']]);
  const req = f.request();
  let fired = false;
  interpose((path) => {
    if (fired || path !== join(f.root, 'a.txt')) return;
    fired = true;
    fs.chmodSync(path, 0o600); // fixture base mode is 0o640
  }, () => assert.throws(() => f.commit(req), concurrent));
  assert.equal(fired, true);
  assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'base A\n', 'bytes untouched by the refusal');
});

test('H3: positive control — an uncontended commit still applies every target', async t => {
  const f = await fixture(t, [['a.txt', 'base A\n', 'approved A\n'], ['new/deep/b.bin', null, Buffer.from([0, 255, 1])]]);
  const staged = snapshot(f.staging);
  const result = f.commit(f.request());
  assert.equal(result.ok, true);
  assert.equal(result.changedFiles, 2);
  assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'approved A\n');
  assert.deepEqual(fs.readFileSync(join(f.root, 'new/deep/b.bin')), Buffer.from([0, 255, 1]));
  assert.deepEqual(snapshot(f.staging), staged);
});

test('H3: the probe preserves the original mode on an uncontended existing target', async t => {
  const f = await fixture(t, [['a.txt', 'base A\n', 'approved A\n']]);
  f.commit(f.request());
  assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'approved A\n');
});

test('H3: a refused commit does not refund the consumed authorization', async t => {
  const f = await fixture(t, [['a.txt', 'base A\n', 'approved A\n']]);
  const req = f.request();
  let fired = false;
  interpose((path, original) => {
    if (fired || path !== join(f.root, 'a.txt')) return;
    fired = true;
    original.call(fs, path, 'external writer value\n');
  }, () => assert.throws(() => f.commit(req), concurrent));
  // Replaying the very same signed grant must stay denied, on this committer
  // and on a fresh one reading the same durable store.
  for (const commit of [f.commit, f.newCommitter()]) {
    assert.throws(() => commit(req), error => error.status === 403);
  }
  assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'external writer value\n');
  t.diagnostic('Consumed-on-refusal is intentional: the window was entered under real authority.');
});
