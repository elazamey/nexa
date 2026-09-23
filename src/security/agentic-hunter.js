import fs from 'node:fs';
import path from 'node:path';
import {
  ReconAgent,
  VulnEngine,
  SevenGateValidator,
  ArtifactReader,
  ChainBuilder,
  SecretsHunter,
  JwtScanner,
  LlmRedTeam,
  Web3Auditor,
  ReportWriter,
  NexaEvidenceBridge,
  HuntMemory,
  AutopilotEngine,
  SOURCE_DETECTORS
} from './hunter/index.js';

/**
 * AgenticBugHunter - NEXA Core Security Inspector & Autonomous Hunting Engine
 * Integrates static code analysis, dynamic surface mapping, 7-Question Gate validation,
 * exploit chaining, and Ed25519 cryptographic certification.
 */
export class AgenticBugHunter {
  constructor(targetDir = 'packages') {
    this.targetDir = path.resolve(targetDir);
    this.findings = [];
    this.secretsHunter = new SecretsHunter();
    this.validator = new SevenGateValidator();
    this.memory = new HuntMemory();
    this.evidenceBridge = new NexaEvidenceBridge();
  }

  // مسح الشجرة البرمجية بالكامل
  async scan() {
    console.log(`🤖 [Agentic Bug Hunter] Starting security inspection in: ${this.targetDir}`);
    const files = this._getFilesRecursive(this.targetDir);
    
    for (const file of files) {
      if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.ts')) {
        await this._inspectFile(file);
      }
    }

    return this._generateReport();
  }

  _getFilesRecursive(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        if (file !== 'node_modules' && file !== '.git') {
          results = results.concat(this._getFilesRecursive(filePath));
        }
      } else {
        results.push(filePath);
      }
    }
    return results;
  }

  // D1.7 (A05/A06 / DI-01، DI-15، DI-16): لا كاشف هنا — المنسِّق يقرأ الملف ويسلّمه للوحدات
  // المسجلة، ويجمع ما تُرجعه. شرط الكشف ونطاقه ودليله كلُّها داخل الوحدة المختصة.
  _inspectFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    // الأصل مُعرَّف نسبةً إلى جذر الجولة المُرَخَّص — لا إلى cwd العملية: مسار يبدأ بـ ../
    // يخرج من الجذر عند GATE_1 (D1.5) ويجعل الأصل غير قابل للإغلاق على نطاق الجولة.
    const relativePath = path.relative(this.targetDir, filePath);

    for (const finding of this.secretsHunter.scanContent(content, relativePath)) {
      this.findings.push(finding);
    }

    for (const detector of SOURCE_DETECTORS) {
      for (const finding of detector.detect({ relativePath, content })) {
        this.findings.push(finding);
      }
    }
  }

  _generateReport() {
    // D1.5 (DI-13): جولة المصدر المحلي تُرخَّص بجذرها الصريح — الأصل الذي يُطابق
    // كل finding، فلا يستعير finding عن /etc/passwd ترشيح هذه الشجرة.
    const gateContext = { scope: { target: this.targetDir, allow: [this.targetDir], deny: [] } };

    const triage = this.validator.filterValidFindings(this.findings, gateContext);

    // D1.8 (A13 / DI-17): التفصيل يُصدَر مع الإيصال لا مع التصريح. المُصرَّح به عند
    // المُقيِّم قد لا يحصل على إيصال (قارئ الجسر مستقل)؛ فيُدرج في refused بسببه، ولا
    // يظهر في details — وإلا كان التقرير يقول «مُصدَّق» ما لم يُصدَّق.
    const attempted = triage.validated.map(f => ({
      ...f,
      receipt: this.evidenceBridge.certifyFinding(f, this.targetDir, { gateContext })
    }));
    // الإيصال الصادر هو ما حقّقه الجسر (verified + signature)؛ الرفض يحمل certified:false
    const isIssued = (f) => Boolean(f.receipt) && f.receipt.verified === true && typeof f.receipt.signature === 'string' && f.receipt.certified !== false;
    const issued = attempted.filter(isIssued);
    const refused = attempted
      .filter(f => !isIssued(f))
      .map(f => ({
        title: f.title,
        type: f.type,
        vulnClass: f.vulnClass,
        severity: f.severity,
        file: f.file,
        line: f.line,
        code: f.receipt?.code ?? 'NEXA-E-NO-RECEIPT',
        gateScore: f.receipt?.gateScore ?? null,
        reasons: Array.isArray(f.receipt?.reasons) && f.receipt.reasons.length > 0
          ? f.receipt.reasons
          : ['the evidence bridge returned no reasons for this refusal']
      }));

    const severityOf = (list) => ({
      critical: list.filter(f => f.severity === 'CRITICAL').length,
      high: list.filter(f => f.severity === 'HIGH').length,
      medium: list.filter(f => f.severity === 'MEDIUM').length,
      low: list.filter(f => f.severity === 'LOW').length
    });
    const assertedSeverity = severityOf(this.findings);
    const certifiedSeverity = severityOf(issued);

    const summary = {
      timestamp: new Date().toISOString(),
      targetDir: this.targetDir,
      totalFilesScanned: this._getFilesRecursive(this.targetDir).length,
      // totalIssues يبقى بالمعنى القديم (كل ما أُبلِغ) — أساسُه مُعلَن ولا يُقرأ حكمًا
      totalIssues: this.findings.length,
      ...assertedSeverity,
      severityBasis: 'asserted',
      certifiedSeverity,
      certifiedSeverityBasis: 'certified',
      gateValidation: triage.stats,
      counts: {
        asserted: this.findings.length,
        validated: triage.stats.passed,
        certified: issued.length,
        refused: refused.length
      },
      certified: issued.length,
      details: issued.map(f => ({
        ...f,
        findingId: f.receipt.findingId,
        artifactDigest: f.receipt.artifactDigest
      })),
      refused
    };

    // D1.9: NEXA_BUG_REPORT يعزل مخرجات الاختبار؛ الافتراضي الإنتاجي unchanged.
    const reportPath = process.env.NEXA_BUG_REPORT || path.join(path.resolve('dashboard/data'), 'bug-report.json');
    let persistence;
    try {
      const outputDir = path.dirname(reportPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const tempPath = `${reportPath}.${process.pid}.tmp`;
      const body = `${JSON.stringify(summary, null, 2)}\n`;
      fs.writeFileSync(tempPath, body, 'utf8');
      fs.renameSync(tempPath, reportPath);
      // حالة الكتابة تُضاف بعد الكتابة: لا سجل حفظ يسبق الحفظ نفسه
      persistence = { ok: true, path: path.resolve(reportPath), bytes: Buffer.byteLength(body) };
      summary.persistence = persistence;
    } catch (err) {
      persistence = {
        ok: false,
        code: 'NEXA-REPORT-WRITE-FAILED',
        path: path.resolve(reportPath),
        reason: `cannot write the report: ${err.message}`
      };
      summary.persistence = persistence;
    }

    console.log(
      `✅ [Agentic Bug Hunter] Scan complete. Asserted ${summary.counts.asserted} · validated ` +
        `${summary.counts.validated} · certified ${summary.counts.certified} · refused ${summary.counts.refused} · ` +
        (persistence.ok
          ? `saved to ${persistence.path} (${persistence.bytes}B)`
          : `NOT SAVED (${persistence.code}): ${persistence.reason}`)
    );
    return summary;
  }
}

// تشغيل مباشر عند الاستدعاء كـ CLI
if (process.argv[1] && (process.argv[1].endsWith('agentic-hunter.js') || process.argv[1].endsWith('agentic-hunter'))) {
  const target = process.argv[2] || 'packages';
  const hunter = new AgenticBugHunter(target);
  hunter.scan().then(report => {
    if (report.critical > 0) {
      process.exitCode = 1;
    }
  });
}

export {
  ReconAgent,
  VulnEngine,
  SevenGateValidator,
  ArtifactReader,
  ChainBuilder,
  SecretsHunter,
  JwtScanner,
  LlmRedTeam,
  Web3Auditor,
  ReportWriter,
  NexaEvidenceBridge,
  HuntMemory,
  AutopilotEngine
};
