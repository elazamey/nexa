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
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

/**
 * Structured test result — the runner's report, NOT the test's stdout.
 *
 *   Execution → Structured Test Result → Independent Judge → Evidence → Gate
 *
 * Each file is executed by its own `node --test` runner with a junit reporter
 * writing to a private, unpredictable destination file owned by the verifier.
 * That file is produced by the RUNNER process (the parent of the test), so a test
 * printing "# pass 1" to stdout changes nothing. stdout is kept as a diagnostic
 * tail only; the judge never reads it.
 *
 * Known runner weakness this closes: a test that calls process.exit(0) before
 * reporting makes the runner count the FILE as one passing test whose name is the
 * file path. The judge treats a testcase named as an input file as
 * "unreported" and refuses it.
 */
function readReport(path, file) {
  let xml;
  try { xml = readFileSync(path, 'utf8'); } catch { return { present: false, reason: 'runner produced no report' }; }
  const counters = {};
  for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const match = xml.match(new RegExp(`<!-- ${key} (\\d+) -->`));
    counters[key] = match ? Number(match[1]) : null;
  }
  const cases = [];
  const decode = v => v.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(\/>|>)/g)) {
    const attrs = match[1];
    const name = decode(attrs.match(/\bname="([^"]*)"/)?.[1] ?? '');
    const failed = /\bfailure=/.test(attrs) || match[2] === '>' && /<failure\b/.test(xml.slice(match.index, xml.indexOf('</testcase>', match.index)));
    const unreported = name === file || name === resolve(file);
    cases.push({ name, failed, unreported });
  }
  if (Object.values(counters).every(v => v === null) && cases.length === 0) return { present: false, reason: 'report is empty or unparseable' };
  return { present: true, counters, cases };
}

function runOne(file, { cwd, env, timeoutMs }) {
  const dir = mkdtempSync(join(tmpdir(), 'nexa-verify-report-'));
  const destination = join(dir, `${randomBytes(16).toString('hex')}.xml`);
  // A verify-run launched from inside a test runner must not be adopted as a
  // subtest of it: strip the runner's IPC/context variables so the child is a
  // standalone `node --test` whose exit code and report are its own.
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('NODE_TEST_') && key !== 'NODE_OPTIONS'));
  const started = Date.now();
  let child;
  try {
    child = spawnSync(process.execPath, ['--test', '--test-reporter=junit', `--test-reporter-destination=${destination}`, file],
      { cwd, env: clean, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    return {
      file, exitCode: child.status, signal: child.signal ?? null,
      error: child.error ? { code: child.error.code ?? null, message: child.error.message } : null,
      timedOut: child.error?.code === 'ETIMEDOUT', durationMs: Date.now() - started,
      report: readReport(destination, file),
      stdoutTail: ((child.stdout ?? '') + (child.stderr ?? '')).slice(-MAX_OUTPUT),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs every file in its own runner; returns structured results. Never throws on test failure. */
export function runTests({ files, cwd = process.cwd(), env = process.env, timeoutMs = 10 * 60_000 }) {
  if (!Array.isArray(files) || files.length === 0 || files.some(f => typeof f !== 'string' || f.startsWith('-'))) {
    throw new Error('TEST_FILES_INVALID');
  }
  const started = Date.now();
  const results = files.map(file => runOne(file, { cwd, env, timeoutMs }));
  const summary = { files: files.length, tests: 0, pass: 0, fail: 0, cancelled: 0 };
  for (const r of results) {
    if (!r.report.present) continue;
    for (const key of ['tests', 'pass', 'fail', 'cancelled']) summary[key] += r.report.counters[key] ?? 0;
  }
  return { files, results, summary, durationMs: Date.now() - started };
}

/**
 * Independent judge over the structured result. Returns { ok, reasons }.
 * Every file must: exit 0, not time out or error, produce a report, report zero
 * failures/cancellations, at least one passing testcase, no unreported-file
 * testcase, and internally consistent counters.
 */
export function judgeDetailed(run) {
  const reasons = [];
  if (!Array.isArray(run?.results) || run.results.length === 0) return { ok: false, reasons: ['no results'] };
  for (const r of run.results) {
    const tag = `${r.file}:`;
    if (r.timedOut) reasons.push(`${tag} timed out (${r.error?.code})`);
    else if (r.error) reasons.push(`${tag} spawn error ${r.error.code}`);
    if (r.exitCode !== 0) reasons.push(`${tag} exit ${r.exitCode}${r.signal ? `/${r.signal}` : ''}`);
    if (!r.report?.present) { reasons.push(`${tag} ${r.report?.reason ?? 'no report'}`); continue; }
    const { counters, cases } = r.report;
    if (counters.fail !== 0 || counters.cancelled !== 0) reasons.push(`${tag} ${counters.fail} failed / ${counters.cancelled} cancelled`);
    const unreported = cases.filter(c => c.unreported);
    if (unreported.length) reasons.push(`${tag} file exited without reporting its tests`);
    const passing = cases.filter(c => !c.failed && !c.unreported).length;
    if (passing < 1) reasons.push(`${tag} zero passing testcases`);
    if (!Number.isInteger(counters.pass) || counters.pass !== cases.filter(c => !c.failed).length) reasons.push(`${tag} inconsistent counters`);
    if (cases.some(c => c.failed)) reasons.push(`${tag} failing testcase present`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Deterministic judgement: PASS only when every file passes judgeDetailed. */
export function judge(run) {
  return judgeDetailed(run).ok;
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
  const judgement = judgeDetailed(run);
  const passed = judgement.ok;
  const log = new EvidenceLog({ actor: verifier, clock });
  log.append({ kind: 'POLICY_DECISION', decision: 'ALLOW', subject, resource, action: 'commit', detail: { stage: 'TEST', tool: 'celia verify-run', files: run.files } });
  log.append({
    kind: passed ? 'HANDLER_RESULT' : 'GATE_BLOCKED', decision: passed ? 'ALLOW' : 'DENY',
    subject, resource, action: 'commit',
    detail: {
      stage: passed ? 'VERIFY' : 'DIAGNOSE', tool: 'celia verify-run',
      changeSetHash: descriptor.changeSetHash, expectedBaseHash: descriptor.expectedBaseHash, workspaceId: descriptor.workspaceId,
      durationMs: run.durationMs, summary: run.summary, reasons: judgement.reasons,
      // Per-file structured facts: what the RUNNER reported, never what the test printed.
      results: run.results.map(r => ({
        file: r.file, exitCode: r.exitCode, signal: r.signal, error: r.error, timedOut: r.timedOut, durationMs: r.durationMs,
        report: r.report.present ? { counters: r.report.counters, cases: r.report.cases } : { present: false, reason: r.report.reason },
      })),
    },
  });
  return { source: 'real', records: log.entries(), verdict: passed ? 'ALLOW' : 'DENY', run };
}

export function verifyRun({ verifier, subject, descriptor, files, cwd, env, clock }) {
  const run = runTests({ files, cwd, env });
  return signRun({ verifier, subject, descriptor, run, clock });
}
