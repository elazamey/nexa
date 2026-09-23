import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgenticBugHunter, ReportWriter, AutopilotEngine } from '../src/security/agentic-hunter.js';

/**
 * D1.8 (A13 / DI-17) — أرقام التقرير مطابقة للإيصالات الصادرة، لا لأكثر ولا لأقل.
 *
 * كان `_generateReport` يضع كل `triage.validated` في `details` مهما كانت نتيجة الإيصال، ويعدّ
 * الشدات على كل ما أُبلِغ بلا إعلان أساس، ويطبع «Saved to dashboard/data/bug-report.json» سواء
 * كُتب هناك أم لا (ومسار الاختبار دائمًا غيره)، ويوقّع report-writer كل markdown بـ
 * «7/7 PASSED» و«cryptographically pre-validated» بلا نظر في إيصال. العقد هنا: detail واحد لكل
 * إيصال صادر، وعدّادات معلنة العلاقة، وأساس معلن للشدات، وتذييل مشتق من الإيصال نفسه.
 *
 * ملاحظة توافق: الحقول القديمة تبقى بمعناها (totalIssues = المُبلَّغ)، والجديد معلن بجانبها —
 * إضافة لا استبدال، التزامًا بقيد التغيير التوافقي.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSrc = (...rel) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `nexa-d18-${label}-`));

const COMPLETE = (name, extra = {}) => ({
  title: `${name} in Billing API`,
  type: 'IDOR_BOLA',
  vulnClass: 'IDOR_BOLA',
  severity: 'HIGH',
  file: `src/${name}.js`,
  line: 3,
  cwe: 'CWE-639',
  description: 'Direct object reference permits unauthorized invoice access',
  impact: 'Unauthorized read and modification of other tenants’ billing records, exposing PII and invoice totals.',
  boundary: { from: 'authenticated caller', to: 'object owned by another principal', kind: 'authorization' },
  artifact: {
    kind: 'content-match',
    locator: `file:src/${name}.js#L3`,
    evidence: { detector: 'stub', matched: 'id-like path with authRequired' },
    producedBy: 'StubDetector'
  },
  safeTesting: {
    nonDestructive: true,
    noServiceDisruption: true,
    method: 'static-source-analysis',
    attestedBy: 'StubDetector'
  },
  ...extra
});

function huntDir(dir) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'const x = 1;\n', 'utf8');
}

function hunterWith({ refuse = () => false, reportPath } = {}) {
  const dir = tmp('hunt');
  huntDir(dir);
  const hunter = new AgenticBugHunter(dir);
  const real = hunter.evidenceBridge;
  hunter.findings = [COMPLETE('a'), COMPLETE('b'), COMPLETE('c', { severity: 'LOW' })];
  hunter.evidenceBridge = {
    certifyFinding(finding, target, options) {
      if (refuse(finding)) {
        return { certified: false, verified: false, code: 'NEXA-E-STUB-REFUSED', reasons: ['إيصال مرفوض في الاختبار'] };
      }
      return real.certifyFinding(finding, target, options);
    }
  };
  return { hunter, dir, reportPath };
}

test('D1.8: تفصيل واحد لكل إيصال صادر — والمرفوض في سجله بلا تزيين', () => {
  const { hunter, dir } = hunterWith({ refuse: f => f.title.startsWith('b') });
  const previousEnv = process.env.NEXA_BUG_REPORT;
  const reportPath = path.join(dir, 'out', 'bug-report.json');
  process.env.NEXA_BUG_REPORT = reportPath;
  try {
    const summary = hunter._generateReport();
    assert.equal(summary.counts.validated, 3, 'ثلاثة مُصرَّح بها عند المُقيِّم');
    assert.equal(summary.counts.certified, 2, 'إيصالان صدرا فقط');
    assert.equal(summary.counts.refused, 1);
    assert.equal(summary.counts.asserted, 3, 'asserted = كل ما أُبلِغ قبل البوابات');
    assert.equal(summary.details.length, summary.counts.certified, 'details لا تطابق عدد الإيصالات الصادرة');
    assert.ok(summary.details.every(d => d.receipt.verified === true && typeof d.receipt.signature === 'string' && d.receipt.certified !== false));
    assert.ok(!summary.details.some(d => d.title.startsWith('b')), 'المرفوض تسرّب إلى details');
    assert.equal(summary.refused.length, 1);
    assert.equal(summary.refused[0].code, 'NEXA-E-STUB-REFUSED');
    assert.ok(Array.isArray(summary.refused[0].reasons) && summary.refused[0].reasons.length > 0, 'رفض بلا تعليل في التقرير');
    // العلاقة مُوثَّقة: كل detail مربوط بإيصاله بالمعرّف لا بالاسم
    for (const d of summary.details) {
      assert.equal(d.findingId, d.receipt.findingId);
      assert.match(d.findingId, /^NEXA-EVID-[0-9a-f]{16}$/);
      assert.ok(d.artifactDigest && d.artifactDigest === d.receipt.artifactDigest);
    }
    // والحقل القديم يبقى بمعنى معلن (توافق) — totalIssues = المُبلَّغ، لا المصدَّق
    assert.equal(summary.totalIssues, summary.counts.asserted);
    assert.equal(summary.certified, summary.counts.certified);
    // والمكتوب في القرص = المُعاد نفسه في الحقول المقيسة
    const onDisk = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.deepEqual(
      { counts: onDisk.counts, details: onDisk.details.map(d => d.findingId), refused: onDisk.refused.map(r => r.code) },
      { counts: summary.counts, details: summary.details.map(d => d.findingId), refused: summary.refused.map(r => r.code) },
      'الملف المكتوب لا يطابق المُعاد من التقرير'
    );
    assert.equal(summary.persistence.ok, true);
    assert.equal(summary.persistence.path, path.resolve(reportPath));
  } finally {
    if (previousEnv === undefined) delete process.env.NEXA_BUG_REPORT;
    else process.env.NEXA_BUG_REPORT = previousEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D1.8: أساس الأرقام معلن — شدات المُبلَّغ غير شدات المُصدَّق', () => {
  const { hunter, dir } = hunterWith({ refuse: () => true }); // لا إيصال صادر إطلاقًا
  const previousEnv = process.env.NEXA_BUG_REPORT;
  process.env.NEXA_BUG_REPORT = path.join(dir, 'bug-report.json');
  try {
    const summary = hunter._generateReport();
    assert.equal(summary.severityBasis, 'asserted', 'الأرقام القديمة بلا أساس معلن');
    assert.equal(summary.high + summary.low, 3);
    assert.equal(summary.counts.certified, 0);
    assert.equal(summary.details.length, 0);
    assert.deepEqual(summary.certifiedSeverity, { critical: 0, high: 0, medium: 0, low: 0 }, 'شدات المُصدَّق تُحسب على المُصدَّق');
    assert.equal(summary.certifiedSeverityBasis, 'certified');
    // ولا رقم مُعلَّق على لا شيء: totalIssues لا يُقرأ وحده كـ«أحكام»
    assert.equal(summary.certified, 0, 'certified يجب أن يكون صفرًا معلنًا لا غائبًا');
  } finally {
    if (previousEnv === undefined) delete process.env.NEXA_BUG_REPORT;
    else process.env.NEXA_BUG_REPORT = previousEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D1.8: الفشل في الكتابة يُبلَّغ ولا يُزَفَّف حفظًا، والرسالة تذكر المسار الحقيقي', () => {
  const source = readSrc('src', 'security', 'agentic-hunter.js');
  assert.doesNotMatch(
    source.replace(/^\s*\/\/.*$/gm, ''),
    /Saved to dashboard\/data\/bug-report\.json/,
    'المسار لا يزال حرفيًا في السطر المطبوع بدل reportPath'
  );
  assert.match(source, /persistence/, 'لا حالة حفظ معلنة في التقرير');

  const dir = tmp('writefail');
  huntDir(dir);
  fs.writeFileSync(path.join(dir, 'blocker'), 'x', 'utf8');
  const previousEnv = process.env.NEXA_BUG_REPORT;
  process.env.NEXA_BUG_REPORT = path.join(dir, 'blocker', 'bug-report.json'); // الأب ملف ⇒ فشل
  try {
    const hunter = new AgenticBugHunter(dir);
    hunter.findings = [COMPLETE('a')];
    const summary = hunter._generateReport();
    assert.equal(summary.persistence.ok, false, 'فشل الكتابة لم يُبلَّغ');
    assert.equal(summary.persistence.code, 'NEXA-REPORT-WRITE-FAILED');
    assert.ok(summary.persistence.reason.length > 8);
    // التقرير ما زال صالحًا الاستهلاك في الذاكرة، لكنه لا يدّعي أنه حُفظ
    assert.equal(summary.counts.asserted, 1);
  } finally {
    if (previousEnv === undefined) delete process.env.NEXA_BUG_REPORT;
    else process.env.NEXA_BUG_REPORT = previousEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D1.8: التذييل مشتق من الإيصال — لا 7/7 ولا «pre-validated» بلا توقيع', () => {
  const writer = new ReportWriter();
  const issued = {
    severity: 'HIGH',
    title: 'IDOR',
    description: 'd',
    impact: 'i',
    receipt: {
      verified: true,
      findingId: 'NEXA-EVID-0123456789abcdef',
      gateScore: '7/7_PASSED',
      signature: 'a'.repeat(128)
    }
  };
  const certifiedMark = writer.generateHackerOneReport(issued, 'api.example.com');
  assert.match(certifiedMark, /NEXA-EVID-0123456789abcdef/, 'الإيصال الصادر لا يُذكر في التقرير — العلاقة غير موثَّقة');
  assert.match(certifiedMark, /7\/7_PASSED/);
  assert.doesNotMatch(certifiedMark, /7\/7 PASSED/, 'النص الثابت عاد بدل قيمة الإيصال');

  const bareMark = writer.generateHackerOneReport({ severity: 'LOW', title: 'x', description: 'd', impact: 'i' }, 'api.example.com');
  assert.doesNotMatch(bareMark, /7\/7/, 'تذييل يروّي بوابات لfinding بلا إيصال');
  assert.doesNotMatch(bareMark, /cryptographically pre-validated/, 'ادعاء تحقق تشفيري بلا توقيع');
  assert.match(bareMark, /NOT CERTIFIED|لا إيصال/i);

  const refusedMark = writer.generateHackerOneReport(
    { severity: 'HIGH', title: 'x', description: 'd', impact: 'i', receipt: { certified: false, code: 'NEXA-E-REJECTED', reasons: ['GATE_6: no boundary record'] } },
    'api.example.com'
  );
  assert.match(refusedMark, /NEXA-E-REJECTED/);
  assert.match(refusedMark, /GATE_6/);
  assert.doesNotMatch(refusedMark, /7\/7/);
});

test('D1.8: تقارير الجولة الذاتية مربوطة بإيصالاتها، وبلا إيصال لا تُروَّج', async () => {
  const dir = tmp('autopilot');
  const previousEnv = process.env.NEXA_BUG_REPORT;
  process.env.NEXA_BUG_REPORT = path.join(dir, 'bug-report.json');
  try {
    const autopilot = new AutopilotEngine({ inScopePatterns: ['*.testdomain.com', 'testdomain.com'] });
    const result = await autopilot.runFullLoop('testdomain.com');
    assert.ok(result.reports.length > 0, 'لا تقارير — لا شيء يُقاس');
    for (const report of result.reports) {
      assert.ok(report.findingId && /^NEXA-EVID-[0-9a-f]{16}$/.test(report.findingId));
      assert.match(report.markdown, new RegExp(report.findingId), 'markdown لا يشير إلى إيصاله');
      assert.match(report.markdown, /7\/7_PASSED/);
    }
    // وكل تقرير مربوط بإيصال صادر فعلًا — لا تقرير بلا معرّف إيصال
    assert.equal(new Set(result.reports.map(r => r.findingId)).size, result.reports.length, 'معرّفات مكررة في التقارير');
  } finally {
    if (previousEnv === undefined) delete process.env.NEXA_BUG_REPORT;
    else process.env.NEXA_BUG_REPORT = previousEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D1.8: التوافق — الحقول القديمة باقية بمعناها، والعدّادات إضافة لا استبدال', () => {
  const { hunter, dir } = hunterWith({ refuse: () => false });
  const previousEnv = process.env.NEXA_BUG_REPORT;
  process.env.NEXA_BUG_REPORT = path.join(dir, 'bug-report.json');
  try {
    const summary = hunter._generateReport();
    for (const legacy of ['timestamp', 'targetDir', 'totalFilesScanned', 'totalIssues', 'critical', 'high', 'medium', 'low', 'gateValidation', 'details']) {
      assert.ok(Object.prototype.hasOwnProperty.call(summary, legacy), `حقل قديم حُذف: ${legacy}`);
    }
    assert.equal(summary.gateValidation.total, 3);
    assert.equal(summary.gateValidation.passed, 3);
    // timestamp يبقى بصيغة ISO (سلوك قائم) لكن الأرقام لا تُشتق منه
    assert.match(summary.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(summary.totalIssues, summary.counts.asserted, 'totalIssues تغيّر معناه — كسر توافق');
  } finally {
    if (previousEnv === undefined) delete process.env.NEXA_BUG_REPORT;
    else process.env.NEXA_BUG_REPORT = previousEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D1.8: جولة autopilot تُسقِط تقارير ما لم يُصدَق عليه — العدّاد لا يسبق الإيصال', async () => {
  const dir = tmp('allrefused');
  const previousEnv = process.env.NEXA_BUG_REPORT;
  process.env.NEXA_BUG_REPORT = path.join(dir, 'bug-report.json');
  try {
    const autopilot = new AutopilotEngine({ inScopePatterns: ['*.testdomain.com', 'testdomain.com'] });
    const real = autopilot.evidenceBridge;
    autopilot.evidenceBridge = {
      certifyFinding(finding, target, options) {
        const outcome = real.certifyFinding(finding, target, options);
        if (outcome.verified === true) {
          return { certified: false, verified: false, code: 'NEXA-E-STUB-REFUSED', reasons: ['لا مفتاح توقيع في هذه الجولة'] };
        }
        return outcome;
      }
    };
    const result = await autopilot.runFullLoop('testdomain.com');
    assert.ok(result.counts.validated > 0, 'لم يُصرَّح بشيء أصلًا — لا شيء يُقاس');
    assert.equal(result.counts.certified, 0, 'إيصالات مرفوضة عُدّت صادرة');
    assert.equal(result.reports.length, 0, 'تقارير وُلِّدت لما لم يُصدَّق عليه');
    assert.equal(result.counts.refused, result.counts.validated);
    assert.ok(result.refusedFindings.every(r => r.code === 'NEXA-E-STUB-REFUSED' && r.reasons.length > 0));
    assert.deepEqual(result.validatedFindings, [], 'validatedFindings لا تحمل حالة الإيصال بل تفوح بأنها مُصدَّقة');
  } finally {
    if (previousEnv === undefined) delete process.env.NEXA_BUG_REPORT;
    else process.env.NEXA_BUG_REPORT = previousEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
