import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SevenGateValidator, NexaEvidenceBridge, VulnEngine, ReconAgent } from '../src/security/agentic-hunter.js';

/**
 * D1.4 (A09 / DI-06) — مسندان متمايزان: أثر ملموس، وعبور حدّ فعلي.
 *
 * كان GATE_3 وGATE_6 يقرآن نفس الشرط حرفيًا (`severity ∈ {CRITICAL,HIGH,MEDIUM}`) — أي أن
 * «الأسئلة السبعة» خمسة، وأن قاعدة 7/7 تُغلَّق بإجابة واحدة مرتين. هنا يُفصل المسندان:
 * الأثر من مضمون ادعاء الـ impact، وعبور الحدود من سجل `boundary {from,to,kind}` مقيَّدًا
 * بجدول أصناف — والشدة لا تدخل قرار الحدود إطلاقًا.
 *
 * هذا الملف مستقل عن tests/gates-computed.test.js (D1.3): شلّ إصلاح D1.4 وحده يُحمرّ هذا وحده.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATOR_SRC = path.join(ROOT, 'src', 'security', 'hunter', 'seven-gate-validator.js');

const artifact = {
  kind: 'pattern-trace',
  locator: 'endpoint:/api/v1/billing/101',
  evidence: { detector: 'detectIdor', matched: 'id-like path with authRequired' },
  producedBy: 'VulnEngine.detectIdor'
};

const safeTesting = {
  nonDestructive: true,
  noServiceDisruption: true,
  method: 'surface-model-analysis',
  attestedBy: 'VulnEngine.detectIdor'
};

const goodImpact = 'Unauthorized read and modification of other tenants’ billing records, exposing PII and invoice totals.';
const goodBoundary = { from: 'authenticated caller', to: 'object owned by another principal', kind: 'authorization' };

const finding = (extra = {}) => ({
  title: 'IDOR in Billing API',
  severity: 'HIGH',
  type: 'IDOR_BOLA',
  vulnClass: 'IDOR_BOLA',
  endpoint: '/api/v1/billing/101',
  description: 'Direct object reference permits unauthorized invoice access',
  cwe: 'CWE-639',
  impact: goodImpact,
  boundary: goodBoundary,
  artifact,
  safeTesting,
  ...extra
});

const gate = (result, id) => result.checks.find(c => c.id === id);

// D1.5 (DI-13): سجل نطاق صالح كسياق — ليُقاس أثر/حدّ كل حالة وحدها، ولا تُهدى GATE_1 بالكلام
const ctx = (target = 'api.example.com') => ({ scope: { target, allow: [target], deny: [] } });
const v = () => new SevenGateValidator();

test('D1.4: البوابتان محسوبتان من مسندين مختلفين — لا مرآة لشرط واحد', () => {
  const src = fs.readFileSync(VALIDATOR_SRC, 'utf8');
  const body = src.slice(src.indexOf('const checks = ['), src.indexOf('const passedChecks'));
  const lineFor = (id) => {
    const i = body.indexOf(`'${id}'`);
    assert.ok(i >= 0, `${id} مفقودة من المُقيِّم`);
    const seg = body.slice(i, body.indexOf('},', i));
    const pass = seg.match(/pass:\s*([^\n]+)/);
    assert.ok(pass, `${id}: بلا سطر pass`);
    return pass[1].trim().replace(/,$/, '');
  };
  const g3 = lineFor('GATE_3_DEMONSTRABLE_IMPACT');
  const g6 = lineFor('GATE_6_BOUNDARY_BYPASS');
  assert.notEqual(g3, g6, 'البوابتان تقرآن نفس التعبير — المسند مكرر (DI-06)');
  for (const [id, expr] of [['GATE_3', g3], ['GATE_6', g6]]) {
    assert.doesNotMatch(
      expr,
      /severity|CRITICAL|HIGH|MEDIUM/,
      `${id} لا تزال تُحكم بالشدة: ${expr} — الشدة ليست دليل أثر ولا دليل عبور حد`
    );
  }
});

test('D1.4: التمايز الفعلي — شدة عالية بلا دليل حدّ تُسقط GATE_6 وتُبقي GATE_3، وبالعكس', () => {
  // HIGH + أثر ملموس + لا سجل حدود: A09 الحالي كان يمرّر الاثنين
  const highNoBoundary = v().evaluateFinding(finding({ boundary: undefined }), ctx());
  assert.equal(gate(highNoBoundary, 'GATE_3_DEMONSTRABLE_IMPACT').pass, true, 'الأثر الملموس يجب أن يُعترف به');
  assert.equal(gate(highNoBoundary, 'GATE_6_BOUNDARY_BYPASS').pass, false, 'لا عبور حدّ مبيَّن — البوابة تُرفض');
  assert.equal(highNoBoundary.score, '6/7');

  // INFO (شدة غير تقريرية) + عبور حدّ مبيَّن: GATE_6 تُحكم بدليلها فتنجح، و GATE_3 لا تُهدى بالشدة
  const infoBoundary = v().evaluateFinding(
    finding({ severity: 'INFO', impact: 'Attacker can read and exfiltrate other users’ private documents via the parameter.' }),
    ctx()
  );
  assert.equal(gate(infoBoundary, 'GATE_6_BOUNDARY_BYPASS').pass, true, 'دليل العبور مستقل عن الشدة');
  assert.equal(gate(infoBoundary, 'GATE_3_DEMONSTRABLE_IMPACT').pass, true, 'الأثر المذكور ملموس بمقياسه لا بشدته');
  assert.equal(infoBoundary.isValid, true, '7/7 تُحصَّل بالمساند السبعة المحسوبة لا بالشدة');

  // وأثر مُبهَم بلا متجه ضرر + حدّ مبيَّن → GATE_3 وحدها تسقط
  const vague = v().evaluateFinding(finding({ impact: 'This may possibly be a problem in theory.' }), ctx());
  assert.equal(gate(vague, 'GATE_3_DEMONSTRABLE_IMPACT').pass, false, 'ادعاء متردد/عام يبقى أثرًا');
  assert.equal(gate(vague, 'GATE_6_BOUNDARY_BYPASS').pass, true, 'سجل الحدود لا يتأثر بصياغة الأثر');
});

test('D1.4: جدول الأصناف يحكم عبور الحدود — لا صنف مجهول ولا kind مُختلَق ولا طرفان متماثلان', () => {
  const cases = {
    'بلا سجل': { boundary: undefined },
    'كائن فارغ': { boundary: {} },
    'نص بدل السجل': { boundary: 'it crosses a boundary' },
    'طرفان متماثلان': { boundary: { from: 'user', to: 'user', kind: 'authorization' } },
    'kind لا يطابق الصنف': { boundary: { ...goodBoundary, kind: 'physical' } },
    // نفس السجل الصالح، لكن الصنف غير مُسجَّل كعابر لحدّ: الرفض للصنف لا للسجل
    'صنف غير مُسجَّل': {
      boundary: goodBoundary,
      vulnClass: 'SOFTWARE_BANNER_DISCLOSURE',
      type: 'SOFTWARE_BANNER_DISCLOSURE'
    }
  };
  for (const [name, extra] of Object.entries(cases)) {
    const result = v().evaluateFinding(finding(extra), ctx());
    assert.equal(gate(result, 'GATE_6_BOUNDARY_BYPASS').pass, false, `${name}: قُبل بلا دليل حدود صالح`);
    const failed = result.failedGates.find(g => g.id === 'GATE_6_BOUNDARY_BYPASS');
    assert.ok(failed && typeof failed.reason === 'string' && failed.reason.length > 8, `${name}: رفض بلا تعليل`);
  }
  // نفس الـ kind قد يكون مشروعًا لصنف آخر: SSRF ↔ network
  const ssrf = finding({
    vulnClass: 'SSRF',
    type: 'SSRF',
    boundary: { from: 'user-controlled parameter', to: 'server-side network location', kind: 'network' },
    impact: 'The server can be driven to read internal cloud metadata and scan intranet services.',
    artifact: { ...artifact, producedBy: 'VulnEngine.detectSsrf' },
    safeTesting: { ...safeTesting, attestedBy: 'VulnEngine.detectSsrf' }
  });
  assert.equal(gate(v().evaluateFinding(ssrf, ctx()), 'GATE_6_BOUNDARY_BYPASS').pass, true);
});

test('D1.4: الأثر يُحاكم بمضمونه — لا بطوله ولا بكلمة سحرية', () => {
  const rejected = {
    'فارغ': '',
    'مُبتوَر': 'data leak',
    'متردد': 'This could potentially expose some data to a determined attacker.',
    'بلا متجه ضرر': 'The endpoint behavior differs from the documented example in minor ways only.',
    'مصفوفة': [],
    'كذب بالنوع': 42
  };
  for (const [name, impact] of Object.entries(rejected)) {
    const result = v().evaluateFinding(finding({ impact }), ctx());
    assert.equal(gate(result, 'GATE_3_DEMONSTRABLE_IMPACT').pass, false, `${name}: قُبل كأثر ملموس`);
  }
  for (const impact of [
    'Attackers can read and exfiltrate other users’ private documents through the parameter.',
    'Double-spending of coupons is possible: balances are decremented after redemption completes.',
    'Full database compromise and authentication bypass follow from the unparameterised query.'
  ]) {
    const result = v().evaluateFinding(finding({ impact }), ctx());
    assert.equal(gate(result, 'GATE_3_DEMONSTRABLE_IMPACT').pass, true, `أثر ملموس رُفض: ${impact.slice(0, 28)}…`);
  }
});

test('D1.4: المُنتِجون يصرّحون بحدودهم — كل finding من scanSurface له سجلٌّ صنفُه مصرّح به', () => {
  const engine = new VulnEngine();
  const surface = new ReconAgent({ inScopePatterns: ['*.testdomain.com'] }).mapSurface('testdomain.com');
  const findings = engine.scanSurface(surface);
  assert.ok(findings.length > 0, 'لم يُنتَج أي finding — لا شيء يُفحص');
  for (const f of findings) {
    assert.ok(f.boundary && typeof f.boundary === 'object', `${f.vulnClass}: بلا سجل حدود`);
    assert.ok(typeof f.boundary.from === 'string' && f.boundary.from.trim() !== '', `${f.vulnClass}: from غائب`);
    assert.notEqual(f.boundary.from, f.boundary.to, `${f.vulnClass}: طرفان متماثلان`);
    const result = new SevenGateValidator().evaluateFinding(f, ctx('testdomain.com'));
    assert.equal(
      gate(result, 'GATE_6_BOUNDARY_BYPASS').pass,
      true,
      `${f.vulnClass}: عبور الحدود مرفوع له صراحةً وبقي مرفوضًا (${JSON.stringify(result.failedGates)})`
    );
    assert.equal(
      gate(result, 'GATE_3_DEMONSTRABLE_IMPACT').pass,
      true,
      `${f.vulnClass}: أثر الكاشف نفسه يجب أن يكون كافيًا بمقياسه`
    );
  }
});

test('D1.4: الجسر يعيد الحساب ويسمّي البوابة الساقطة — وقاعدة 7/7 محفوظة للطرفين', () => {
  const bridge = new NexaEvidenceBridge();
  const noBoundary = bridge.certifyFinding(finding({ boundary: undefined }), 'api.example.com', { gateContext: ctx() });
  assert.equal(noBoundary.certified, false);
  assert.equal(noBoundary.signature, undefined);
  assert.ok(
    noBoundary.reasons.some(r => /GATE_6/.test(r)),
    'الرفض لم يسمّ GATE_6: ' + JSON.stringify(noBoundary.reasons)
  );

  const complete = bridge.certifyFinding(finding(), 'api.example.com', { gateContext: ctx() });
  assert.equal(complete.verified, true, 'المدخل الكامل يجب أن يُقبل: ' + JSON.stringify(complete.reasons));
  assert.equal(complete.gateScore, '7/7_PASSED');
  assert.equal(
    bridge.certifyFinding(structuredClone(finding()), 'api.example.com', { gateContext: ctx() }).findingDigest,
    complete.findingDigest,
    'الحقول الجديدة كسرت حتمية §6.3'
  );
});
