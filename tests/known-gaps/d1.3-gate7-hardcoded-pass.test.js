import test from 'node:test';
import assert from 'node:assert/strict';
import { SevenGateValidator } from '../../src/security/agentic-hunter.js';

/**
 * known-gap D1.3 (A02) — GATE_7_SAFE_TESTING_COMPLIANCE بقرار ثابت.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.3.
 */

test('known-gap D1.3 (A02): GATE_7 تمر لكل finding مهما غاب دليل الاختبار الآمن', () => {
  const validator = new SevenGateValidator();
  const finding = {
    title: 'Anything',
    severity: 'LOW',
    file: 'x.js',
    description: 'لا يوجد أي دليل على اختبار آمن',
    cwe: 'CWE-000'
  };
  const result = validator.evaluateFinding(finding, { inScope: true });
  const gate7Failed = result.failedGates.some(g => g.id === 'GATE_7_SAFE_TESTING_COMPLIANCE');
  assert.equal(gate7Failed, false, 'الوضع الحالي: GATE_7 = pass:true حرفيًا (seven-gate-validator.js:56)');
});

test('known-gap D1.3 (A02): حتى مع safeTesting:false صراحةً تبقى البوابة ناجحة', () => {
  const validator = new SevenGateValidator();
  const finding = {
    title: 'Explicitly unsafe',
    severity: 'HIGH',
    file: 'x.js',
    description: 'دليل صريح على اختبار هادم',
    cwe: 'CWE-000',
    safeTesting: false
  };
  const result = validator.evaluateFinding(finding, { inScope: true });
  const gate7Failed = result.failedGates.some(g => g.id === 'GATE_7_SAFE_TESTING_COMPLIANCE');
  assert.equal(gate7Failed, false, 'الوضع الحالي: البوابة تتجاهل المدخل كليًا — غير محسوبة');
});
