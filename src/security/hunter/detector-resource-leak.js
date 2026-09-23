import { buildSourceFinding, findFunctionScopes, scopeForLine, stripLineComment } from './detector-evidence.js';

/**
 * D1.7 (A06 / DI-16) — مورد مفتوح دون إغلاق: الحكم في نطاق المُطلِق وعلى نفس المورد.
 *
 * كان الشرط `!content.includes('.close') && !content.includes('.destroy')` على الملف كله: إغلاقٌ
 * لموردٍ آخر في أي دالة يرحم هذا المورد. الآن يُربَط الحكم **بالمتغير** وبالنطاق الذي أُطلق فيه:
 * `fs.openSync` يُرحَم بـ`fs.closeSync(fd)` أو `fd.close()` في نفس النطاق، ومجرى
 * `createReadStream(s)` بـ`s.close()`/`s.destroy()`. وموردان في سطر واحد = حُلمان لا حكم واحد.
 */

export const DETECTOR_ID = 'resource-leak';
export const PRODUCER = 'ResourceLeakDetector';

const ACQUISITIONS = [
  {
    label: 'fs.openSync',
    assigned: /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*fs\.openSync\(/g,
    bare: /fs\.openSync\(/,
    releases: name =>
      name
        ? [new RegExp(`fs\\.closeSync\\(\\s*${name}\\b`), new RegExp(`\\b${name}\\.close\\s*\\(`), new RegExp(`\\b${name}\\.destroy\\s*\\(`)]
        : [/fs\.closeSync\(/, /\.close\s*\(/, /\.destroy\s*\(/]
  },
  {
    label: 'createReadStream',
    assigned: /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:fs\.)?createReadStream\(/g,
    bare: /createReadStream\(/,
    releases: name =>
      name
        ? [new RegExp(`\\b${name}\\.close\\s*\\(`), new RegExp(`\\b${name}\\.destroy\\s*\\(`)]
        : [/\.close\s*\(/, /\.destroy\s*\(/]
  }
];

/**
 * @param {{relativePath: string, content: string}} input
 * @returns {object[]}
 */
export function detectResourceLeak(input) {
  const content = String(input?.content ?? '');
  const relativePath = String(input?.relativePath ?? '');
  const lines = content.split('\n');
  const scopes = findFunctionScopes(content);
  const findings = [];
  const seen = new Set();

  lines.forEach((rawLine, index) => {
    const line = stripLineComment(rawLine);
    const lineNumber = index + 1;

    for (const acquisition of ACQUISITIONS) {
      const assignedNames = [...line.matchAll(acquisition.assigned)].map(match => match[1]);
      const bareCall = assignedNames.length === 0 && acquisition.bare.test(line);
      const targets = assignedNames.length > 0 ? assignedNames : bareCall ? [null] : [];

      for (const name of targets) {
        const identity = `${lineNumber}:${name ?? acquisition.label}`;
        if (seen.has(identity)) continue;
        seen.add(identity);

        const scope = scopeForLine(scopes, lineNumber, lines.length, content);
        const released = acquisition.releases(name).some(pattern => pattern.test(scope.body));
        if (released) continue;

        findings.push(
          buildSourceFinding({
            producer: PRODUCER,
            detectorId: DETECTOR_ID,
            relativePath,
            line: lineNumber,
            type: 'POTENTIAL_RESOURCE_LEAK',
            severity: 'LOW',
            cwe: 'CWE-775',
            description: `مورد مفتوح${name ? ` (${name})` : ''} عبر ${acquisition.label} في نطاق '${scope.name}' بلا إغلاق أو إتلاف لهذا المورد نفسه`,
            impact:
              'Descriptors and stream handles stay referenced until the process reaches resource exhaustion (EMFILE) and ' +
              'can no longer open files, so legitimate requests fail with a denial of service.',
            matched: line.trim(),
            scope: { function: scope.name, startLine: scope.startLine, endLine: scope.endLine },
            evidence: {
              source: acquisition.label,
              trackedVariable: name,
              releaseChecked: name ? `closeSync(${name})/${name}.close()/${name}.destroy()` : `${scope.name}-scope`
            }
          })
        );
      }
    }
  });

  return findings;
}
