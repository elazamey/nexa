/**
 * ArtifactReader — قارئ ومتحقق مستقل من أدلة إعادة الإنتاج (artifacts)
 * وفق عقد قارئ الـ artifact v0.3-rebuild:
 *   §3 نموذج الـ artifact · §4 واجهة القارئ · §7 الاستقلالية · §8 تصنيف الأخطاء · §10.9 fail-closed
 *
 * استقلالية هيكلية (§7): لا يستورد هذا الملف شيئًا — لا كواشف ولا validator ولا bridge،
 * ولا يُستورد من الكواشف. التكامل بالاستدعاء فقط.
 * القارئ عديم الحالة: نتيجة validate دالة في مدخلها فقط.
 */

const ARTIFACT_KINDS = [
  'pattern-trace',
  'request',
  'response',
  'ast-trace',
  'content-match',
  'steps'
];

/** حقول الحكم الذاتي الممنوعة داخل الـ artifact (§3.3 / AR-E06) */
const SELF_VERDICT_FIELDS = [
  'verdict',
  'selfValidated',
  'passed',
  'valid',
  'isValid',
  'approved'
];

function reject(code, message) {
  return { valid: false, reasons: [{ code, message }], artifact: null };
}

export class ArtifactReader {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * يتحقق من بنية الـ artifact وفق §3.
   * §10.9 fail-closed: أي غياب/خلل/استثناء → رفض معلَّل، لا رمي ولا default-pass.
   */
  validate(artifact) {
    try {
      // AR-E01: غائب أو ليس كائنًا مفردًا
      if (artifact === null || artifact === undefined) {
        return reject('AR-E01', 'artifact غائب');
      }
      if (typeof artifact !== 'object' || Array.isArray(artifact)) {
        return reject('AR-E01', 'artifact ليس كائنًا مفردًا');
      }

      // AR-E06: حكم ذاتي — الصلاحية تُستنبط من البنية، لا يُصدَّق الكاشف على نفسه
      for (const field of SELF_VERDICT_FIELDS) {
        if (field in artifact) {
          return reject('AR-E06', `حقل حكم ذاتي مرفوض داخل artifact: '${field}' (§3.3)`);
        }
      }

      // AR-E02: kind
      if (typeof artifact.kind !== 'string' || !ARTIFACT_KINDS.includes(artifact.kind)) {
        return reject(
          'AR-E02',
          `kind غير صالح: ${JSON.stringify(artifact.kind)} (المسموح: ${ARTIFACT_KINDS.join(', ')})`
        );
      }

      // AR-E03: locator
      if (typeof artifact.locator !== 'string' || artifact.locator.trim() === '') {
        return reject('AR-E03', 'locator غائب أو فارغ');
      }

      // AR-E04: evidence — الدليل الملموس نفسه (لا وصف له)
      const evidence = artifact.evidence;
      const evidenceIsText = typeof evidence === 'string' && evidence.trim() !== '';
      const evidenceIsObject =
        evidence !== null &&
        typeof evidence === 'object' &&
        !Array.isArray(evidence) &&
        Object.keys(evidence).length > 0;
      if (!evidenceIsText && !evidenceIsObject) {
        return reject('AR-E04', 'evidence غائب أو فارغ (نص فراغي أو كائن بلا بيانات)');
      }

      // AR-E05: producedBy — provenance الكاشف المنتج
      if (typeof artifact.producedBy !== 'string' || artifact.producedBy.trim() === '') {
        return reject('AR-E05', 'producedBy غائب أو ليس نصًا غير فارغ');
      }

      // نسخة منقّحة بالحقول المعتمدة فقط — الإيصال يُربط بها (§6.2 artifactDigest)
      return {
        valid: true,
        reasons: [],
        artifact: {
          kind: artifact.kind,
          locator: artifact.locator,
          evidence: artifact.evidence,
          producedBy: artifact.producedBy
        }
      };
    } catch (err) {
      // AR-E00: استثناء غير متوقع → رفض معلَّل، لا انتشار (§10.9)
      return reject('AR-E00', `استثناء أثناء قراءة/تحقق الـ artifact: ${err && err.message}`);
    }
  }
}
