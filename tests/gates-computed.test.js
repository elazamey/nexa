import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SevenGateValidator, NexaEvidenceBridge } from '../src/security/agentic-hunter.js';

/**
 * D1.3 (A02 / DI-07) — GATE_7 محسوبة، ولا بوابة بقرار ثابت.
 *
 * كان `evaluateFinding` يكتب `pass: true` حرفيًا للبوابة السابعة: سؤال بلا مُجيب، وقاعدة
 * 7/7 تُغلق بسداسي محسوب + واحد مُهدى. الاختبار هنا مستقل عن اختبارات D1.4/D1.5: تعطيل
 * إصلاح D1.3 وحده يُحمرّ هذا الملف وحده.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATOR_SRC = path.join(ROOT, 'src', 'security', 'hunter', 'seven-gate-validator.js');

const artifact = {
  kind: 'pattern-trace',
  locator: 'endpoint:/api/v1/billing/101',
  evidence: { detector: 'detectIdor', matched: 'id-like path with authRequired' },
  producedBy: 'VulnEngine.detectIdor'
};

// سجل سلوك الاختبار — مُدخل حقيقي لا حكم: مربوط بمنتج الدليل نفسه
const safeTesting = {
  nonDestructive: true,
  noServiceDisruption: true,
  method: 'surface-model-analysis',
  attestedBy: 'VulnEngine.detectIdor'
};

const baseFinding = (extra = {}) => ({
  title: 'IDOR in Billing API',
  severity: 'HIGH',
  type: 'IDOR_BOLA',
  vulnClass: 'IDOR_BOLA',
  endpoint: '/api/v1/billing/101',
  description: 'Direct object reference permits unauthorized invoice access',
  impact: 'Tenant isolation breach',
  cwe: 'CWE-639',
  artifact,
  ...extra
});

const gate = (result, id) => result.checks.find(c => c.id === id);

test('D1.3: GATE_1..7 كلها محسوبة — لا pass حرفي في مصدر المُقيِّم', () => {
  const src = fs.readFileSync(VALIDATOR_SRC, 'utf8');
  const checksBody = src.slice(src.indexOf('const checks = ['), src.indexOf('const passedChecks'));
  assert.ok(checksBody.length > 100, 'لم يُعثر على مصفوفة البوابات — تغيّر شكل الملف؟ حدّث الحارس عمدًا');
  // سطر `pass: <قيمة>` يجب أن يكون تعبيرًا، لا حرفًا. التعليقات مستثناة لأن التعليق شرحٌ لا حكم.
  const lines = checksBody
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, ''))
    .filter(l => /^\s*pass:/.test(l));
  assert.equal(lines.length, 7, 'كل بوابة بسطر pass واحد — وجد ' + lines.length);
  for (const line of lines) {
    assert.doesNotMatch(
      line,
      /pass:\s*(true|false)\s*,?\s*$/,
      `بوابة بقيمة حرفية: ${line.trim()} — قرار مُهدى لا محسوب (DI-07)`
    );
  }
});

test('D1.3: finding بلا سجل اختبار آمن → GATE_7 تفشل، والسبب معلن', () => {
  const v = new SevenGateValidator();
  const result = v.evaluateFinding(baseFinding(), { inScope: true });
  const g7 = gate(result, 'GATE_7_SAFE_TESTING_COMPLIANCE');
  assert.equal(g7.pass, false, 'غياب الدليل لا يزال يُمرّر البوابة');
  assert.equal(result.isValid, false);
  assert.equal(result.score, '6/7');
  const failed = result.failedGates.find(g => g.id === 'GATE_7_SAFE_TESTING_COMPLIANCE');
  assert.ok(failed && typeof failed.reason === 'string' && failed.reason.length > 10, 'رفض بلا تعليل');
});

test('D1.3: شهادة عامة غير مربوطة بالدليل لا تكفي، والصريحة بالكذب تُرفض', () => {
  const v = new SevenGateValidator();
  const cases = {
    'attestedBy من منتج آخر': { ...safeTesting, attestedBy: 'SomeoneElse' },
    'بلا attestedBy': { nonDestructive: true, noServiceDisruption: true, method: 'surface-model-analysis' },
    'nonDestructive:false': { ...safeTesting, nonDestructive: false },
    'منفى صراحةً (false)': false,
    'نص لا سجل': 'we were careful',
    'method بلا هوية': { ...safeTesting, method: '  تم بحذر  ' },
    'يقر بقطع خدمة': { ...safeTesting, serviceDisrupted: true }
  };
  for (const [name, record] of Object.entries(cases)) {
    const result = v.evaluateFinding(baseFinding({ safeTesting: record }), { inScope: true });
    assert.equal(
      gate(result, 'GATE_7_SAFE_TESTING_COMPLIANCE').pass,
      false,
      `${name}: قُبل رغم أنه لا يصلح دليلًا`
    );
    assert.equal(result.isValid, false, `${name}: لا يزال يمرّ من قاعدة 7/7`);
  }
});

test('D1.3: سجل صالح ومربوط → البوابة السابعة محسوبة-ناجحة و7/7 محفوظة', () => {
  const v = new SevenGateValidator();
  const result = v.evaluateFinding(baseFinding({ safeTesting }), { inScope: true });
  assert.equal(gate(result, 'GATE_7_SAFE_TESTING_COMPLIANCE').pass, true);
  assert.equal(result.isValid, true, 'الدليل الصالح يجب أن يمرّ');
  assert.equal(result.score, '7/7');
  assert.equal(result.status, 'APPROVED_FOR_REPORT');
  assert.equal(result.checks.length, 7);
});

test('D1.3: السجل يُقبل من سياق الجولة بشرط أن يغطي نفس منتج الدليل', () => {
  const v = new SevenGateValidator();
  const fromContext = v.evaluateFinding(baseFinding(), { inScope: true, safeTesting });
  assert.equal(gate(fromContext, 'GATE_7_SAFE_TESTING_COMPLIANCE').pass, true);
  const wrongProducer = v.evaluateFinding(baseFinding(), {
    inScope: true,
    safeTesting: { ...safeTesting, attestedBy: 'VulnEngine.detectSsrf' }
  });
  assert.equal(gate(wrongProducer, 'GATE_7_SAFE_TESTING_COMPLIANCE').pass, false);
  // finding يحمل شهادته الخاصة: تُقدَّم على شهادة السياق (الأخصّ أولاً)
  const ownWins = v.evaluateFinding(baseFinding({ safeTesting: false }), { inScope: true, safeTesting });
  assert.equal(gate(ownWins, 'GATE_7_SAFE_TESTING_COMPLIANCE').pass, false);
});

test('D1.3: الجسر يعيد الحساب — شهادة ناقصة تُسقط الإيصال، ومحتوى مستقرّ يظل حتميًّا', () => {
  const bridge = new NexaEvidenceBridge();
  const without = bridge.certifyFinding(baseFinding(), 'api.example.com');
  assert.equal(without.certified, false);
  assert.equal(without.signature, undefined, 'إيصال وُقع رغم غياب دليل الاختبار الآمن');
  assert.ok(
    without.reasons.some(r => /GATE_7/.test(r)),
    'الرفض لم يسمّ البوابة السابعة: ' + JSON.stringify(without.reasons)
  );

  const full = baseFinding({ safeTesting });
  const first = bridge.certifyFinding(full, 'api.example.com');
  const second = bridge.certifyFinding(structuredClone(full), 'api.example.com');
  assert.equal(first.verified, true, 'الدليل الكامل يجب أن يُصدر إيصالًا: ' + JSON.stringify(first.reasons));
  assert.ok(first.signature, 'الإيصال بلا توقيع ليس إيصالًا');
  assert.equal(first.gateScore, '7/7_PASSED');
  assert.equal(second.findingDigest, first.findingDigest, 'الحقل الجديد كسر حتمية الحمولة (§6.3)');
  assert.equal(bridge.verifyReceipt(first, full), true);
});
