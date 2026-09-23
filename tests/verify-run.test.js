/**
 * End-to-end: TEST → EVIDENCE → DELIVER with no hand-made evidence.
 *
 * `celia verify-run` runs a real test file in a subprocess, signs the outcome
 * with the verifier key, and that evidence — and only that — lets the bounded
 * COMMIT executor apply the change. A failing test file produces DENY evidence
 * and the same COMMIT is refused with no filesystem effect.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIdentity } from '../packages/identity/index.js';
import { mintCapability } from '../packages/capability/index.js';
import { buildEnvelope } from '../packages/protocol/index.js';
import { createTransactionalWorkspacePort } from '../tools/celia-workspace-port.mjs';
import { createWorkspaceCommitter, inspectWorkspaceCommit, workspaceCommitRoot } from '../tools/celia-workspace-commit-port.mjs';
import { workspaceCommitConstraints, workspaceCommitIntent, workspaceCommitResource } from '../tools/celia-workspace-commit-auth.mjs';
import { initializeCommitConsumptionStore } from '../tools/celia-commit-consumption-store.mjs';
import { judge, runTests, signRun, verifyRun } from '../tools/celia-verify-runner.mjs';
import { snapshot } from './celia-workspace-auth-helpers.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const cli = join(repository, 'tools/celia-verify-run.mjs');
const options = { timeout: 60_000 };

const PASSING = `import test from 'node:test'; import assert from 'node:assert/strict';
test('real passing test', () => { assert.equal(1 + 1, 2); });\n`;
const FAILING = `import test from 'node:test'; import assert from 'node:assert/strict';
test('real failing test', () => { assert.equal(1 + 1, 3); });\n`;

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nexa-verify-run-'));
  const stateDirectory = mkdtempSync(join(tmpdir(), 'nexa-verify-run-state-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(stateDirectory, { recursive: true, force: true }); });
  const port = createTransactionalWorkspacePort({ root });
  const { workspaceId } = await port.createWorkspace('verify-run', { workspaceId: 'ws_verify_run' });
  const staging = join(root, '.nexa', 'staging', workspaceId);
  writeFileSync(join(root, 'target.txt'), 'base\n', { mode: 0o600 });
  fs.mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, 'target.txt'), 'approved\n', { mode: 0o600 });
  initializeCommitConsumptionStore({ directory: stateDirectory, root, targetRoot: workspaceCommitRoot(root) });

  const issuer = createIdentity({ label: 'vr-issuer' }), caller = createIdentity({ label: 'vr-caller' });
  const audience = createIdentity({ label: 'vr-audience' }), verifier = createIdentity({ label: 'vr-verifier', seed: 'e5'.repeat(32) });
  const config = {
    audience: audience.kid, capabilityIssuers: [issuer.kid],
    rules: [{ id: 'vr', effect: 'ALLOW', resource: 'workspace_commit:*', actions: ['commit'], subjects: [caller.kid] }],
    verification: { verifiers: [verifier.kid] },
  };
  const descriptor = (() => { const { targetRoot, changeSetHash, expectedBaseHash } = inspectWorkspaceCommit({ root, workspaceId }); return { workspaceId, targetRoot, changeSetHash, expectedBaseHash }; })();
  function request(evidence) {
    const token = mintCapability({ issuer, subject: caller.kid, resource: workspaceCommitResource(descriptor), actions: ['commit'], constraints: workspaceCommitConstraints(descriptor), caveats: { max_uses: 1, max_depth: 0 } });
    const authorization = buildEnvelope({ sender: caller, to: audience.kid, type: 'CALL', capability: token.id, body: { resource: token.resource, action: 'commit', args: workspaceCommitIntent(descriptor), capability: token } });
    return { ...descriptor, authorization, evidence };
  }
  const tests = mkdtempSync(join(tmpdir(), 'nexa-verify-run-tests-'));
  t.after(() => rmSync(tests, { recursive: true, force: true }));
  writeFileSync(join(tests, 'pass.test.mjs'), PASSING);
  writeFileSync(join(tests, 'fail.test.mjs'), FAILING);
  const commit = createWorkspaceCommitter({ root, workspacePort: port, config, stateDirectory });
  return { root, staging, descriptor, caller, verifier, request, commit, tests, stateDirectory };
}

test('verify-run: a real passing test run yields REAL HANDLER_RESULT/ALLOW evidence that lets COMMIT pass', options, async t => {
  const f = await fixture(t);
  const evidence = verifyRun({ verifier: f.verifier, subject: f.caller.kid, descriptor: f.descriptor, files: [join(f.tests, 'pass.test.mjs')], cwd: f.tests });
  assert.equal(evidence.verdict, 'ALLOW');
  assert.equal(evidence.source, 'real');
  assert.equal(evidence.records[1].kind, 'HANDLER_RESULT');
  assert.equal(evidence.records[1].actor, f.verifier.kid);
  assert.equal(evidence.records[1].detail.summary.pass, 1);
  const result = f.commit(f.request({ source: evidence.source, records: evidence.records }));
  assert.equal(result.ok, true);
  assert.equal(result.verification.verifier, f.verifier.kid);
  assert.equal(readFileSync(join(f.root, 'target.txt'), 'utf8'), 'approved\n');
});

test('verify-run: a real failing test run yields DENY evidence and COMMIT is refused with no I/O', options, async t => {
  const f = await fixture(t);
  const evidence = verifyRun({ verifier: f.verifier, subject: f.caller.kid, descriptor: f.descriptor, files: [join(f.tests, 'fail.test.mjs')], cwd: f.tests });
  assert.equal(evidence.verdict, 'DENY');
  assert.equal(evidence.records[1].kind, 'GATE_BLOCKED');
  assert.equal(evidence.records[1].detail.summary.fail, 1);
  const before = snapshot(f.root);
  assert.throws(() => f.commit(f.request({ source: evidence.source, records: evidence.records })), { code: 'COMMIT_VERIFICATION_FAIL' });
  assert.deepEqual(snapshot(f.root), before);
  assert.equal(readFileSync(join(f.root, 'target.txt'), 'utf8'), 'base\n');
});

test('verify-run: evidence for one change set cannot commit another (rebinding is detected)', options, async t => {
  const f = await fixture(t);
  const other = { ...f.descriptor, changeSetHash: workspaceCommitRoot(f.root) };
  const evidence = verifyRun({ verifier: f.verifier, subject: f.caller.kid, descriptor: other, files: [join(f.tests, 'pass.test.mjs')], cwd: f.tests });
  assert.equal(evidence.verdict, 'ALLOW');
  assert.throws(() => f.commit(f.request({ source: evidence.source, records: evidence.records })), { code: 'COMMIT_VERIFICATION_BLOCKED' });
  assert.equal(readFileSync(join(f.root, 'target.txt'), 'utf8'), 'base\n');
});

test('verify-run: the verifier refuses to sign for itself, and judge() is strict', async t => {
  const f = await fixture(t);
  const run = runTests({ files: [join(f.tests, 'pass.test.mjs')], cwd: f.tests });
  assert.throws(() => signRun({ verifier: f.caller, subject: f.caller.kid, descriptor: f.descriptor, run }), /VERIFIER_IS_SUBJECT/);
  assert.equal(judge(run), true);
  assert.equal(judge({ ...run, exitCode: 1 }), false);
  assert.equal(judge({ ...run, summary: { ...run.summary, pass: 0 } }), false, 'zero tests is not a pass');
  assert.equal(judge({ ...run, summary: { ...run.summary, fail: null } }), false, 'unparsed summary is not a pass');
  assert.equal(judge({ ...run, timedOut: true }), false);
});

test('verify-run CLI: writes evidence JSON that the committer accepts as-is', options, async t => {
  const f = await fixture(t);
  const seed = join(f.tests, 'verifier.seed'); writeFileSync(seed, 'e5'.repeat(32) + '\n', { mode: 0o600 });
  const descriptorFile = join(f.tests, 'descriptor.json'); writeFileSync(descriptorFile, JSON.stringify(f.descriptor));
  const out = join(f.tests, 'evidence.json');
  const child = spawnSync(process.execPath, [cli, '--key', seed, '--subject', f.caller.kid, '--descriptor', descriptorFile, '--test', join(f.tests, 'pass.test.mjs'), '--out', out], { cwd: f.tests, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stderr, /verify-run: ALLOW by nexa:key:ed25519:/);
  const evidence = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(evidence.source, 'real');
  assert.equal(f.commit(f.request(evidence)).ok, true);
  assert.equal(readFileSync(join(f.root, 'target.txt'), 'utf8'), 'approved\n');

  const bad = spawnSync(process.execPath, [cli, '--key', seed], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});
