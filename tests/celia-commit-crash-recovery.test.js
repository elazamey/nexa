/**
 * P03 tests 1-3 (see docs/design/p03-intent-log.md). Implemented first and
 * alone: the remaining cut points are only written once the WAL is proven.
 *
 * SIGKILL is real and comes from the parent at a NAMED cut point the child
 * announces, never on a setTimeout race. Each cut point runs repeatedly,
 * because passing once is not proof.
 *
 * Scope: process death on a POSIX local filesystem. NOT power-loss durability
 * beyond declared fsync barriers, and NOT independent recovery: the reader is
 * a module with explicit inputs, not a separate process.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createIdentity } from '../packages/identity/index.js';
import { mintCapability } from '../packages/capability/index.js';
import { buildEnvelope } from '../packages/protocol/index.js';
import { createTransactionalWorkspacePort } from '../tools/celia-workspace-port.mjs';
import { inspectWorkspaceCommit, workspaceCommitRoot } from '../tools/celia-workspace-commit-port.mjs';
import { workspaceCommitConstraints, workspaceCommitIntent, workspaceCommitResource } from '../tools/celia-workspace-commit-auth.mjs';
import { initializeCommitConsumptionStore } from '../tools/celia-commit-consumption-store.mjs';
import { activeIntentPath, inspectIntent, planRecovery } from '../tools/celia-commit-intent-log.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const childScript = fileURLToPath(new URL('./fixtures/celia-commit-crash-child.mjs', import.meta.url));
const RUNS = 3; // a SIGKILL that passes once is not proof

async function scenario(t, entries) {
  const parent = fs.mkdtempSync(join(tmpdir(), 'nexa-p03-parent-'));
  const root = join(parent, 'nexa-p03-root');
  const stateDirectory = join(parent, 'authority');
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  fs.mkdirSync(root, { mode: 0o700 });
  fs.mkdirSync(stateDirectory, { mode: 0o700 });
  for (const area of ['packages', 'tools']) {
    fs.cpSync(join(repository, area), join(root, area), {
      recursive: true,
      filter(path) {
        const stat = fs.lstatSync(path);
        const name = path.split('/').pop();
        return !stat.isSymbolicLink() && !name.startsWith('.') && name !== 'node_modules'
          && (stat.isDirectory() || /\.m?js$/.test(name) || name === 'package.json');
      },
    });
  }
  fs.cpSync(join(repository, 'package.json'), join(root, 'package.json'));
  const workspaceId = 'ws_p03_fixture';
  const port = createTransactionalWorkspacePort({ root });
  await port.createWorkspace('p03-fixture', { workspaceId });
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
  const issuer = createIdentity({ label: 'p03-issuer' });
  const caller = createIdentity({ label: 'p03-caller' });
  const audience = createIdentity({ label: 'p03-audience' });
  const config = {
    audience: audience.kid, capabilityIssuers: [issuer.kid],
    rules: [{ id: 'p03-grant', effect: 'ALLOW', resource: 'workspace_commit:*', actions: ['commit'], subjects: [caller.kid] }],
  };
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
  const requestFile = join(parent, 'request.json');
  fs.writeFileSync(requestFile, JSON.stringify({ config, request: { ...scope, authorization } }));

  /** Run the real committer in a child and SIGKILL it at a named cut point. */
  function runUntil(cutPoint) {
    const resultFile = join(parent, `result-${Math.random().toString(36).slice(2)}.json`);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [childScript, root, stateDirectory, cutPoint ?? ''], {
        cwd: root,
        env: {
          PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? '/tmp',
          P03_REQUEST_FILE: requestFile, P03_RESULT_FILE: resultFile,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const cuts = [];
      let err = '';
      let killed = false;
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timeout\n${err}`)); }, 25_000);
      child.stdout.on('data', () => {}); // port logging, deliberately ignored
      child.stderr.on('data', chunk => {
        err += chunk;
        for (const line of String(chunk).split('\n')) {
          if (line.startsWith('CUT ')) cuts.push(line.slice(4).split(' ')[0]);
          if (line.startsWith('PARKED ') && !killed) {
            killed = true;
            process.kill(child.pid, 'SIGKILL'); // real external kill, mid-transaction
          }
        }
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null;
        resolve({ cuts, stderr: err, signal, code, killed, result });
      });
      child.on('error', reject);
    });
  }
  const contents = () => Object.fromEntries(entries.map(([path]) => [path,
    fs.existsSync(join(root, path)) ? fs.readFileSync(join(root, path), 'utf8') : null]));
  return { root, stateDirectory, staging, runUntil, contents, targetRoot };
}

test('P03/1: the intent is durable before the first repository byte is written', async t => {
  const s = await scenario(t, [['a.txt', 'base A\n', 'new A\n'], ['b.txt', 'base B\n', 'new B\n']]);
  const run = await s.runUntil(null);
  assert.equal(run.result?.outcome, 'ALLOW', JSON.stringify(run.result) + run.stderr);
  const openIndex = run.cuts.indexOf('intent:after-rename');
  const firstWrite = run.cuts.indexOf('before-root-write');
  assert.ok(openIndex >= 0, `no intent write observed:\n${run.stderr}`);
  assert.ok(firstWrite >= 0, 'the committer must have written a target');
  assert.ok(openIndex < firstWrite,
    `the intent must be durable BEFORE the first root write (intent@${openIndex}, write@${firstWrite})`);
  // A completed transaction leaves no active intent behind.
  assert.equal(fs.existsSync(activeIntentPath(s.stateDirectory)), false, 'a committed transaction erases its intent');
  assert.deepEqual(s.contents(), { 'a.txt': 'new A\n', 'b.txt': 'new B\n' });
});

test('P03/2: SIGKILL right after the intent is opened leaves a detectable incomplete transaction', async t => {
  for (let attempt = 1; attempt <= RUNS; attempt++) {
    const s = await scenario(t, [['a.txt', 'base A\n', 'new A\n'], ['b.txt', 'base B\n', 'new B\n']]);
    const run = await s.runUntil('intent:after-rename');
    assert.equal(run.signal, 'SIGKILL', `attempt ${attempt}: the child must die by a real SIGKILL`);
    assert.equal(run.result, null, 'a killed process reports no result');
    // Nothing was applied yet, and the gap is visible from disk alone.
    assert.deepEqual(s.contents(), { 'a.txt': 'base A\n', 'b.txt': 'base B\n' },
      `attempt ${attempt}: no target may be applied before the intent is open`);
    const report = inspectIntent({ directory: s.stateDirectory, root: s.root, targetRoot: s.targetRoot });
    assert.equal(report.present, true, `attempt ${attempt}: the active intent must survive the crash`);
    assert.equal(report.unconfirmed, true, `attempt ${attempt}: the root must be unconfirmed`);
    assert.equal(report.intent.state, 'opened');
    assert.deepEqual(report.appliedPaths, [], 'no op may be marked applied');
    t.diagnostic(JSON.stringify({ attempt, state: report.intent.state, cuts: run.cuts.length }));
  }
});

test('P03/3: SIGKILL mid-apply records which targets were already applied', async t => {
  for (let attempt = 1; attempt <= RUNS; attempt++) {
    const s = await scenario(t, [['a.txt', 'base A\n', 'new A\n'], ['b.txt', 'base B\n', 'new B\n']]);
    // Park after the FIRST target write completes, so exactly one op is applied.
    const run = await s.runUntil('after-root-write');
    assert.equal(run.signal, 'SIGKILL', `attempt ${attempt}: real SIGKILL required`);
    const report = inspectIntent({ directory: s.stateDirectory, root: s.root, targetRoot: s.targetRoot });
    assert.equal(report.present, true);
    assert.equal(report.unconfirmed, true, `attempt ${attempt}: a mid-apply crash leaves an unconfirmed root`);
    assert.ok(['opened', 'applying'].includes(report.intent.state), `unexpected state ${report.intent.state}`);
    // The on-disk truth and the log must agree about what was applied.
    const observed = Object.entries(s.contents())
      .filter(([path, value]) => value === (path === 'a.txt' ? 'new A\n' : 'new B\n'))
      .map(([path]) => path);
    for (const path of report.appliedPaths) {
      assert.ok(observed.includes(path), `${path} is marked applied but the disk disagrees`);
    }
    assert.ok(observed.length <= 1, `attempt ${attempt}: the cut must land before the second target`);
    t.diagnostic(JSON.stringify({ attempt, state: report.intent.state, applied: report.appliedPaths, observed }));
  }
});

test('P03/recovery decision: only a provably untouched root is cleared automatically', async t => {
  const base = { present: true, unconfirmed: true, unreadable: false, appliedPaths: [],
    intent: { txId: 'tx1', state: 'opened', ops: [{ path: 'a.txt', fromDigest: 'sha256:AAA', toDigest: 'sha256:BBB', mode: 0o640 }] } };
  const digests = { 'a.txt': 'sha256:AAA' };
  // The provable "nothing happened" case is the ONLY automatic clear.
  assert.deepEqual(planRecovery(base, p => digests[p]), { action: 'clear', txId: 'tx1' });
  // Every other unconfirmed shape must stay blocked for an operator.
  assert.equal(planRecovery({ ...base, appliedPaths: ['a.txt'] }, p => digests[p]).reason, 'PARTIALLY_APPLIED');
  assert.equal(planRecovery({ ...base, unreadable: true, intent: null }, p => digests[p]).reason, 'INTENT_UNREADABLE');
  assert.equal(planRecovery({ ...base, intent: { ...base.intent, state: 'restoring' } }, p => digests[p]).reason, 'INTERRUPTED_RESTORE');
  assert.equal(planRecovery(base, () => 'sha256:CHANGED').reason, 'BASE_MOVED:a.txt');
  assert.equal(planRecovery(base, () => null).reason, 'BASE_MOVED:a.txt', 'a deleted base is a moved base');
  assert.equal(planRecovery(base, () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); }).action, 'block');
  assert.deepEqual(planRecovery({ present: false }, () => null), { action: 'none' });
  t.diagnostic('Recovery never rolls forward: the log holds digests, not payloads.');
});
