/**
 * P03 tests 4-6 plus intent-log corruption, per sections 7bis / 7ter /
 * 7quater / 7quinquies of docs/design/p03-intent-log.md.
 *
 * These cut the SAME primitive — the intent log's atomic write
 * (write -> fsync(file) -> rename -> fsync(dir)) — at three points, which is
 * why they are one package. The assertions are the declared durability ladder,
 * NOT whatever the filesystem happens to do on this machine.
 *
 * Scope: process death on a POSIX local filesystem. No power-loss simulation.
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
const RUNS = 3;

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
  const issuer = createIdentity({ label: 'p03d-issuer' });
  const caller = createIdentity({ label: 'p03d-caller' });
  const audience = createIdentity({ label: 'p03d-audience' });
  const config = {
    audience: audience.kid, capabilityIssuers: [issuer.kid],
    rules: [{ id: 'p03d-grant', effect: 'ALLOW', resource: 'workspace_commit:*', actions: ['commit'], subjects: [caller.kid] }],
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
  function runUntil(cutPoint) {
    const resultFile = join(parent, `r-${Math.random().toString(36).slice(2)}.json`);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [childScript, root, stateDirectory, cutPoint ?? ''], {
        cwd: root,
        env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? '/tmp', P03_REQUEST_FILE: requestFile, P03_RESULT_FILE: resultFile },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const cuts = [];
      let err = '';
      let killed = false;
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timeout\n${err}`)); }, 25_000);
      child.stdout.on('data', () => {});
      child.stderr.on('data', chunk => {
        err += chunk;
        for (const line of String(chunk).split('\n')) {
          if (line.startsWith('CUT ')) cuts.push(line.slice(4).split(' ')[0]);
          if (line.startsWith('PARKED ') && !killed) { killed = true; process.kill(child.pid, 'SIGKILL'); }
        }
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ cuts, stderr: err, signal, code, result: fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null });
      });
      child.on('error', reject);
    });
  }
  const contents = () => Object.fromEntries(entries.map(([path]) => [path,
    fs.existsSync(join(root, path)) ? fs.readFileSync(join(root, path), 'utf8') : null]));
  const tempFiles = () => fs.readdirSync(stateDirectory).filter(name => name.includes('.tmp'));
  return { root, stateDirectory, runUntil, contents, targetRoot, tempFiles };
}

const pair = [['a.txt', 'base A\n', 'new A\n'], ['b.txt', 'base B\n', 'new B\n']];

test('P03/4: a cut before fsync leaves no uninterpretable state', async t => {
  // The contract, NOT a filesystem timing accident: either the intent is
  // readable and explains the disk, or it is absent and nothing was applied.
  for (let attempt = 1; attempt <= RUNS; attempt++) {
    const s = await scenario(t, pair);
    const run = await s.runUntil('intent:before-fsync');
    assert.equal(run.signal, 'SIGKILL', `attempt ${attempt}: real SIGKILL required`);
    const report = inspectIntent({ directory: s.stateDirectory, root: s.root, targetRoot: s.targetRoot });
    const applied = Object.entries(s.contents()).filter(([p, v]) => v === (p === 'a.txt' ? 'new A\n' : 'new B\n')).map(([p]) => p);
    if (!report.present) {
      // Allowed by the ladder: the intent write was lost before fsync. But then
      // nothing may have been applied, or the state would be unexplained.
      assert.deepEqual(applied, [], `attempt ${attempt}: a lost intent must mean no applied target`);
    } else {
      assert.equal(report.unreadable, false, 'a surviving intent must still parse');
      assert.equal(report.unconfirmed, true);
      for (const path of applied) {
        assert.ok(report.intent.ops.some(op => op.path === path),
          `${path} changed on disk but the intent does not mention it`);
      }
    }
    t.diagnostic(JSON.stringify({ attempt, present: report.present, state: report.intent?.state ?? null, applied }));
  }
});

test('P03/5: a cut after fsync but before rename leaves the old target and an orphan temp', async t => {
  for (let attempt = 1; attempt <= RUNS; attempt++) {
    const s = await scenario(t, pair);
    const run = await s.runUntil('intent:after-fsync');
    assert.equal(run.signal, 'SIGKILL');
    // The bytes are durable but invisible through the name: no target applied.
    assert.deepEqual(s.contents(), { 'a.txt': 'base A\n', 'b.txt': 'base B\n' },
      `attempt ${attempt}: a pre-rename cut must not apply any target`);
    const report = inspectIntent({ directory: s.stateDirectory, root: s.root, targetRoot: s.targetRoot });
    // The FIRST intent write is the open, so a cut there leaves no active
    // intent at all — only the orphan temp proves the attempt.
    assert.ok(s.tempFiles().length >= 1, `attempt ${attempt}: the orphan temp must remain for diagnosis`);
    assert.equal(report.present, false, 'the rename never happened, so no active intent exists');
    t.diagnostic(JSON.stringify({ attempt, temps: s.tempFiles(), present: report.present }));
  }
});

test('P03/6: an orphan temp is never mistaken for a committed intent', async t => {
  const s = await scenario(t, pair);
  const run = await s.runUntil('intent:after-fsync');
  assert.equal(run.signal, 'SIGKILL');
  // A temp file is not an intent. Recovery must read the ACTIVE name only, and
  // an absent active intent is "nothing to recover", not "a commit happened".
  const report = inspectIntent({ directory: s.stateDirectory, root: s.root, targetRoot: s.targetRoot });
  assert.deepEqual(planRecovery(report, () => null), { action: 'none' });
  assert.equal(fs.existsSync(activeIntentPath(s.stateDirectory)), false);
  assert.deepEqual(s.contents(), { 'a.txt': 'base A\n', 'b.txt': 'base B\n' });
});

test('P03/corrupt: an unreadable active intent is fail-closed, never treated as empty', async t => {
  const s = await scenario(t, pair);
  await s.runUntil('intent:after-rename'); // leave a real active intent behind
  const path = activeIntentPath(s.stateDirectory);
  assert.equal(fs.existsSync(path), true);
  for (const corruption of ['{ not json', '', '{"version":2,"kind":"COMMIT_INTENT"}', '{"version":1,"kind":"WRONG"}']) {
    fs.writeFileSync(path, corruption, { mode: 0o600 });
    const report = inspectIntent({ directory: s.stateDirectory, root: s.root, targetRoot: s.targetRoot });
    assert.equal(report.present, true, `"${corruption.slice(0, 12)}" must not read as absent`);
    assert.equal(report.unconfirmed, true, 'a corrupt intent leaves the root unconfirmed');
    assert.equal(report.unreadable, true);
    // And it must never be auto-cleared.
    assert.equal(planRecovery(report, () => null).action, 'block');
    assert.equal(planRecovery(report, () => null).reason, 'INTENT_UNREADABLE');
  }
  t.diagnostic('An empty log and an unreadable log are different facts and never collapse into one.');
});

test('P03/order: a spent grant is refused 403 even while the root is unconfirmed', async t => {
  const s = await scenario(t, pair);
  // Crash with an intent left open, so the root is unconfirmed on disk.
  await s.runUntil('intent:after-rename');
  const report = inspectIntent({ directory: s.stateDirectory, root: s.root, targetRoot: s.targetRoot });
  assert.equal(report.unconfirmed, true);
  // Corrupt the intent so recovery cannot clear it: the root stays blocked.
  fs.writeFileSync(activeIntentPath(s.stateDirectory), '{ not json', { mode: 0o600 });
  // Replaying the SAME consumed authorization must still be 403, not 503:
  // crash state must never mask a replay. This asserts decision order 2-before-3.
  const replay = await s.runUntil(null);
  assert.equal(replay.result?.outcome, 'DENY', JSON.stringify(replay.result));
  assert.equal(replay.result.status, 403, 'a spent grant is 403 regardless of root state');
  assert.deepEqual(s.contents(), { 'a.txt': 'base A\n', 'b.txt': 'base B\n' });
});
