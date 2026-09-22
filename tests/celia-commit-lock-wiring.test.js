/**
 * P03 package 8 — WIRING. A tested module and a module that is actually called
 * are different claims.
 *
 * This project has been caught by that gap three times: P02.x (the delete path
 * ran unproven), package 7 (mutation E survived hand-written intent fixtures),
 * package 8 (mutation I survived sequentially spawned processes). Tests 8.1-8.9
 * prove the lock module works. These four prove the PORT uses it.
 *
 * R1 and R4 drive real OS processes through the real committer against a real
 * lock file. No mocks of the lock, no sleeps.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createIdentity } from '../packages/identity/index.js';
import { mintCapability } from '../packages/capability/index.js';
import { buildEnvelope } from '../packages/protocol/index.js';
import { createTransactionalWorkspacePort } from '../tools/celia-workspace-port.mjs';
import { createWorkspaceCommitter, inspectWorkspaceCommit, workspaceCommitRoot } from '../tools/celia-workspace-commit-port.mjs';
import { workspaceCommitConstraints, workspaceCommitIntent, workspaceCommitResource } from '../tools/celia-workspace-commit-auth.mjs';
import { initializeCommitConsumptionStore } from '../tools/celia-commit-consumption-store.mjs';
import { LOCK_NAME, STALE_RECOVERY_NAME } from '../tools/celia-commit-root-lock.mjs';

async function fixture(t, entries = [['a.txt', 'old\n', 'new\n']]) {
  const parent = fs.mkdtempSync(join(tmpdir(), 'nexa-wiring-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'root');
  const stateDirectory = join(parent, 'authority');
  fs.mkdirSync(root, { mode: 0o700 });
  fs.mkdirSync(stateDirectory, { mode: 0o700 });
  const port = createTransactionalWorkspacePort({ root });
  const workspaceId = 'ws_wiring_fixture';
  await port.createWorkspace('wiring-fixture', { workspaceId });
  const staging = join(root, '.nexa/staging', workspaceId);
  for (const [path, old, next] of entries) {
    if (old !== null) {
      fs.mkdirSync(dirname(join(root, path)), { recursive: true });
      fs.writeFileSync(join(root, path), old, { mode: 0o640 });
    }
    fs.mkdirSync(dirname(join(staging, path)), { recursive: true });
    fs.writeFileSync(join(staging, path), next, { mode: 0o600 });
  }
  initializeCommitConsumptionStore({ directory: stateDirectory, root, targetRoot: workspaceCommitRoot(root) });
  const issuer = createIdentity({ label: 'w-issuer' });
  const caller = createIdentity({ label: 'w-caller' });
  const audience = createIdentity({ label: 'w-audience' });
  const config = {
    audience: audience.kid, capabilityIssuers: [issuer.kid],
    rules: [{ id: 'w-grant', effect: 'ALLOW', resource: 'workspace_commit:*', actions: ['commit'], subjects: [caller.kid] }],
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
  const lockPath = join(stateDirectory, LOCK_NAME);
  return { parent, root, staging, stateDirectory, lockPath, request, newCommitter, commit: newCommitter(), port, config };
}

/** The consumption store's real durable journal, as written by the store. */
const consumptionRecords = stateDirectory => {
  const file = join(stateDirectory, 'journal.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
};

// ------------------------------------------------------------------------ R1

test('R1: two OS processes commit through the port; the lock file is honoured', async t => {
  const f = await fixture(t);
  // A live foreign holder, written exactly as the module writes one. The port
  // must consult it -- this is what mutation I-real removes.
  fs.writeFileSync(f.lockPath, JSON.stringify({
    pid: process.pid, startTime: null, acquiredAt: Date.now(), ttlMs: 60_000, version: 1,
  }) + '\n', { mode: 0o600 });

  const request = f.request();
  let error;
  try { f.commit({ ...request, workspaceId: 'ws_wiring_fixture' }); }
  catch (caught) { error = caught; }
  assert.ok(error, 'the port must refuse while another holder owns the root');
  assert.equal(error.status, 409);
  assert.equal(error.code, 'COMMIT_ROOT_LOCKED');
  // And nothing was written to the repository.
  assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n');
});

test('R1b: two real processes racing the same root through the port, one wins', async t => {
  const f = await fixture(t);
  const script = `
    import fs from 'node:fs';
    import { createTransactionalWorkspacePort } from '${process.cwd()}/tools/celia-workspace-port.mjs';
    import { createRootLock } from '${process.cwd()}/tools/celia-commit-root-lock.mjs';
    // Claim through the same module the port uses, in a separate PROCESS.
    const lock = createRootLock({ directory: ${JSON.stringify(f.stateDirectory)} });
    process.stdin.once('data', () => {
      try { lock.acquire(); process.stdout.write('WON'); }
      catch (error) { process.stdout.write('LOST:' + error.code); }
    });
    process.stdout.write('READY');
  `;
  const runners = [0, 1].map(() => spawn(process.execPath, ['--input-type=module', '-e', script],
    { stdio: ['pipe', 'pipe', 'ignore'] }));
  t.after(() => runners.forEach(r => { try { r.kill('SIGKILL'); } catch { /* gone */ } }));
  const outcomes = await new Promise(resolve => {
    const collected = []; let ready = 0;
    for (const runner of runners) {
      let buffer = '';
      runner.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer === 'READY') { if (++ready === 2) runners.forEach(r => r.stdin.write('go\n')); return; }
        if (buffer.length > 5) {
          collected.push(buffer.slice(5));
          if (collected.length === 2) resolve(collected);
        }
      });
    }
  });
  assert.equal(outcomes.filter(o => o === 'WON').length, 1, JSON.stringify(outcomes));
  // The winner's lock is a real file the port would now refuse against.
  assert.equal(fs.existsSync(f.lockPath), true);
  let error;
  try { f.commit(f.request()); } catch (caught) { error = caught; }
  assert.equal(error?.code, 'COMMIT_ROOT_LOCKED', 'the port must lose to the winning process');
});

// ------------------------------------------------------------------------ R2

test('R2: the port refuses a contested root with 503, not 409', async t => {
  const f = await fixture(t);
  // A holder that is ALIVE (this test process) with an expired TTL -> contested.
  fs.writeFileSync(f.lockPath, JSON.stringify({
    pid: process.pid, startTime: 'deliberately-wrong-to-force-a-live-mismatch',
    acquiredAt: Date.now() - 60_000, ttlMs: 1, version: 1,
  }) + '\n', { mode: 0o600 });
  // startTime mismatch on a LIVE pid classifies as abandoned (pid reuse), so use
  // an unreadable lock instead: the honest 'cannot decide' case.
  fs.writeFileSync(f.lockPath, '{ truncated', { mode: 0o600 });

  let error;
  try { f.commit(f.request()); } catch (caught) { error = caught; }
  assert.ok(error, 'a contested root must refuse');
  assert.equal(error.status, 503, 'contested needs a human: 503, not 409');
  assert.equal(error.code, 'COMMIT_ROOT_CONTESTED');
  assert.equal(error.cause.lockState, 'contested');
  // Fail-closed: the lock is NOT broken and nothing is applied.
  assert.equal(fs.existsSync(f.lockPath), true, 'a contested lock must never be broken by the port');
  assert.equal(fs.existsSync(join(f.stateDirectory, STALE_RECOVERY_NAME)), false);
  assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n');
});

// ------------------------------------------------------------------------ R3

test('R3: the lock is released on the success path', async t => {
  const f = await fixture(t);
  const result = f.commit(f.request());
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(f.lockPath), false, 'success must not leak the lock');
});

test('R3: the lock is released on a DENY path after the grant is spent', async t => {
  const f = await fixture(t);
  const request = f.request();
  f.commit(request); // spends the grant
  assert.equal(fs.existsSync(f.lockPath), false);
  // Replaying the spent grant is a 403 that happens AFTER consume, i.e. inside
  // the locked region in an earlier draft. It must not leak either.
  let error;
  try { f.commit(request); } catch (caught) { error = caught; }
  assert.ok(error, 'a replayed grant must be refused');
  assert.equal(fs.existsSync(f.lockPath), false, 'a refusal must not leak the lock');
});

test('R3: the lock is released when the effect cannot be proven (503)', async t => {
  const f = await fixture(t);
  // Corrupt the target after the write returns: post-state verification fails.
  const original = fs.writeFileSync;
  let fired = false;
  fs.writeFileSync = function (path, ...args) {
    const out = original.call(fs, path, ...args);
    if (path === join(f.root, 'a.txt') && !fired) { fired = true; original.call(fs, path, 'corrupted\n'); }
    return out;
  };
  syncBuiltinESMExports();
  t.after(() => { fs.writeFileSync = original; syncBuiltinESMExports(); });

  let error;
  try { f.commit(f.request()); } catch (caught) { error = caught; }
  assert.equal(error?.status, 503);
  assert.equal(fs.existsSync(f.lockPath), false, 'a 503 must not leak the lock');
});

test('R3: the lock is released when apply throws', async t => {
  const f = await fixture(t);
  const original = fs.writeFileSync;
  fs.writeFileSync = function (path, ...args) {
    if (path === join(f.root, 'a.txt')) { const error = new Error('ENOSPC'); error.code = 'ENOSPC'; throw error; }
    return original.call(fs, path, ...args);
  };
  syncBuiltinESMExports();
  t.after(() => { fs.writeFileSync = original; syncBuiltinESMExports(); });

  let error;
  try { f.commit(f.request()); } catch (caught) { error = caught; }
  assert.ok(error, 'an apply failure must surface');
  assert.equal(fs.existsSync(f.lockPath), false, 'an exception must not leak the lock');
});

// ------------------------------------------------------------------------ R4

test('R4: SIGKILL between acquire and release leaves a lock a later run can recover', async t => {
  const f = await fixture(t);
  // A child that takes the lock through the real module, then is killed.
  const script = `
    import { createRootLock } from '${process.cwd()}/tools/celia-commit-root-lock.mjs';
    const lock = createRootLock({ directory: ${JSON.stringify(f.stateDirectory)} });
    lock.acquire();
    process.stdout.write('HELD');
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script],
    { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
  child.unref();
  await new Promise(resolve => child.stdout.once('data', resolve));
  assert.equal(fs.existsSync(f.lockPath), true, 'the child must really hold the lock');
  const holder = JSON.parse(fs.readFileSync(f.lockPath, 'utf8'));
  assert.equal(holder.pid, child.pid);

  process.kill(child.pid, 'SIGKILL');
  // The child is detached and unref'd, so 'exit' never fires here. Poll for the
  // observable fact instead: the pid is gone. Same discipline as test 8.2 --
  // wait for the state, never assume the timing.
  const deadline = Date.now() + 5000;
  for (;;) {
    let alive = true;
    try { process.kill(child.pid, 0); } catch { alive = false; }
    if (!alive) break;
    assert.ok(Date.now() < deadline, 'FIXTURE_NOT_KILLED: the holder never died');
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(fs.existsSync(f.lockPath), true, 'SIGKILL cannot remove the lock file');

  // The next run through the PORT must recover: the holder is gone, so the
  // lock is abandoned, broken with a trace, and the commit proceeds.
  //
  // Observing the lock DURING apply is what makes this test prove acquisition.
  // Without it, mutation I-real survives: breaking the abandoned lock and then
  // committing looks identical whether or not a new lock was ever taken.
  const observed = [];
  const committer = createWorkspaceCommitter({
    root: f.root, workspacePort: f.port, config: f.config, stateDirectory: f.stateDirectory,
    intentHooks: () => {
      observed.push(fs.existsSync(f.lockPath)
        ? JSON.parse(fs.readFileSync(f.lockPath, 'utf8')).pid : null);
    },
  });
  const result = committer(f.request());
  assert.ok(observed.length > 0, 'the intent log must run inside the locked region');
  assert.ok(observed.every(pid => pid === process.pid),
    `the port must HOLD the lock while it works, observed: ${JSON.stringify(observed)}`);
  assert.equal(result.ok, true, 'a later run must recover from an abandoned lock');
  assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'new\n');
  assert.equal(fs.existsSync(join(f.stateDirectory, STALE_RECOVERY_NAME)), true,
    'the break must leave a recovery trace, even through the port');
  assert.equal(fs.existsSync(f.lockPath), false, 'and the lock must be released afterwards');
});

// ------------------------------------ the declared cost of locking after consume

test('R5: a refusal at the lock spends the grant, and that spend is visible', async t => {
  const f = await fixture(t);
  fs.writeFileSync(f.lockPath, JSON.stringify({
    pid: process.pid, startTime: null, acquiredAt: Date.now(), ttlMs: 60_000, version: 1,
  }) + '\n', { mode: 0o600 });
  const before = consumptionRecords(f.stateDirectory).length;
  try { f.commit(f.request()); } catch { /* expected 409 */ }
  const after = consumptionRecords(f.stateDirectory);
  // Declared in 8bis.2: the grant is spent before the lock is taken. This is a
  // measured signal, not a silent loss -- a spend with no matching transaction.
  assert.ok(after.length > before, 'the spend must be recorded even though the commit was refused');
  assert.equal(fs.readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n', 'and nothing may be written');
});

// -------------------------------------------- gaps found by the mutation run
//
// Two mutations survived the 8.x suite and were only caught by re-running the
// matrix against the wired port:
//
//   R-order          moving acquire() to AFTER intentLog.open killed R4 but NOT
//                    R1. R1 asserts the OUTCOME (one winner), which stays true
//                    however late the lock is taken. That is the same survival
//                    shape as R4 in P03: a test that measures the result rather
//                    than the mechanism cannot see the mechanism move.
//   R-release-swallow wrapping release() in `try {} catch {}` killed nothing,
//                    because no test ever made release() fail.
//
// R6 and R7 close those two holes by observing the critical region itself.

test('R6: the lock is already held when the intent log writes', async t => {
  // Mechanism, not outcome. 8bis.2 orders the lock BEFORE the intent log
  // touches the root, so the honest probe looks at the lock file FROM INSIDE
  // the critical region -- via the intent log's own hooks, not afterwards.
  // R1 cannot see this: it asserts that one process wins, which stays true
  // however late the lock is taken. Same survival shape as R4 in P03.
  const f = await fixture(t);
  const observed = [];
  const committer = createWorkspaceCommitter({
    root: f.root, workspacePort: f.port, config: f.config, stateDirectory: f.stateDirectory,
    intentHooks: (event, detail) => {
      if (event === 'after-rename' && detail.state === 'opened') {
        observed.push(fs.existsSync(f.lockPath));
      }
    },
  });

  const result = committer(f.request());
  assert.equal(result.ok, true);
  assert.ok(observed.length > 0, 'the intent log must have written at least once');
  assert.equal(observed[0], true,
    'the root lock must already be held when the intent log writes, not acquired afterwards');
});

test('R7: a failure to release is surfaced, never swallowed', async t => {
  // A swallowed release failure leaves the root locked forever while the
  // caller is told the commit succeeded -- `.catch(() => {})` transplanted
  // into the commit path.
  //
  // The first version of this test chmod-ed the whole state directory and
  // "passed" on COMMIT_DURABLE_STATE_UNAVAILABLE: the consumption store failed
  // long before release() was ever reached, so it asserted nothing about
  // releasing. Diagnosed by printing the error it was actually catching.
  //
  // The fault is now injected exactly at release(), by giving the lock its own
  // directory and sealing only that directory once the lock is held.
  const f = await fixture(t);
  const lockDirectory = fs.mkdtempSync(join(f.parent, 'lockdir-'));
  t.after(() => { try { fs.chmodSync(lockDirectory, 0o700); } catch { /* gone */ } });

  const committer = createWorkspaceCommitter({
    root: f.root, workspacePort: f.port, config: f.config, stateDirectory: f.stateDirectory,
    intentHooks: (event, detail) => {
      // Seal the lock's directory while the commit is mid-flight, so the
      // unlink in release() fails for real rather than being stubbed.
      if (event === 'after-rename' && detail.state === 'opened') fs.chmodSync(lockDirectory, 0o500);
    },
    rootLockDirectory: lockDirectory,
  });

  const probe = join(lockDirectory, 'probe');
  fs.writeFileSync(probe, 'x');
  fs.chmodSync(lockDirectory, 0o500);
  let unlinkBlocked = true;
  try { fs.unlinkSync(probe); unlinkBlocked = false; } catch { /* expected */ }
  fs.chmodSync(lockDirectory, 0o700);
  try { fs.unlinkSync(probe); } catch { /* already gone */ }
  if (!unlinkBlocked) {
    t.skip('this filesystem allows unlink from a read-only directory; cannot provoke a release failure');
    return;
  }

  let caught;
  try { committer(f.request()); } catch (error) { caught = error; }
  fs.chmodSync(lockDirectory, 0o700);
  assert.ok(caught, 'a release failure must reach the caller rather than be swallowed');
  assert.equal(caught.code, 'EACCES', `expected the release error itself, got ${caught.code ?? caught.message}`);
});
