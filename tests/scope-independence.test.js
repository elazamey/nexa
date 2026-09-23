import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SevenGateValidator, NexaEvidenceBridge, ReconAgent, AutopilotEngine } from '../src/security/agentic-hunter.js';

/**
 * D1.5 (A12 / DI-13) — قرار النطاق من مصدر مستقل، لا من كلمة المتصل.
 *
 * كانت GATE_1 تكتب `pass: context.inScope !== false && !finding.outOfScope`: أي أن غياب
 * السياق نفسه يُقرأ ترخيصًا، وأن `Jbridge.gateContext ?? { inScope: true }` يهدي الإجابة
 * حين لا يمرّر أحد شيئًا، و`autopilot.js:55` كان يروي `{ inScope: true }` حرفيًا بعد أن
 * أجرى فحص نطاق حقيقي عند :39. الحارس هنا يثبت أن الإجابة صارت **مشتقة**: سجل نطاق
 * {target, allow, deny} يعيد المُقيِّم مطابقته بنفسه، ولا يُقبل نمط يبتلع كل المضيفين.
 *
 * الملف مستقل عن حراس D1.2/D1.3/D1.4: شلّ إصلاح D1.5 وحده يُحمرّ هذا الملف وحده.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stripComments = (src) => src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const SRC = (rel) => stripComments(fs.readFileSync(path.join(ROOT, 'src', 'security', 'hunter', rel), 'utf8'));

const artifact = {
  kind: 'pattern-trace',
  locator: 'endpoint:/api/v1/billing/101',
  evidence: { detector: 'detectIdor', matched: 'id-like path with authRequired' },
  producedBy: 'VulnEngine.detectIdor'
};

const finding = (extra = {}) => ({
  title: 'IDOR in Billing API',
  severity: 'HIGH',
  type: 'IDOR_BOLA',
  vulnClass: 'IDOR_BOLA',
  endpoint: '/api/v1/billing/101',
  description: 'Direct object reference permits unauthorized invoice access',
  cwe: 'CWE-639',
  impact: 'Unauthorized read and modification of other tenants’ billing records, exposing PII and invoice totals.',
  boundary: { from: 'authenticated caller', to: 'object owned by another principal', kind: 'authorization' },
  artifact,
  safeTesting: {
    nonDestructive: true,
    noServiceDisruption: true,
    method: 'surface-model-analysis',
    attestedBy: 'VulnEngine.detectIdor'
  },
  ...extra
});

const scope = (over = {}) => ({ scope: { target: 'api.example.com', allow: ['api.example.com'], deny: [], ...over } });
const gate1 = (result) => result.checks.find(c => c.id === 'GATE_1_SCOPE');
const denied = (result) => gate1(result).pass === false;
// التعليل على failedGates وحدها (نفس عقد D1.3: الرفض يفسَّر، والنجاح لا يُروى)
const reasonOf = (result) => (result.failedGates.find(g => g.id === 'GATE_1_SCOPE') || {}).reason ?? '';
const v = () => new SevenGateValidator();

test('D1.5: غياب السياق ليس ترخيصًا — وكلمة المتصل وحدها لا تُجيب البوابة', () => {
  for (const context of [undefined, {}, { inScope: true }, { inScope: 'yes' }, { scope: undefined }]) {
    const result = v().evaluateFinding(finding(), context);
    assert.ok(denied(result), `الوضع الحالي: GATE_1 مرّت بالسياق ${JSON.stringify(context)} — لا مصدر مستقل`);
    assert.match(reasonOf(result), /scope/i, 'الرفض بلا تعليل يسمّي النطاق');
  }
  // لا يُشترى المرور بحقل زائد: السياق المقتصر على ادعاء منطقي يظل مرفوضًا
  assert.ok(denied(v().evaluateFinding(finding(), { inScope: true, note: 'owner said it is fine' })));
});

test('D1.5: المُقيِّم يعيد المطابقة بنفسه — target خارج الأنماط يُرفض مهما مرّر المتصل', () => {
  const authorized = v().evaluateFinding(finding(), scope());
  assert.equal(gate1(authorized).pass, true, `نطاق مصرّح به رُفض: ${reasonOf(authorized)}`);

  // نفس الـ finding ونفس الإلحاح، والأنماط لا تشمل الهدف ⇒ رفض
  for (const allow of [['*.other-program.com'], ['victim.example.net', '*.example.org']]) {
    const result = v().evaluateFinding(finding(), scope({ allow, inScope: true }));
    assert.ok(denied(result), `target مُصرَّح بعكسه مرّ: ${JSON.stringify(allow)}`);
    assert.match(reasonOf(result), /target|api\.example\.com/, 'الرفض لم يسمّ المضيف المخالف');
  }

  // deny يسبق allow: مضيف مسموح به عام وممنوع صراحةً ⇒ رفض
  const denied_ = v().evaluateFinding(
    finding(),
    scope({ allow: ['*.example.com'], deny: ['api.example.com'] })
  );
  assert.ok(denied(denied_), 'deny لم يسقط الترخيص');
  assert.match(reasonOf(denied_), /deny|excluded/i);

  // سجل بلا allow = لا تفويض، لا «كل شيء مسموح» (نمط recon-agent المريح للعدّ فقط)
  assert.ok(denied(v().evaluateFinding(finding(), scope({ allow: [] }))));
  assert.ok(denied(v().evaluateFinding(finding(), scope({ allow: undefined }))));
});

test('D1.5: أصل الـ finding لا يستعير ترشيح هدفٍ غيره', () => {
  // endpoint مطلق على مضيف آخر: لا يغطيه ترخيص api.example.com
  for (const extra of [
    { endpoint: 'https://admin.internal/api/v1/billing/101' },
    { url: 'http://metadata.google.internal/computeMetadata/v1/' },
    { host: 'someone-else.example.org' },
    { asset: 'http://attacker.test/x' }
  ]) {
    const result = v().evaluateFinding(finding(extra), scope());
    assert.ok(denied(result), `finding على مضيف أجنبي استعار ترخيص الهدف: ${JSON.stringify(extra)}`);
    assert.match(reasonOf(result), /asset|host/i, 'الرفض لم يفرّق أصل الـ finding عن الهدف');
  }
  // مسار نسبي = مربوط بهدف الجولة نفسه ⇒ مقبول
  assert.equal(gate1(v().evaluateFinding(finding({ endpoint: '/api/v1/billing/202' }), scope())).pass, true);
  // ومضيف مطابق صريحًا داخل الـ finding ⇒ مقبول
  assert.equal(
    gate1(v().evaluateFinding(finding({ endpoint: 'https://api.example.com/v1/billing' }), scope())).pass,
    true
  );
});

test('D1.5: لا نمط يبتلع العالم — «*» ليس نطاقًا program', () => {
  for (const allow of [['*'], ['.*'], ['**'], ['.com'], ['com'], [''], ['   '], ['*.'], [/api/i]]) {
    const result = v().evaluateFinding(finding(), scope({ allow }));
    assert.ok(denied(result), `نمط يبتلع كل المضيفين قُبل: ${String(allow)}`);
    assert.match(reasonOf(result), /pattern|allow/i);
  }
  // والنقاط ليست نصوصًا: allow:'api.example.com' (مفرد لا مصفوفة) مرفوض
  assert.ok(denied(v().evaluateFinding(finding(), { scope: { target: 'api.example.com', allow: 'api.example.com' } })));
});

test('D1.5: caller يستطيع التضييق لا التوسيع — outOfScope/inScope:false قاطعان', () => {
  const marked = v().evaluateFinding(finding({ outOfScope: true }), scope());
  assert.ok(denied(marked), 'finding موسوم outOfScope مرّ بسجل نطاق صالح');
  assert.match(reasonOf(marked), /outOfScope/);
  const narrowed = v().evaluateFinding(finding(), { ...scope(), inScope: false });
  assert.ok(denied(narrowed), 'inScope:false من المستدعي لم يُحترم');
  // والسجل نفسه إذا تضمّن إنكارًا صريحًا ⇒ رفض حتى لو كان النمط مطابقًا
  assert.ok(denied(v().evaluateFinding(finding(), { scope: { target: 'api.example.com', allow: ['api.example.com'], authorized: false } })));
});

test('D1.5: الجسر يرفض افتراضيًا — لا { inScope: true } مُهداة عند غياب السياق', () => {
  const bridge = new NexaEvidenceBridge();
  const noContext = bridge.certifyFinding(finding(), 'api.example.com');
  assert.equal(noContext.certified, false, 'إيصال صدر بلا أي سجل نطاق');
  assert.ok(noContext.reasons.some(r => /GATE_1/.test(String(r))), 'الرفض لم يسمّ GATE_1');
  assert.equal(noContext.signature, undefined);

  const foreign = bridge.certifyFinding(finding(), 'api.example.com', {
    gateContext: scope({ allow: ['*.not-authorized.com'] })
  });
  assert.equal(foreign.certified, false, 'أنماط لا تشمل الهدف أنتجت إيصالًا');

  const ok = bridge.certifyFinding(finding(), 'api.example.com', { gateContext: scope() });
  assert.equal(ok.verified, true, 'المدخل المُرخَّص يجب أن يُصدِر: ' + JSON.stringify(ok.reasons));
  assert.equal(ok.gateScore, '7/7_PASSED');
  assert.ok(ok.signature);
  // حتمية §6.3: سجل النطاق لا يُدخل لحظة ولا عشوائية
  assert.equal(
    bridge.certifyFinding(finding(), 'api.example.com', { gateContext: scope() }).findingDigest,
    ok.findingDigest
  );

  // والافتراض المُهدى محظور في المصدر نفسه (على الأسطر التنفيذية، لا التعليقات)
  assert.doesNotMatch(
    SRC('nexa-evidence-bridge.js'),
    /gateContext[^\n]*\{[^\n]*inScope:\s*true/,
    'الجسر لا يزال يعوّض غياب السياق بسجل مُرخَّص'
  );
});

test('D1.5: أصل محلي — الجذر المُصرَّح به يحدّ، و«../» لا يستعير ترخيص الجار', () => {
  const local = (over = {}) => ({
    title: 'Hardcoded secret in source',
    severity: 'HIGH',
    type: 'SECRET_IN_SOURCE',
    vulnClass: 'SECRET_IN_SOURCE',
    file: '/repo/src/config.js',
    description: 'A credential is committed to the repository',
    cwe: 'CWE-798',
    impact: 'Committed credential grants read access to production data and can be harvested by any clone.',
    boundary: { from: 'repository reader', to: 'production credential store', kind: 'authorization' },
    artifact: {
      kind: 'content-match',
      locator: 'file:/repo/src/config.js#L12',
      evidence: { detector: 'secrets', matched: 'AKIA[0-9A-Z]{16}' },
      producedBy: 'SecretsHunter'
    },
    safeTesting: {
      nonDestructive: true,
      noServiceDisruption: true,
      method: 'source-inspection',
      attestedBy: 'SecretsHunter'
    },
    ...over
  });
  const ctx = (allow) => ({ scope: { target: '/repo', allow, deny: [] } });
  assert.ok(denied(v().evaluateFinding(local(), ctx([]))), 'allow فارغ في وضع المسار مرخِّص');
  assert.ok(denied(v().evaluateFinding(local(), ctx(['/']))), 'الجذر / يبتلع كل شيء — ليس نطاقًا');
  const escape = v().evaluateFinding(local({ file: '/repo/../etc/passwd' }), ctx(['/repo']));
  assert.ok(denied(escape), 'الخروج من الجذر المُصرَّح به مرّ');
  assert.match(reasonOf(escape), /outside|خارج|escap/i, 'الرفض لم يسمّ الخروج من الجذر');
  const outside = v().evaluateFinding(local({ file: '/etc/passwd' }), ctx(['/repo']));
  assert.ok(denied(outside), 'ملف خارج الجذر قُبل');
  assert.equal(gate1(v().evaluateFinding(local(), ctx(['/repo']))).pass, true, 'أصل داخل الجذر رُفض: ' + reasonOf(v().evaluateFinding(local(), ctx(['/repo']))));
  assert.equal(gate1(v().evaluateFinding(local({ file: 'src/config.js' }), ctx(['/repo']))).pass, true, 'المسار النسبي يجب أن يُفهم نسبةًا للهدف');
});

test('D1.5: autonomous loop يشتق السجل من recon ولا يروي حكمًا — وبلا إعدادٍ لا يُصدِر إيصالات', async () => {
  const src = SRC('autopilot.js');
  assert.doesNotMatch(src, /\{\s*inScope:\s*true\s*\}/, 'autopilot لا يزال يكتب قرار النطاق حرفيًا');
  assert.doesNotMatch(src, /gateContext:\s*\{\s*inScope:/, 'autopilot يمرّر ادعاءً منطقيًا بدل سجل نطاق');

  const configured = new AutopilotEngine({ inScopePatterns: ['*.testdomain.com', 'testdomain.com'] });
  const result = await configured.runFullLoop('testdomain.com');
  assert.equal(result.status, 'COMPLETED');
  assert.ok(result.validatedFindings.length > 0, 'جولة مُرخَّصة لم تُصدِر شيئًا: الحارس يشدّد بلا سبب');
  assert.ok(result.validatedFindings.every(f => f.receipt.verified === true && f.receipt.signature));

  // بلا أنماط: recon يعدّ السطح (إباحة عدّ معروفة)، لكن الشهادة مرفوضة عند GATE_1
  const unconfigured = new AutopilotEngine();
  const bare = await unconfigured.runFullLoop('loose-target.test');
  assert.equal(bare.validatedFindings.length, 0, 'جولة بلا نطاق موثّق حصلت على إيصالات');
  assert.equal(bare.reports.length, 0);

  // وReconAgent لا يبتكر allow-list حين لم يُضبط
  const agent = new ReconAgent();
  assert.deepEqual(agent.scopeRecord('anything.test').allow, [], 'recon اخترع تفويضًا من العدم');
  assert.equal(agent.isScopeAllowed('anything.test'), true, 'إباحة العدّ نفسها يجب أن تبقى كما هي (لا توسيع)');
  const set = new ReconAgent({ inScopePatterns: ['*.testdomain.com'] });
  assert.deepEqual(set.scopeRecord('testdomain.com'), {
    target: 'testdomain.com',
    allow: ['*.testdomain.com'],
    deny: []
  });
});
