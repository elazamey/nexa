import { buildSourceFinding, findFunctionScopes } from './detector-evidence.js';

/**
 * D1.7 (A06 / DI-16) — await غير معالَج، مُقاس في **نطاق الدالة** لا في الملف كله.
 *
 * الشرط القديم كان `async && !content.includes('try {') && !content.includes('.catch(')` على
 * محتوى الملف كاملًا: `try` في دالة لا علاقة لها يُسكِت كشفًا حقيقيًا (false negative مضمون
 * البنية)، وكل سطر `async` يُعيد دفع نفس الحكم (تكرار). الآن: لكل دالة غير متزامنة حكم واحد على
 * أول `await` خاص بها، وجسمها **مُقنَّع** بنطاقات الدوال الداخلية — فالدالة الداخلية مسؤولة عن
 * أخطائها، والدالة الخارجية لا تُحاسَب عليها ولا تُرحَم بها.
 */

const HANDLED = [/\btry\s*\{/, /\.catch\s*\(/, /\bPromise\.allSettled\s*\(/, /\bcatch\s*\(/, /\bfinally\s*\{/];

export const DETECTOR_ID = 'unhandled-async';
export const PRODUCER = 'UnhandledAsyncDetector';

/**
 * @param {{relativePath: string, content: string}} input
 * @returns {object[]}
 */
export function detectUnhandledAsync(input) {
  const content = String(input?.content ?? '');
  const relativePath = String(input?.relativePath ?? '');
  const lines = content.split('\n');
  const scopes = findFunctionScopes(content);
  const findings = [];

  for (const scope of scopes) {
    const header = lines[scope.headerLine - 1] || '';
    if (!/\basync\b/.test(header)) continue; // الحكم على الدالة غير المتزامنة نفسها

    // سطور النطاقات الداخلية المُعلَّنة ليست من مسؤولية هذه الدالة
    const inner = scopes.filter(
      other => other !== scope && other.startLine > scope.startLine && other.endLine <= scope.endLine
    );
    const bodyLines = lines.slice(scope.startLine - 1, scope.endLine).map((text, offset) => {
      const absolute = scope.startLine + offset;
      return inner.some(other => other.startLine <= absolute && absolute <= other.endLine) ? '' : text;
    });

    const ownBody = bodyLines.join('\n');
    if (!/\bawait\b/.test(ownBody)) continue;
    if (HANDLED.some(pattern => pattern.test(ownBody))) continue;

    const awaitIndex = bodyLines.findIndex(text => /\bawait\b/.test(text));
    if (awaitIndex === -1) continue;
    const awaitLine = scope.startLine + awaitIndex;

    findings.push(
      buildSourceFinding({
        producer: PRODUCER,
        detectorId: DETECTOR_ID,
        relativePath,
        line: awaitLine,
        type: 'UNHANDLED_ASYNC_ERROR',
        severity: 'MEDIUM',
        cwe: 'CWE-703',
        description: `await داخل '${scope.name}' بلا try/catch أو .catch أو Promise.allSettled في نطاق الدالة نفسها`,
        impact:
          `An unhandled rejection from '${scope.name}' terminates the Node process (unhandledRejection default), ` +
          'dropping in-flight work — a denial of service reachable from any input path that throws.',
        matched: bodyLines[awaitIndex].trim(),
        scope: { function: scope.name, startLine: scope.startLine, endLine: scope.endLine },
        evidence: { checkedLines: bodyLines.length, handlerPatterns: HANDLED.length }
      })
    );
  }

  return findings;
}
