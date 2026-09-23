/**
 * celia verify-run — the VERIFIER side of the agent loop (docs/agent-loop.md §7).
 *
 * Runs real tests with `node --test`, and signs what actually happened as a
 * NEXA evidence chain bound to ONE exact commit descriptor:
 *
 *   POLICY_DECISION/ALLOW            "verifier accepted the run request"
 *   HANDLER_RESULT/ALLOW             all tests passed   → COMMIT can PASS
 *   GATE_BLOCKED/DENY                any test failed    → COMMIT will FAIL
 *
 * Properties the commit gate relies on:
 *   - the verifier key is never the committing principal (the gate checks);
 *   - `resource` = workspace_commit:<hash> of the descriptor, `detail.changeSetHash`
 *     = the descriptor's change set, so evidence cannot be reused for other bytes;
 *   - a failed run produces DENY evidence, never silence: the failure is recorded;
 *   - `source` is always 'real' here — this tool never emits mock evidence.
 *
 * It does NOT commit, does not touch the workspace, and does not grant capability.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { EvidenceLog } from '../packages/evidence/index.js';
import { KeyPair } from '../packages/crypto/index.js';
import { assertKid } from '../packages/ast/index.js';
import { workspaceCommitResource } from './celia-workspace-commit-auth.mjs';

const HASH = /^sha256:[A-Za-z0-9_-]{43}$/;
const MAX_OUTPUT = 64 * 1024;

export function loadVerifierKey(path) {
  const raw = readFileSync(path, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/i.test(raw)) throw new Error('VERIFIER_KEY_INVALID: expected a 32-byte hex seed');
  return KeyPair.fromSeed(raw);
}

export function validateDescriptor(descriptor) {
  if (descriptor === null || typeof descriptor !== 'object' || Array.isArray(descriptor)
      || Object.keys(descriptor).some(key => !['workspaceId', 'targetRoot', 'changeSetHash', 'expectedBaseHash'].includes(key))
      || typeof descriptor.workspaceId !== 'string' || !/^ws_[A-Za-z0-9_-]{1,160}$/.test(descriptor.workspaceId)
      || ![descriptor.targetRoot, descriptor.changeSetHash, descriptor.expectedBaseHash].every(v => typeof v === 'string' && HASH.test(v))) {
    throw new Error('DESCRIPTOR_INVALID: need { workspaceId, targetRoot, changeSetHash, expectedBaseHash }');
  }
  return descriptor;
}

/** Runs `node --test <files>` in `cwd`; returns the raw outcome. Never throws on test failure. */
export function runTests({ files, cwd = process.cwd(), env = process.env, timeoutMs = 10 * 60_000 }) {
  if (!Array.isArray(files) || files.length === 0 || files.some(f => typeof f !== 'string' || f.startsWith('-'))) {
    throw new Error('TEST_FILES_INVALID');
  }
  const started = Date.now();
  // A verify-run launched from inside a test runner must not be adopted as a
  // subtest of it: strip the runner's IPC/context variables so the child is a
  // standalone `node --test` whose exit code and TAP summary are its own.
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('NODE_TEST_') && key !== 'NODE_OPTIONS'));
  const child = spawnSync(process.execPath, ['--test', ...files], { cwd, env: clean, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const stdout = child.stdout ?? '';
  const summary = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const match = stdout.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
    summary[key] = match ? Number(match[1]) : null;
  }
  return {
    files, exitCode: child.status, signal: child.signal ?? null, timedOut: child.error?.code === 'ETIMEDOUT',
    durationMs: Date.now() - started, summary,
    tail: (stdout + (child.stderr ?? '')).slice(-MAX_OUTPUT),
  };
}

/** Deterministic judgement: PASS only when the process exited 0 with 0 failures and ≥1 test. */
export function judge(run) {
  return run.exitCode === 0 && !run.timedOut && run.summary.fail === 0 && run.summary.cancelled === 0
    && Number.isInteger(run.summary.pass) && run.summary.pass > 0;
}

/**
 * @returns {{ source: 'real', records: object[], verdict: 'ALLOW'|'DENY', run: object }}
 */
export function signRun({ verifier, subject, descriptor, run, clock }) {
  if (!(verifier?.keys instanceof KeyPair)) throw new Error('VERIFIER_REQUIRED');
  assertKid(subject);
  validateDescriptor(descriptor);
  if (verifier.kid === subject) throw new Error('VERIFIER_IS_SUBJECT: the proposer cannot verify itself');
  const resource = workspaceCommitResource(descriptor);
  const passed = judge(run);
  const log = new EvidenceLog({ actor: verifier, clock });
  log.append({ kind: 'POLICY_DECISION', decision: 'ALLOW', subject, resource, action: 'commit', detail: { stage: 'TEST', tool: 'celia verify-run', files: run.files } });
  log.append({
    kind: passed ? 'HANDLER_RESULT' : 'GATE_BLOCKED', decision: passed ? 'ALLOW' : 'DENY',
    subject, resource, action: 'commit',
    detail: {
      stage: passed ? 'VERIFY' : 'DIAGNOSE', tool: 'celia verify-run',
      changeSetHash: descriptor.changeSetHash, expectedBaseHash: descriptor.expectedBaseHash, workspaceId: descriptor.workspaceId,
      exitCode: run.exitCode, signal: run.signal, timedOut: run.timedOut, durationMs: run.durationMs, summary: run.summary,
    },
  });
  return { source: 'real', records: log.entries(), verdict: passed ? 'ALLOW' : 'DENY', run };
}

export function verifyRun({ verifier, subject, descriptor, files, cwd, env, clock }) {
  const run = runTests({ files, cwd, env });
  return signRun({ verifier, subject, descriptor, run, clock });
}
