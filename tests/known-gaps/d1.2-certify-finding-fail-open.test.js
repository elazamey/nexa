import test from 'node:test';
import assert from 'node:assert/strict';
import { SevenGateValidator, NexaEvidenceBridge } from '../../src/security/agentic-hunter.js';

/**
 * known-gap D1.2 (A01, A03, A07, A08, A10) — تذكرة src/ الأولى.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.2 (استبدالًا باختبار الانعكاس
 * tests/artifact-reader.test.js وفق عقد قارئ الـ artifact v0.3 §5.1/§6.1/§6.3/§10.9/§10.10).
 */

test('known-gap D1.2 (A01): certifyFinding يوقّع finding بلا artifact ويختم 7/7_PASSED دون أي تحقق', () => {
  const bridge = new NexaEvidenceBridge();
  const receipt = bridge.certifyFinding(
    { title: 'Unverified finding', severity: 'HIGH', type: 'TEST' },
    'api.example.com'
  );
  // السلوك الحالي المعيب: توقيع + ختم 7/7 + verified:true حرفيًا بلا أي بوابة قِيست
  assert.ok(receipt.signature, 'الوضع الحالي: يوقّع بلا دليل — إن فشل هذا فالتذكرة أُغلقت دون تحديث الملف');
  assert.equal(receipt.gateScore, '7/7_PASSED');
  assert.equal(receipt.verified, true);
});

test('known-gap D1.2 (A03): GATE_2 يمر بمجرد locator نصي بلا أي دليل إعادة إنتاج', () => {
  const validator = new SevenGateValidator();
  const finding = {
    title: 'Finding with bare locator',
    severity: 'HIGH',
    file: 'src/app.js',
    description: 'وصف نصي فقط بلا دليل',
    cwe: 'CWE-639'
  };
  const result = validator.evaluateFinding(finding, { inScope: true });
  const gate2Failed = result.failedGates.some(g => g.id === 'GATE_2_REPRODUCIBILITY');
  assert.equal(gate2Failed, false, 'الوضع الحالي: GATE_2 تمر بمجرد اسم ملف — مخالفة §5.1');
  assert.equal(result.score, '7/7', 'الوضع الحالي: 7/7 كاملة بلا artifact إطلاقًا');
});

test('known-gap D1.2 (A07): findingId مبني على Date.now() — الإيصال غير حتمي بنيويًا', () => {
  const bridge = new NexaEvidenceBridge();
  const receipt = bridge.certifyFinding({ title: 'X', severity: 'HIGH' }, 't');
  // المعرف الحالي بصيغة NEXA-EVID-<طابع زمني> — يخالف §6.3 (الحتمية)
  assert.match(receipt.findingId, /^NEXA-EVID-\d+$/, 'الوضع الحالي: معرف زمني لا مشتق من digest');
});

test('known-gap D1.2 (A08): verifyReceipt بلا ربط بالحمولة — إيصال «صالح» لأي finding مُستبدل', () => {
  const bridge = new NexaEvidenceBridge();
  const findingA = { title: 'Original', severity: 'HIGH', type: 'A' };
  const receipt = bridge.certifyFinding(findingA, 'api.example.com');
  assert.equal(bridge.verifyReceipt(receipt), true);
  // البوابة لا تقبل أصلًا وسيط finding لإعادة حساب digest — arity = 1 (لا ربط إطلاقًا)
  assert.equal(bridge.verifyReceipt.length, 1, 'الوضع الحالي: لا توجد واجهة ربط بالحمولة (§6.3)');
});

test('known-gap D1.2 (A10): signFinding يختم أي payload عام بـ 7/7_PASSED', () => {
  const bridge = new NexaEvidenceBridge();
  const receipt = bridge.signFinding({ event: 'release', tag: 'v9.9.9' });
  assert.ok(receipt.signature);
  assert.equal(receipt.gateScore, '7/7_PASSED', 'الوضع الحالي: ختم بوابات على payload ليس finding — خلط أصناف');
});
