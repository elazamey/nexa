import { buildSourceFinding, stripLineComment } from './detector-evidence.js';

/**
 * D1.7 (A05 / DI-15) — التشفير الضعيف: كاشف سطر-نطاق مستقل، بنفس دلالة الشرط السابق.
 *
 * لم تُزوَّد الأنماط عمدًا (parity مع ما كان في المنسِّق): ما يُصلَح هنا هو موضِع الحكم
 * وحمْله لدليله، لا توسيع الكشف. التعليق في نفس السطر يُستثنى، و`// ignore-security`
 * يُحترم على **سطره هو** — لا على مستوى الملف، وإلا عاد العمى الذي تُغلقه التذكرة.
 */

export const DETECTOR_ID = 'weak-crypto';
export const PRODUCER = 'WeakCryptoDetector';

const WEAK_HASH = /\bcreateHash\(\s*['"](?:md5|sha1)['"]\s*\)/i;
const SUPPRESSION = /\/\/\s*ignore-security\b/;

/**
 * @param {{relativePath: string, content: string}} input
 * @returns {object[]}
 */
export function detectWeakCrypto(input) {
  const content = String(input?.content ?? '');
  const relativePath = String(input?.relativePath ?? '');
  const findings = [];

  content.split('\n').forEach((rawLine, index) => {
    const line = stripLineComment(rawLine);
    if (!WEAK_HASH.test(line)) return;
    if (SUPPRESSION.test(rawLine)) return;

    const algorithm = (line.match(/['"]([A-Za-z0-9]+)['"]/i) || [])[1] || 'weak hash';
    findings.push(
      buildSourceFinding({
        producer: PRODUCER,
        detectorId: DETECTOR_ID,
        relativePath,
        line: index + 1,
        type: 'WEAK_CRYPTOGRAPHY',
        severity: 'HIGH',
        cwe: 'CWE-327',
        description: `إناء تجزئة ضعيف (${algorithm}) يُستعمل حيث تُطلَب مقاومة التصادم`,
        impact:
          `Collision and length-extension breaks in ${algorithm} let an attacker forge the digests this code treats as ` +
          'identity or integrity — tokens, signatures and password hashes can be forged or recovered.',
        matched: line.trim(),
        evidence: { algorithm: algorithm.toLowerCase() }
      })
    );
  });
  return findings;
}
