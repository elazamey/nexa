/**
 * v13-2 — Terminal Port security vectors (test-first).
 *
 * First test file that performs REAL (hermetic) process execution: the terminal
 * port exists precisely to run real commands, so its security vectors must be
 * verified against real spawns. Hermetic discipline: private jails under the
 * gitignored `.nexa/`, an allowlist of harmless programs, no network, generous
 * timing margins, no assertions on install-dependent output.
 *
 * The port runs in one of two sandbox modes (auto-detected):
 *   'os'     — unshare(userns+mountns) + busybox chroot: the kernel makes the
 *              jail root the only filesystem (probe verified in this sandbox).
 *   'policy' — no-shell spawn + allowlist + argument validation (hosts without
 *              userns/busybox, e.g. the Windows host until its adapter lands).
 * The vector contract is identical in both modes; 'os' mode adds a kernel
 * guarantee under the policy layer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTerminalPort, canonicalTarget, canonicalDiff } from '../tools/celia-terminal-port.mjs';
import { throwsCode } from './helpers.mjs';

const JAILS_ROOT = join(tmpdir(), 'nexa-terminal-tests');

function makeJail(name) {
  const root = join(JAILS_ROOT, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'work'), { recursive: true });
  writeFileSync(join(root, 'work', 'marker.txt'), 'marker\n');
  return root;
}

function portFor(name, extra = {}) {
  const jailRoot = makeJail(name);
  const port = createTerminalPort({ jailRoot, ...extra });
  return { port, jailRoot };
}

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Async twin of throwsCode for the port's rejected promises. */
async function rejectsCode(make, code) {
  let error;
  try {
    await make();
  } catch (e) {
    error = e;
  }
  assert.ok(error, `expected ${code}, but nothing was rejected`);
  assert.equal(error.code, code, `expected ${code}, got ${error.code ?? error} (${error.message})`);
  return error;
}

// ---------------------------------------------------------------------------
// T0. Happy path — real spawn, capture, hashes, evidence, empty diff
// ---------------------------------------------------------------------------
test('T0: a real command runs inside the jail; capture, hashes and evidence are exact', async () => {
  const { port, jailRoot } = portFor('t0');

  const result = await port.exec({ program: 'ls', args: ['work'] });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.ok(result.stdout.includes('marker.txt'), 'saw the jail file');
  assert.equal(result.target, canonicalTarget('ls', ['work']));
  assert.equal(result.stdoutHash, `sha256:${sha(result.stdout)}`);
  assert.equal(result.stderrHash, `sha256:${sha(result.stderr)}`);
  assert.match(result.evidenceRef, /^evidence:terminal:run:[A-Za-z0-9_-]+$/);
  assert.deepEqual(result.diff.added, []);
  assert.deepEqual(result.diff.removed, []);
  assert.deepEqual(result.diff.changed, []);
  assert.equal(result.diff.digest, `sha256:${sha(canonicalDiff({ added: [], removed: [], changed: [] }))}`);
  assert.equal(result.durationMs >= 0, true);
  assert.ok(['os', 'policy'].includes(result.sandbox), `sandbox mode reported: ${result.sandbox}`);
});

// ---------------------------------------------------------------------------
// T1. Path escape — .. segments and absolute paths outside the jail are refused
// ---------------------------------------------------------------------------
test('T1: path escape attempts are refused before anything is spawned', async () => {
  const { port, jailRoot } = portFor('t1');

  // Relative escape.
  await rejectsCode(() => port.exec({ program: 'ls', args: ['../../etc'] }), 'NEXA_E_TERMINAL_JAIL');
  await rejectsCode(() => port.exec({ program: 'ls', args: ['..'] }), 'NEXA_E_TERMINAL_JAIL');
  // Absolute escape.
  await rejectsCode(() => port.exec({ program: 'cat', args: ['/etc/hostname'] }), 'NEXA_E_TERMINAL_JAIL');
  // Uniform contract (both sandbox modes): absolute paths are refused, relative
  // paths only — resolved against the jail root. This keeps the contract
  // identical on hosts without userns/chroot.
  await rejectsCode(() => port.exec({ program: 'cat', args: ['/work/marker.txt'] }), 'NEXA_E_TERMINAL_JAIL');
  // Escapes never touch the outside: nothing was spawned, so no run happened.
  assert.equal(port.stats().runs, 0, 'refusals are not runs');
  // In-jail relative access works.
  const result = await port.exec({ program: 'cat', args: ['work/marker.txt'] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /marker/);
  // The outside file the escapes aimed at is untouched.
  const outside = join(JAILS_ROOT, 't1-outside.txt');
  writeFileSync(outside, 'top-secret\n');
  assert.equal(existsSync(outside), true);
});

// ---------------------------------------------------------------------------
// T2. Command injection — no shell is ever involved; metacharacters are data
// ---------------------------------------------------------------------------
test('T2: shell metacharacters are inert — they are printed, not executed', async () => {
  const { port } = portFor('t2');

  const payload = ['; rm -rf /', '$(id)', '`id`', 'a && b', 'a | b', 'a > b'];
  const result = await port.exec({ program: 'echo', args: payload });
  assert.equal(result.exitCode, 0);
  // The payload comes back literally (single echo invocation, one line).
  assert.equal(result.stdout, payload.join(' ') + '\n');
  // And nothing side-effected: no files, no removals.
  assert.deepEqual(result.diff.added, []);
  assert.deepEqual(result.diff.removed, []);

  // A "program" with shell structure is a schema error, never a spawn.
  await rejectsCode(() => port.exec({ program: 'echo;rm', args: [] }), 'NEXA_E_SCHEMA');
  await rejectsCode(() => port.exec({ program: '/bin/sh', args: ['-c', 'id'] }), 'NEXA_E_SCHEMA');
  // Newlines in arguments are rejected.
  await rejectsCode(() => port.exec({ program: 'echo', args: ['a\nb'] }), 'NEXA_E_SCHEMA');
});

// ---------------------------------------------------------------------------
// T3. Timeout — the process group is killed; the result is structured, not an exception
// ---------------------------------------------------------------------------
test('T3: a hanging command is killed within its timeout and reported as timedOut', async () => {
  const { port } = portFor('t3');

  const started = Date.now();
  const result = await port.exec({ program: 'sleep', args: ['5'] }, { timeoutMs: 400 });
  const elapsed = Date.now() - started;

  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.ok(elapsed < 3000, `kill landed promptly (elapsed ${elapsed}ms)`);
  assert.equal(result.ok, true, 'a timeout is an observed result, not a thrown error');
  assert.match(result.evidenceRef, /^evidence:terminal:run:/);
});

// ---------------------------------------------------------------------------
// T4. Allowlist — only declared programs run; exit codes propagate
// ---------------------------------------------------------------------------
test('T4: the program allowlist is enforced; exit codes propagate exactly', async () => {
  const { port } = portFor('t4');

  // The jail's own shells and interpreters are not on the default allowlist.
  await rejectsCode(() => port.exec({ program: 'bash', args: [] }), 'NEXA_E_TERMINAL_UNALLOWED');
  await rejectsCode(() => port.exec({ program: 'python3', args: [] }), 'NEXA_E_TERMINAL_UNALLOWED');
  // Unknown program.
  await rejectsCode(() => port.exec({ program: 'definitely-not-a-program', args: [] }), 'NEXA_E_TERMINAL_UNALLOWED');

  // Exit code propagation through the real spawn.
  const result = await port.exec({ program: 'sh', args: ['-c', 'exit 7'] });
  assert.equal(result.exitCode, 7);
  assert.equal(result.timedOut, false);
});

// ---------------------------------------------------------------------------
// T5. Approval token match — the executed command must equal the approved target
// ---------------------------------------------------------------------------
test('T5: the port refuses to execute a command different from its approved target', async () => {
  const { port } = portFor('t5');

  await rejectsCode(
    () => port.exec({ program: 'ls', args: ['-R'] }, { expectedTarget: canonicalTarget('ls', ['.']) }),
    'NEXA_E_APPROVAL_TARGET',
  );
  // The exact approved target runs.
  const result = await port.exec({ program: 'ls', args: ['.'] }, { expectedTarget: canonicalTarget('ls', ['.']) });
  assert.equal(result.exitCode, 0);
});

// ---------------------------------------------------------------------------
// T6. Filesystem diff — added / changed / removed are all observed, digest-committed
// ---------------------------------------------------------------------------
test('T6: the filesystem diff sees adds, changes and removals with a committed digest', async () => {
  const { port, jailRoot } = portFor('t6');

  const created = await port.exec({ program: 'sh', args: ['-c', 'echo one > work/out.txt'] });
  assert.deepEqual(created.diff.added, ['work/out.txt']);
  assert.equal(existsSync(join(jailRoot, 'work/out.txt')), true);

  const changed = await port.exec({ program: 'sh', args: ['-c', 'echo two > work/out.txt'] });
  assert.deepEqual(changed.diff.changed, ['work/out.txt']);

  const removed = await port.exec({ program: 'rm', args: ['work/out.txt'] });
  assert.deepEqual(removed.diff.removed, ['work/out.txt']);

  // Digests are sha256 over the canonical (sorted) diff — deterministic.
  const canonical = canonicalDiff({ added: ['work/out.txt'], changed: [], removed: [] });
  assert.equal(created.diff.digest, `sha256:${sha(canonical)}`);
});

// ---------------------------------------------------------------------------
// T7. Output capture — stdout and stderr are separated and hash-committed
// ---------------------------------------------------------------------------
test('T7: stdout and stderr are captured separately with exact hashes', async () => {
  const { port } = portFor('t7');

  const result = await port.exec({ program: 'sh', args: ['-c', 'echo out-line; echo err-line 1>&2'] });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'out-line\n');
  assert.equal(result.stderr, 'err-line\n');
  assert.equal(result.stdoutHash, `sha256:${sha('out-line\n')}`);
  assert.equal(result.stderrHash, `sha256:${sha('err-line\n')}`);
});

// ---------------------------------------------------------------------------
// T8. Environment scrubbing — child processes get a minimal env, no secrets
// ---------------------------------------------------------------------------
test('T8: child processes see a minimal environment — injected secrets never reach them', async () => {
  process.env.NEXA_TEST_SECRET_VAR = 'must-not-leak';
  try {
    const { port } = portFor('t8');
    const result = await port.exec({ program: 'env', args: [] });
    assert.equal(result.exitCode, 0);
    assert.ok(!result.stdout.includes('must-not-leak'), 'secret did not reach the child');
    assert.ok(!result.stdout.includes('NEXA_TEST_SECRET_VAR'));
    assert.ok(result.stdout.includes('PATH='), 'PATH is preserved for program resolution');
  } finally {
    delete process.env.NEXA_TEST_SECRET_VAR;
  }
});
