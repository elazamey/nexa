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
import { judge, judgeDetailed, runTests, signRun, verifyRun } from '../tools/celia-verify-runner.mjs';
import { snapshot } from './celia-workspace-auth-helpers.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const cli = join(repository, 'tools/celia-verify-run.mjs');
const options = { timeout: 60_000 };
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST_') && k !== 'NODE_OPTIONS'));

const PASSING = `import test from 'node:test'; import assert from 'node:assert/strict';
test('real passing test', () => { assert.equal(1 + 1, 2); });\n`;
const FAILING = `import test from 'node:test'; import assert from 'node:assert/strict';
test('real failing test', () => { assert.equal(1 + 1, 3); });\n`;
// Attack 1: the test fails but prints a perfect TAP summary to stdout first.
const FORGED_TAP = `import test from 'node:test'; import assert from 'node:assert/strict';
test('forged', () => { process.stdout.write('\\nTAP version 13\\nok 1 - forged\\n1..1\\n# tests 1\\n# pass 1\\n# fail 0\\n# cancelled 0\\n'); assert.equal(1, 2); });\n`;
// Attack 2: print a perfect summary, then process.exit(0) before the runner can report the truth.
const FORGED_EXIT = `import test from 'node:test';
test('forged-exit', () => { process.stdout.write('TAP version 13\\nok 1 - x\\n1..1\\n# tests 1\\n# suites 0\\n# pass 1\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n'); process.exit(0); });\n`;
// A test that never resolves and keeps the event loop alive: only a real timeout ends it.
const HANGING = `import test from 'node:test';
test('hang', () => new Promise(() => { setInterval(() => {}, 1000); }));\n`;

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
  writeFileSync(join(tests, 'forged-tap.test.mjs'), FORGED_TAP);
  writeFileSync(join(tests, 'forged-exit.test.mjs'), FORGED_EXIT);
  writeFileSync(join(tests, 'hang.test.mjs'), HANGING);
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
  assert.equal(evidence.records[1].detail.results[0].exitCode, 0);
  assert.deepEqual(evidence.records[1].detail.results[0].report.cases, [{ name: 'real passing test', failed: false, unreported: false }]);
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
  assert.deepEqual(judgeDetailed({ results: [] }), { ok: false, reasons: ['no results'] });
});

// ── Security boundary: the judge reads the RUNNER's structured report, never the test's stdout ──

test('verify-run: forged TAP on stdout by a failing test is DENY evidence, and COMMIT is refused', options, async t => {
  const f = await fixture(t);
  // Control: run the file the naive way (plain node --test, TAP on stdout) and show the forgery lands there.
  const naive = spawnSync(process.execPath, ['--test', join(f.tests, 'forged-tap.test.mjs')], { cwd: f.tests, encoding: 'utf8', env: cleanEnv() });
  assert.match(naive.stdout, /# pass 1/, 'control: the forged summary really is printed to stdout');
  const run = runTests({ files: [join(f.tests, 'forged-tap.test.mjs')], cwd: f.tests });
  const verdict = judgeDetailed(run);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reasons.some(r => /1 failed/.test(r)), JSON.stringify(verdict.reasons));
  assert.equal(run.results[0].report.cases[0].failed, true, 'structured report records the real failure');
  const evidence = signRun({ verifier: f.verifier, subject: f.caller.kid, descriptor: f.descriptor, run });
  assert.equal(evidence.verdict, 'DENY');
  assert.throws(() => f.commit(f.request({ source: evidence.source, records: evidence.records })), { code: 'COMMIT_VERIFICATION_FAIL' });
  assert.equal(readFileSync(join(f.root, 'target.txt'), 'utf8'), 'base\n');
});

test('verify-run: forged summary + process.exit(0) before reporting is DENY (exit code alone is not proof)', options, async t => {
  const f = await fixture(t);
  const naive = spawnSync(process.execPath, ['--test', join(f.tests, 'forged-exit.test.mjs')], { cwd: f.tests, encoding: 'utf8', env: cleanEnv() });
  assert.equal(naive.status, 0, 'control: the attacker did achieve exit 0');
  assert.match(naive.stdout, /# pass 1\n# fail 0/, 'control: and a stdout-parsing judge would have been fooled');
  const run = runTests({ files: [join(f.tests, 'forged-exit.test.mjs')], cwd: f.tests });
  assert.equal(run.results[0].exitCode, 0);
  const verdict = judgeDetailed(run);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reasons.some(r => /exited without reporting/.test(r)), JSON.stringify(verdict.reasons));
  const evidence = signRun({ verifier: f.verifier, subject: f.caller.kid, descriptor: f.descriptor, run });
  assert.equal(evidence.verdict, 'DENY');
  assert.equal(evidence.records[1].kind, 'GATE_BLOCKED');
  assert.throws(() => f.commit(f.request({ source: evidence.source, records: evidence.records })), { code: 'COMMIT_VERIFICATION_FAIL' });
  assert.equal(readFileSync(join(f.root, 'target.txt'), 'utf8'), 'base\n');
});

test('verify-run: a genuinely hanging test hits a real ETIMEDOUT and yields DENY evidence recording the timeout', options, async t => {
  const f = await fixture(t);
  const started = Date.now();
  const run = runTests({ files: [join(f.tests, 'hang.test.mjs')], cwd: f.tests, timeoutMs: 1500 });
  const r = run.results[0];
  assert.ok(Date.now() - started >= 1400, 'the process really ran until the deadline');
  assert.equal(r.timedOut, true);
  assert.equal(r.error.code, 'ETIMEDOUT', 'spawnSync reported the timeout, nothing was injected');
  assert.equal(r.report.present, false, 'a killed runner leaves no usable report');
  const verdict = judgeDetailed(run);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reasons.some(x => /timed out \(ETIMEDOUT\)/.test(x)), JSON.stringify(verdict.reasons));
  const evidence = signRun({ verifier: f.verifier, subject: f.caller.kid, descriptor: f.descriptor, run });
  assert.equal(evidence.verdict, 'DENY');
  assert.equal(evidence.records[1].detail.results[0].timedOut, true);
  assert.equal(evidence.records[1].detail.results[0].error.code, 'ETIMEDOUT');
  assert.throws(() => f.commit(f.request({ source: evidence.source, records: evidence.records })), { code: 'COMMIT_VERIFICATION_FAIL' });
  assert.equal(readFileSync(join(f.root, 'target.txt'), 'utf8'), 'base\n');
});

test('verify-run: one forged file among passing files poisons the whole run', options, async t => {
  const f = await fixture(t);
  const run = runTests({ files: [join(f.tests, 'pass.test.mjs'), join(f.tests, 'forged-exit.test.mjs')], cwd: f.tests });
  assert.equal(run.summary.pass, 2, 'control: naive counting would say 2 passed');
  assert.equal(judge(run), false);
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
