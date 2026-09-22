import test from 'node:test';
import assert from 'node:assert/strict';
import { SevenGateValidator } from '../../src/security/agentic-hunter.js';

/**
 * known-gap D1.4 (A09) — انهيار GATE_3 وGATE_6 في مسند واحد.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.4.
 */

test('known-gap D1.4 (A09): مصفوفة الشدات تُظهر أن GATE_3 ≡ GATE_6 دائمًا', () => {
  const validator = new SevenGateValidator();
  const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'WHATEVER'];

  const collapses = [];
  for (const severity of severities) {
    const finding = {
      title: `Finding ${severity}`,
      severity,
      file: 'x.js',
      description: 'd',
      cwe: 'CWE-000'
    };
    const result = validator.evaluateFinding(finding, { inScope: true });
    const g3 = result.failedGates.some(g => g.id === 'GATE_3_DEMONSTRABLE_IMPACT');
    const g6 = result.failedGates.some(g => g.id === 'GATE_6_BOUNDARY_BYPASS');
    if (g3 !== g6) collapses.push(severity);
  }

  // الوضع الحالي: لا توجد شدة تفصل بين البوابتين — المسندان متطابقان دلاليًا
  assert.deepEqual(collapses, [], 'الوضع الحالي: GATE_3 وGATE_6 مسند واحد مكرر — «السبعة» فعليًا خمسة');
});

test('known-gap D1.4 (A09): بوابة «عبور الحدود» تُحكم بـ severity وحدها لا بدليل عبور', () => {
  const validator = new SevenGateValidator();
  // finding بلا أي دليل عبور حد (لا boundary ولا tenant) — تكفي شدة HIGH لتمرير GATE_6
  const finding = {
    title: 'No boundary evidence at all',
    severity: 'HIGH',
    file: 'x.js',
    description: 'd',
    cwe: 'CWE-000'
  };
  const result = validator.evaluateFinding(finding, { inScope: true });
  const g6 = result.failedGates.some(g => g.id === 'GATE_6_BOUNDARY_BYPASS');
  assert.equal(g6, false, 'الوضع الحالي: GATE_6 لا تنظر لأي دليل حدود — نفس شرط GATE_3');
});
