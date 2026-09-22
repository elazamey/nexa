import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgenticBugHunter } from '../../src/security/agentic-hunter.js';

/**
 * known-gap D1.7 (A05, A06) — كواشف inline داخل المنسِّق + منطق أعمى للنطاق.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.7.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('known-gap D1.7 (A05): الكواشف الثلاثة مضمّنة في جسم المنسِّق لا وحدات مستقلة', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'security', 'agentic-hunter.js'), 'utf8');
  for (const type of ['UNHANDLED_ASYNC_ERROR', 'WEAK_CRYPTOGRAPHY', 'POTENTIAL_RESOURCE_LEAK']) {
    assert.ok(
      source.includes(type),
      `الوضع الحالي: الكاشف ${type} يعيش داخل agentic-hunter.js (اقتران بالمنسِّق)`
    );
  }
});

test('known-gap D1.7 (A06): async غير معالج حقيقيًا يُفقد بسبب try في دالة أخرى (عمى نطاق الملف)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-known-gap-d17-'));
  const filePath = path.join(dir, 'service.js');
  fs.writeFileSync(filePath, [
    'function handler() {',
    '  async function load() {',
    '    // لا معالجة أخطاء إطلاقًا في هذا النطاق',
    '    return await Promise.reject(new Error("boom"));',
    '  }',
    '  load();',
    '}',
    'function unrelated() {',
    '  try { syncWork(); } catch (e) { /* دالة أخرى لا علاقة لها */ }',
    '}',
    ''
  ].join('\n'), 'utf8');

  const hunter = new AgenticBugHunter(dir);
  hunter._inspectFile(filePath);

  const unhandled = hunter.findings.find(f => f.type === 'UNHANDLED_ASYNC_ERROR');
  // الوضع الحالي: الشرط يُقيَّم على محتوى الملف كاملًا (agentic-hunter.js:81) فيُقمع
  // الكشف الحقيقي بوجود try في دالة أخرى — false negative مضمون البنية
  assert.equal(unhandled, undefined, 'الوضع الحالي: كشف حقيقي قُمع بشرط على مستوى الملف كله');

  fs.rmSync(dir, { recursive: true, force: true });
});
