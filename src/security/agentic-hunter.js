import fs from 'node:fs';
import path from 'node:path';

/**
 * Agentic Bug Hunter - NEXA Core Security Inspector
 * يفحص الكود المصدري بحثاً عن الثغرات المنطقية، تسريب الذاكرة، وخرق الثوابت.
 */
export class AgenticBugHunter {
  constructor(targetDir = 'packages') {
    this.targetDir = path.resolve(targetDir);
    this.findings = [];
  }

  // مسح الشجرة البرمجية بالكامل
  async scan() {
    console.log(`🤖 [Agentic Bug Hunter] Starting scan in: ${this.targetDir}`);
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

  async _inspectFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const relativePath = path.relative(process.cwd(), filePath);
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const lineNum = index + 1;

      // 1. فحص التعامل الأسيء مع الوعود (Unhandled Async/Promises)
      if (line.includes('async ') && !content.includes('try {') && !content.includes('.catch(') && !content.includes('Promise.')) {
        this.findings.push({
          severity: 'MEDIUM',
          type: 'UNHANDLED_ASYNC_ERROR',
          file: relativePath,
          line: lineNum,
          description: 'دالة غير متزامنة بدون كتل try/catch أو معالجة للأخطاء (قد تسبب انهيار العملية).'
        });
      }

      // 2. فحص استخدام التشفير الضعيف (Weak Crypto Detection)
      if (/\b(createHash\(['"](?:md5|sha1)['"])\b/i.test(line) && !line.includes('// ignore-security')) {
        this.findings.push({
          severity: 'HIGH',
          type: 'WEAK_CRYPTOGRAPHY',
          file: relativePath,
          line: lineNum,
          description: 'استخدام خوارزمية تشفير ضعيفة أو غير آمنة (MD5/SHA1).'
        });
      }

      // 3. فحص تسريب البيانات أو الـ Hardcoded Secrets
      if (/(api_key|secret|password|private_key)\s*=\s*['"`][A-Za-z0-9_\-\.]{16,}['"`]/i.test(line) && !line.includes('z6Mk') && !line.includes('sample') && !line.includes('mock')) {
        this.findings.push({
          severity: 'CRITICAL',
          type: 'HARDCODED_SECRET',
          file: relativePath,
          line: lineNum,
          description: 'اكتشاف مفتاح سرّي أو كلمة مرور مدمجة في الكود المصدري.'
        });
      }

      // 4. فحص استدعاءات الذاكرة والموارد المفتوحة (Resource Leaks)
      if (line.includes('fs.openSync') || line.includes('createReadStream')) {
        if (!content.includes('.close') && !content.includes('.destroy')) {
          this.findings.push({
            severity: 'LOW',
            type: 'POTENTIAL_RESOURCE_LEAK',
            file: relativePath,
            line: lineNum,
            description: 'فتح مجرى ملفات دون إغلاقه صراحة (احتمالية تسريب موارد).'
          });
        }
      }
    });
  }

  _generateReport() {
    const summary = {
      timestamp: new Date().toISOString(),
      targetDir: this.targetDir,
      totalFilesScanned: this._getFilesRecursive(this.targetDir).length,
      totalIssues: this.findings.length,
      critical: this.findings.filter(f => f.severity === 'CRITICAL').length,
      high: this.findings.filter(f => f.severity === 'HIGH').length,
      medium: this.findings.filter(f => f.severity === 'MEDIUM').length,
      low: this.findings.filter(f => f.severity === 'LOW').length,
      details: this.findings
    };

    // حفظ التقرير في مجلد لوحة التحكم
    const outputDir = path.resolve('dashboard/data');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(outputDir, 'bug-report.json'),
      JSON.stringify(summary, null, 2)
    );

    console.log(`✅ [Agentic Bug Hunter] Scan complete. Found ${summary.totalIssues} issue(s). Report saved to dashboard/data/bug-report.json`);
    return summary;
  }
}

// تشغيل مباشر عند الاستدعاء كـ CLI
if (process.argv[1] && (process.argv[1].endsWith('agentic-hunter.js') || process.argv[1].endsWith('agentic-hunter'))) {
  const target = process.argv[2] || 'packages';
  const hunter = new AgenticBugHunter(target);
  hunter.scan().then(report => {
    if (report.critical > 0) {
      process.exitCode = 1; // إفشال البناء في حالة وجود ثغرات حرجة
    }
  });
}
