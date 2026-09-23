/**
 * D1.7 (A05/A06 / DI-01) — قالب واحد لـ finding مصدر: الدليل والشهادة يُبنى في موضع واحد.
 *
 * الهدف المزدوج: (1) كل كاشف يُرجع finding **قابلًا للتقييم** — `artifact` يقبله القارئ
 * المستقل (GATE_2) و`safeTesting` مربوطة بنفس المُنتِج (GATE_7)؛ (2) لا ينزلق كاشف إلى ادّعاء
 * الحكم على نفسه — لا `verdict` ولا `passed` ولا `confidence` في الدليل، والحكم للمُقيِّم وحده.
 *
 * النقاء مقصود: الدوال هنا لا تقرأ نظام الملفات ولا الزمن ولا حالة المنسِّق؛ مدخلاتها معلنة
 * وتُعيد قيمًا جديدة (DI-01)، فتُختبر كل وحدة منفردة بلا ترتيب ولا عشوائية.
 */

export const SOURCE_TESTING_RECORD = Object.freeze({
  nonDestructive: true,
  noServiceDisruption: true,
  method: 'static-source-analysis'
});

/** يبني سجل الاختبار الآمن مربوطًا بمُنتِج الدليل نفسه (عقد D1.3). */
export function attestSourceAnalysis(producer) {
  return { ...SOURCE_TESTING_RECORD, attestedBy: producer };
}

/**
 * @param {{producer: string, detectorId: string, relativePath: string, line: number,
 *          type: string, severity: string, cwe: string, description: string, impact: string,
 *          scope?: object, matched?: string, evidence?: object}} input
 * @returns {object} finding بلا artifact مُختلَق ولا حكم مضمّن
 */
export function buildSourceFinding(input) {
  const {
    producer,
    detectorId,
    relativePath,
    line,
    type,
    severity,
    cwe,
    description,
    impact,
    scope,
    matched,
    evidence = {}
  } = input;

  const locator = `file:${relativePath}#L${line}`;
  const finding = {
    title: `${type} at ${relativePath}:${line}`,
    type,
    vulnClass: type,
    severity,
    cwe,
    file: relativePath,
    line,
    description,
    impact,
    artifact: {
      kind: 'content-match',
      locator,
      evidence: {
        detector: detectorId,
        ...(matched === undefined ? {} : { matched: String(matched).slice(0, 160) }),
        ...(scope === undefined ? {} : { scope }),
        ...evidence
      },
      producedBy: producer
    },
    safeTesting: attestSourceAnalysis(producer)
  };
  return finding;
}

// مُعرِّفات نطاق الدالة: async وعادية، تصريحًا أو إسنادًا أو دالة سهمية أو method.
// لا تُبنى AST ولا تُستورد مكتبة — مطابقة أقواس حرفية تكفي لنطاق الحكم وتبقى حتمية.
const HEADER_PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)?\s*\(/,
  /^\s*(?:export\s+)?(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:function\s*\*?\s*[A-Za-z0-9_$]*\s*)?\(/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(\s*[^)]*\)\s*=>/
];

/**
 * نطاقات الدوال في محتوى نصّي — مطابقة أقواس حرفية، لا AST (لا تابعة ولا مُنشأة).
 * @returns {Array<{name: string, headerLine: number, startLine: number, endLine: number, body: string}>}
 */
export function findFunctionScopes(content) {
  const lines = String(content).split('\n');
  const scopes = [];
  for (let i = 0; i < lines.length; i++) {
    let name = null;
    for (const pattern of HEADER_PATTERNS) {
      const m = lines[i].match(pattern);
      if (m) {
        name = m[1] || 'anonymous';
        break;
      }
    }
    if (name === null) continue;
    let depth = 0;
    let opened = false;
    let end = i;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') {
          depth += 1;
          opened = true;
        } else if (ch === '}') {
          depth -= 1;
        }
      }
      if (opened && depth <= 0) {
        end = j;
        break;
      }
      if (!opened && j === lines.length - 1) end = j;
    }
    scopes.push({
      name,
      headerLine: i + 1,
      startLine: i + 1,
      endLine: end + 1,
      body: lines.slice(i, end + 1).join('\n')
    });
  }
  return scopes;
}

/** النطاق الحاوي لسطر معيّن، أو نطاق الوحدة كله (شفيف للـ top-level). */
export function scopeForLine(scopes, line, totalLines, wholeContent = '') {
  const enclosing = scopes.filter(s => s.headerLine <= line && s.endLine >= line);
  if (enclosing.length === 0) {
    return { name: 'module', headerLine: 1, startLine: 1, endLine: totalLines, body: wholeContent };
  }
  // الأضيق = الأدق (دالة داخل دالة)
  return enclosing.reduce((best, s) => (s.endLine - s.headerLine < best.endLine - best.headerLine ? s : best));
}

/** يزيل التعليق من سطر حتى لا يُحسب نصٌ في تعليق كاشفًا. */
export function stripLineComment(line) {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}
