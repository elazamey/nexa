import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SevenGateValidator } from '../../src/security/agentic-hunter.js';

/**
 * known-gap D1.5 (A12) — قرار النطاق GATE_1 من سياق المتصل المُمرَّر حرفيًا.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.5.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('known-gap D1.5 (A12): GATE_1 تثق بكلمة المتصل inScope:true بلا أي مصدر مستقل', () => {
  const validator = new SevenGateValidator();
  const findingsWithoutScopeEvidence = [
    { title: 'a', severity: 'HIGH', file: 'x.js', description: 'd', cwe: 'CWE-000' },
    { title: 'b', severity: 'HIGH', file: 'y.js', description: 'd', cwe: 'CWE-000', scopeEvidence: undefined },
    { title: 'c', severity: 'HIGH', file: 'z.js', description: 'd', cwe: 'CWE-000', target: 'unknown.example.com' }
  ];
  for (const finding of findingsWithoutScopeEvidence) {
    const result = validator.evaluateFinding(finding, { inScope: true });
    const g1 = result.failedGates.some(g => g.id === 'GATE_1_SCOPE');
    assert.equal(g1, false, `الوضع الحالي: GATE_1 تمر بكلمة المتصل فقط لـ ${finding.title}`);
  }
});

test('known-gap D1.5 (A12): autopilot يمرر { inScope: true } حرفيًا إلى التقييم', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'security', 'hunter', 'autopilot.js'), 'utf8');
  assert.ok(
    source.includes("{ inScope: true }"),
    'الوضع الحالي: القرار مكتوب حرفيًا في autopilot.js:55 — لا اشتقاق من بيانات recon'
  );
});
