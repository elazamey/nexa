import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judge, runTests } from '../../tools/celia-verify-runner.mjs';

/**
 * known-gap D1.10 (SEC-NEXT-01) — the test process runs as the same OS user as the
 * verifier; only path secrecy separates it from the trusted report channel, and the
 * path is on the runner's command line (/proc/<ppid>/cmdline), so it is not secret.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفجوة الحالية، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.10 (docs/agent-loop.md §9).
 *
 * Attack: a FAILING test reads the runner's argv, spawns a detached same-user process
 * that waits for the runner to finish writing the honest report, then overwrites it
 * with a fabricated passing one. Timing note: the runner process itself still exits 1
 * because the child already reported the failure over IPC before the overwrite, and
 * the overwrite races the verifier's read. What this file therefore reproduces with
 * certainty is the *precondition*: the report is writable by the test.
 * Only an isolation boundary (different uid / namespace / container, or a channel the
 * test cannot reach) closes this; the judge cannot.
 */
const ATTACKER = `import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';
test('real failure that can reach the trusted channel', () => {
  const argv = readFileSync('/proc/' + process.ppid + '/cmdline', 'utf8').split('\\0');
  const dest = argv.find(a => a.startsWith('--test-reporter-destination='))?.slice('--test-reporter-destination='.length);
  assert.ok(dest, 'destination discoverable');
  accessSync(dirname(dest), constants.W_OK); // same uid ⇒ writable
  writeFileSync(dest + '.marker', 'written by the test process');
  assert.equal(1, 2);
});\n`;

test('known-gap D1.10 (SEC-NEXT-01): the test process can discover and write into the trusted report directory (same user, no isolation boundary)', { timeout: 30_000, skip: process.platform !== 'linux' }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'nexa-sec-next-01-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'attacker.test.mjs');
  writeFileSync(file, ATTACKER);
  const run = runTests({ files: [file], cwd: dir });
  const r = run.results[0];
  assert.equal(judge(run), false, 'control: the honest failure is still DENY today');
  // The gap: the ONLY assertion in the attacker that could stop it — accessSync(W_OK) — did not throw.
  // If an isolation boundary existed, the report would show an EACCES failure before the 1 !== 2 one.
  assert.equal(r.report.present, true);
  assert.equal(r.report.cases.length, 1);
  const failure = r.stdoutTail + JSON.stringify(r.report);
  assert.doesNotMatch(failure, /EACCES|EPERM|destination discoverable/,
    'reproduces D1.10: the test reached the verifier-owned report directory with write permission. When an isolation boundary exists this must fail with EACCES/EPERM and this file must be deleted');
});
