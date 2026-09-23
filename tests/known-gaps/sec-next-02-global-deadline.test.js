import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judge, runTests } from '../../tools/celia-verify-runner.mjs';

/**
 * known-gap D1.9 (SEC-NEXT-02) — verify-run has a per-file timeout but no global deadline.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفجوة الحالية، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق SEC-NEXT-02 (docs/agent-loop.md §9).
 */
const SLOW = `import test from 'node:test';
test('slow but under the per-file limit', () => new Promise(r => setTimeout(r, 400)));\n`;

test('known-gap D1.9 (SEC-NEXT-02): three files each under the per-file timeout exceed it in total and still judge PASS', { timeout: 30_000 }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'nexa-sec-next-02-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = ['a', 'b', 'c'].map(n => { const f = join(dir, `${n}.test.mjs`); writeFileSync(f, SLOW); return f; });
  const perFileTimeoutMs = 1_000; // each file takes ~450-550ms; three of them exceed this in total
  const run = runTests({ files, cwd: dir, timeoutMs: perFileTimeoutMs });
  assert.ok(run.durationMs > perFileTimeoutMs, `total ${run.durationMs}ms exceeded the only deadline that exists (${perFileTimeoutMs}ms per file)`);
  assert.ok(run.results.every(r => !r.timedOut), 'no single file timed out');
  // The gap: nothing bounds the whole run, so the verdict is still PASS.
  assert.equal(judge(run), true, 'reproduces the gap; when a global deadline exists this must become false and this file must be deleted');
});
