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
    // D1.5 (DI-13): جولة المصدر المحلي تُرخَّص بجذرها الصريح — الأصل الذي يُطابق هو file
    // كل finding، فلا يستعير finding عن /etc/passwd ترشيح هذه الشجرة.
    const gateContext = { scope: { target: this.targetDir, allow: [this.targetDir], deny: [] } };

    // Validate findings with the 7-Gate Validator
    const triage = this.validator.filterValidFindings(this.findings, gateContext);

    // Cryptographically certify validated findings
    const certifiedFindings = triage.validated.map(f => ({
      ...f,
      receipt: this.evidenceBridge.certifyFinding(f, this.targetDir, { gateContext })
    }));

    const summary = {
      timestamp: new Date().toISOString(),
      targetDir: this.targetDir,
      totalFilesScanned: this._getFilesRecursive(this.targetDir).length,
      totalIssues: this.findings.length,
      critical: this.findings.filter(f => f.severity === 'CRITICAL').length,
      high: this.findings.filter(f => f.severity === 'HIGH').length,
      medium: this.findings.filter(f => f.severity === 'MEDIUM').length,
      low: this.findings.filter(f => f.severity === 'LOW').length,
      gateValidation: triage.stats,
      details: certifiedFindings
    };

    // حفظ التقرير في مجلد لوحة التحكم
    // D1.9: NEXA_BUG_REPORT يعزل مخرجات الاختبار؛ الافتراضي الإنتاجي unchanged.
    const reportPath = process.env.NEXA_BUG_REPORT || path.join(path.resolve('dashboard/data'), 'bug-report.json');
    const outputDir = path.dirname(reportPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(
      reportPath,
      JSON.stringify(summary, null, 2)
    );

    console.log(`✅ [Agentic Bug Hunter] Scan complete. Found ${summary.totalIssues} issue(s). Validated: ${triage.stats.passed}. Saved to dashboard/data/bug-report.json`);
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
