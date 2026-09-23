import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {


  ArtifactReader,
  SevenGateValidator,
  NexaEvidenceBridge,
  VulnEngine
} from '../src/security/agentic-hunter.js';

// D1.5 (DI-13): سياق النطاق سجلٌّ لا حكم — المُقيِّم يعيد مطابقته، ولا يُهدى الترخيص بغيابه.
const ctx = (target = 'api.example.com') => ({ scope: { target, allow: [target], deny: [] } });

/**
 * اختبار الانعكاس لتذكرة D1.2 — Artifact Reader + GATE_2 (§5.1) + certifyFinding (§6.1/§6.3)
 * وفق عقد قارئ الـ artifact v0.3-rebuild (docs/Artifact_Reader_Contract.md).
 *
 * هذا هو verification الحي للفجوة D1.2 في self-model/gaps.json:
 * نجاحه = القيود التعاقدية مفروضة فعلًا. فشله = انتكاسة يجب كسر البناء عندها.
 * كُتب قبل التنفيذ وأثبت فشله (أحمر) ثم عُكس (أخضر) — الشاهد: self-model/evidence/d1.2-*.log
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function validArtifact(overrides = {}) {
  return {
    kind: 'pattern-trace',
    locator: 'endpoint:/api/v1/billing/101',
    evidence: { detector: 'detectIdor', matched: 'id-like path with authRequired' },
    producedBy: 'VulnEngine.detectIdor',
    ...overrides
  };
}

function validFinding(overrides = {}) {
  return {
    title: 'IDOR in Billing API',
    severity: 'HIGH',
    description: 'Direct object reference permits unauthorized invoice access',
    cwe: 'CWE-639',
    endpoint: '/api/v1/billing/101',
    // D1.4 (DI-06): مسند الأثر مستقل عن الشدة — ادعاء يسمّي متجه ضرر
    impact: 'Unauthorized read and modification of other tenants’ billing records, exposing PII and invoice totals.',
    // D1.4 (DI-06): مسند الحدود — سجلّ {{from,to,kind}} مقيَّد بصنف الثغرة
    vulnClass: 'IDOR_BOLA',
    boundary: { from: 'authenticated caller', to: 'object owned by another principal', kind: 'authorization' },
    artifact: validArtifact(),
    // D1.3 (DI-07): GATE_7 محسوبة من سجل مربوط بمنتج الدليل — لا شهادة مهداة
    safeTesting: {
      nonDestructive: true,
      noServiceDisruption: true,
      method: 'surface-model-analysis',
      attestedBy: 'VulnEngine.detectIdor'
    },
    ...overrides
  };
}

// ---------- §4/§8: القارئ ----------

test('D1.2/§4: ArtifactReader يقبل artifact سليم البنية ويعيد نسخة منقّحة', () => {
  const reader = new ArtifactReader();
  const result = reader.validate(validArtifact());
  assert.equal(result.valid, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.artifact.producedBy, 'VulnEngine.detectIdor');
  assert.equal(result.artifact.kind, 'pattern-trace');
});

test('D1.2/§8: البنية الناقصة تُرفض بلا رمي (AR-E01..AR-E05)', () => {
  const reader = new ArtifactReader();
  const cases = [
    [null, 'AR-E01'],
    ['text', 'AR-E01'],
    [[], 'AR-E01'],
    [{}, 'AR-E02'],
    [{ kind: 'nope', locator: 'x', evidence: 'e', producedBy: 'd' }, 'AR-E02'],
    [{ kind: 'steps', locator: '  ', evidence: 'e', producedBy: 'd' }, 'AR-E03'],
    [{ kind: 'steps', locator: 'x', evidence: '   ', producedBy: 'd' }, 'AR-E04'],
    [{ kind: 'steps', locator: 'x', evidence: {}, producedBy: 'd' }, 'AR-E04'],
    [{ kind: 'steps', locator: 'x', evidence: 'e', producedBy: ' ' }, 'AR-E05']
  ];
  for (const [artifact, expectedCode] of cases) {
    const result = reader.validate(artifact);
    assert.equal(result.valid, false, `يجب رفض: ${JSON.stringify(artifact)}`);
    assert.ok(result.reasons.length > 0);
    assert.equal(result.reasons[0].code, expectedCode);
  }
});

test('D1.2/§8 (AR-E06): حقل الحكم الذاتي داخل artifact مرفوض مبدئيًا', () => {
  const reader = new ArtifactReader();
  const result = reader.validate(validArtifact({ verdict: 'definitely-vulnerable' }));
  assert.equal(result.valid, false);
  assert.equal(result.reasons[0].code, 'AR-E06');
});

test('D1.2/§10.9: استثناء أثناء القراءة يتحول إلى رفض معلَّل (AR-E00) لا انتشار', () => {
  const reader = new ArtifactReader();
  const explosive = {
    kind: 'steps',
    locator: 'x',
    get evidence() {
      throw new Error('boom');
    },
    producedBy: 'd'
  };
  const result = reader.validate(explosive);
  assert.equal(result.valid, false);
  assert.equal(result.reasons[0].code, 'AR-E00');
});

test('D1.2/§7: القارئ مستقل هيكليًا — لا يستورد كواشف ولا بوابات ولا جسرًا', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'security', 'hunter', 'artifact-reader.js'), 'utf8');
  const importLines = source.split('\n').filter(l => l.trim().startsWith('import'));
  assert.ok(importLines.length === 0, `القارئ يجب أن يكون بلا استيرادات، وجد: ${importLines.join(' | ')}`);
  // ولا يستورده كاشف: الكواشف تنتج artifacts ولا تحكم على صلاحيتها
  const vulnSource = fs.readFileSync(path.join(ROOT, 'src', 'security', 'hunter', 'vuln-engine.js'), 'utf8');
  assert.ok(!vulnSource.includes('ArtifactReader'), 'الكاشف لا يستورد القارئ (§7.2)');
});

// ---------- §5.1: GATE_2 ----------

test('D1.2/§5.1 (A03): GATE_2 تفشل بمجرد locator نصي بلا artifact', () => {
  const validator = new SevenGateValidator();
  const finding = validFinding();
  delete finding.artifact;
  const result = validator.evaluateFinding(finding, { inScope: true });
  const gate2 = result.failedGates.find(g => g.id === 'GATE_2_REPRODUCIBILITY');
  assert.ok(gate2, 'يجب أن تفشل GATE_2 بدون artifact');
  assert.equal(result.isValid, false);
});

test('D1.2/§5.1: GATE_2 تمر عبر artifact صالح — والبوابات السبع محسوبة ومعلنة', () => {
  const validator = new SevenGateValidator();
  const result = validator.evaluateFinding(validFinding(), ctx());
  assert.equal(result.score, '7/7');
  assert.equal(result.isValid, true);
  assert.ok(Array.isArray(result.checks) && result.checks.length === 7, 'evaluateFinding تعلن المساند السبعة المحسوبة');
  assert.ok(result.checks.every(c => c.pass === true));
});

// ---------- §6.1/§10.9/§10.10: certifyFinding ----------

test('D1.2/§6.1: رفض صريح بلا توقيع عند غياب artifact (A01/A04)', () => {
  const bridge = new NexaEvidenceBridge();
  const finding = validFinding();
  delete finding.artifact;
  const outcome = bridge.certifyFinding(finding, 'api.example.com');
  assert.equal(outcome.certified, false);
  assert.equal(outcome.code, 'NEXA-E-REJECTED');
  assert.ok(outcome.reasons.length > 0);
  assert.equal(outcome.verified, false);
  assert.equal(outcome.signature, undefined, 'الرفض ليس إيصالًا ولا يحمل توقيعًا');
});

test('D1.2/§10.10: لا إيصال ببوابات أقل من 7/7 (قاعدة 7/7)', () => {
  const bridge = new NexaEvidenceBridge();
  // artifact صالح لكن صنف never-submit يُسقط GATE_5. عدد البوابات الساقطة غير مثبَّت هنا
  // عمدًا: منذ D1.4 يسقط مع GATE_6 أيضًا (الصنف المعلوماتي لا يعبر حدًّا)، فالتعليق على
  // «7/7 أو لا» هو ما تختبره هذه الحالة — لا حساب السقوط الذي يخصّ تذكرة أخرى.
  const finding = validFinding({ vulnClass: 'MISSING_CSP_HEADER' });
  const outcome = bridge.certifyFinding(finding, 'api.example.com');
  assert.equal(outcome.certified, false);
  assert.notEqual(outcome.gateScore, '7/7');
  assert.ok(outcome.reasons.some(r => /GATE_5/.test(String(r))), 'الرفض لم يسمّ GATE_5');
  assert.ok(outcome.reasons.some(r => String(r).includes('NEXA-E-GATE')));
  assert.equal(outcome.signature, undefined);
});

test('D1.2/§6.1 (DI-08): الجسر يعيد التقييم بنفسه — gateCheck مزوَّر لا ينفع', () => {
  const bridge = new NexaEvidenceBridge();
  const finding = validFinding({
    // الإسقاط الحقيقي هنا بغياب الدليل (GATE_2/GATE_7) — شرط لا يتغيّر بتغيير بوابة أخرى
    artifact: undefined,
    boundary: undefined,
    gateCheck: { isValid: true, score: '7/7', status: 'APPROVED_FOR_REPORT', checks: [] } // تزوير مرفق
  });
  const outcome = bridge.certifyFinding(finding, 'api.example.com');
  assert.equal(outcome.certified, false, 'الجسر لا يثق بgateCheck المرفق من المتصل');
  assert.notEqual(outcome.gateScore, '7/7');
});

test('D1.2/§6.2: إيصال كامل عند استيفاء الشروط — الحقول من تحقق فعلي', () => {
  const bridge = new NexaEvidenceBridge();
  const receipt = bridge.certifyFinding(validFinding(), 'api.example.com', { gateContext: ctx() });
  assert.ok(receipt.signature);
  assert.ok(receipt.findingDigest);
  assert.ok(receipt.artifactDigest, 'الإيصال مربوط بدليله (artifactDigest)');
  assert.match(receipt.findingId, /^NEXA-EVID-[0-9a-f]{16}$/, 'المعرف مشتق من digest لا من الزمن');
  assert.equal(receipt.gateScore, '7/7_PASSED'); // الآن مشروطة بإعادة تقييم فعلية
  assert.equal(receipt.verified, true);
});

test('D1.2/§10.9: استثناء داخل certifyFinding يتحول إلى رفض معلَّل لا توقيع احتياطي', () => {
  const bridge = new NexaEvidenceBridge();
  const explosive = validFinding();
  Object.defineProperty(explosive, 'artifact', {
    get() {
      throw new Error('corrupted');
    },
    enumerable: true
  });
  const outcome = bridge.certifyFinding(explosive, 'api.example.com');
  assert.equal(outcome.certified, false);
  assert.equal(outcome.code, 'NEXA-E-REJECTED');
  assert.ok(outcome.reasons.some(r => String(r).includes('NEXA-E-EXCEPTION')));
  assert.equal(outcome.signature, undefined);
});

test('D1.2/A10: signFinding يخضع لنفس الصرامة — لا ختم بوابات على payloads عامة', () => {
  const bridge = new NexaEvidenceBridge();
  const outcome = bridge.signFinding({ event: 'release', tag: 'v9.9.9' });
  assert.equal(outcome.certified, false);
  assert.equal(outcome.signature, undefined);
});

// ---------- §6.3: الحتمية والربط ----------

test('D1.2/§6.3 (A07): الحتمية — نفس المدخلات نفس digest/findingId، ومفاتيح مرتبة', () => {
  const bridge = new NexaEvidenceBridge();
  const a = bridge.certifyFinding(validFinding(), 'api.example.com', { gateContext: ctx() });
  const b = bridge.certifyFinding(validFinding(), 'api.example.com', { gateContext: ctx() });
  assert.equal(a.findingDigest, b.findingDigest);
  assert.equal(a.findingId, b.findingId);

  // نفس المحتوى بترتيب مفاتيح مختلف (عميقًا) → نفس digest (canonicalJSON بمفاتيح مرتبة)
  const reordered = {
    artifact: {
      producedBy: 'VulnEngine.detectIdor',
      evidence: { matched: 'id-like path with authRequired', detector: 'detectIdor' },
      locator: 'endpoint:/api/v1/billing/101',
      kind: 'pattern-trace'
    },
    endpoint: '/api/v1/billing/101',
    cwe: 'CWE-639',
    description: 'Direct object reference permits unauthorized invoice access',
    severity: 'HIGH',
    title: 'IDOR in Billing API',
    // D1.3: السجل المطلوب — بمفاتيح مرتّبة عكس القالب، ليظل هذا الاختبار يقيس ترتيب المفاتيح
    safeTesting: {
      method: 'surface-model-analysis',
      attestedBy: 'VulnEngine.detectIdor',
      noServiceDisruption: true,
      nonDestructive: true
    },
    vulnClass: 'IDOR_BOLA',
    boundary: { kind: 'authorization', to: 'object owned by another principal', from: 'authenticated caller' },
    impact: 'Unauthorized read and modification of other tenants’ billing records, exposing PII and invoice totals.'
  };
  const c = bridge.certifyFinding(reordered, 'api.example.com', { gateContext: ctx() });
  assert.equal(c.findingDigest, a.findingDigest, 'canonicalization يجب أن يمحو أثر ترتيب المفاتيح');

  // هدف مختلف → digest مختلف
  const d = bridge.certifyFinding(validFinding(), 'other.example.com', { gateContext: ctx('other.example.com') });
  assert.notEqual(d.findingDigest, a.findingDigest);
});

test('D1.2/§6.3 (A08): الربط — verifyReceipt يعيد حساب الحمولة ويرفض المستبدلة', () => {
  const bridge = new NexaEvidenceBridge();
  const finding = validFinding();
  const receipt = bridge.certifyFinding(finding, 'api.example.com', { gateContext: ctx() });

  assert.equal(bridge.verifyReceipt(receipt), true, 'فحص التوقيع وحده كما كان');
  assert.equal(bridge.verifyReceipt(receipt, finding), true, 'الربط بالحمولة الأصلية ينجح');

  const swapped = validFinding({ title: 'TOTALLY DIFFERENT FINDING' });
  assert.equal(bridge.verifyReceipt(receipt, swapped), false, 'إيصال صالح مع حمولة مستبدلة يُرفض');

  const tampered = { ...receipt, findingDigest: 'bad_digest_hash' };
  assert.equal(bridge.verifyReceipt(tampered), false);
});

// ---------- DI-02: الكواشف تنتج artifacts ----------

test('D1.2/DI-02: VulnEngine.scanSurface يرفق artifacts بنتائجه (provenance)', () => {
  const engine = new VulnEngine();
  const surface = {
    endpoints: [{ path: '/api/v1/user/:id', method: 'GET', authRequired: true }],
    parameters: [{ name: 'redirect_url', type: 'url', sink: 'Open Redirect / SSRF' }]
  };
  const findings = engine.scanSurface(surface);
  assert.ok(findings.length >= 2);
  const reader = new ArtifactReader();
  for (const f of findings) {
    assert.ok(f.artifact, `النتيجة ${f.vulnClass} بلا artifact`);
    assert.match(f.artifact.producedBy, /^VulnEngine\./);
    assert.equal(reader.validate(f.artifact).valid, true, `artifact الكاشف يجب أن يجتاز القارئ`);
  }
});
