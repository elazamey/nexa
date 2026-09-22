import crypto from 'node:crypto';
import { ArtifactReader } from './artifact-reader.js';
import { SevenGateValidator } from './seven-gate-validator.js';

/**
 * NexaEvidenceBridge - Cryptographic Finding Certification
 * Signs bug hunter reports with Ed25519 and generates verifiable evidence receipts.
 *
 * وفق عقد قارئ الـ artifact v0.3-rebuild:
 *   §6.1  certifyFinding fail-closed: لا توقيع إلا بعد تحقق artifact عبر القارئ
 *         + إعادة تقييم مستقلة للبوابات السبع داخل الجسر (لا ثقة بgateCheck مرفق).
 *   §6.2  صدق الحقول: gateScore/verified من التحقق الفعلي فقط + artifactDigest.
 *   §6.3  الحتمية (canonicalJSON بمفاتيح مرتبة، بلا حقول لحظية محقونة)
 *         والربط (verifyReceipt يعيد حساب digest عند تقديم الحمولة).
 *   §10.9 أي استثناء/غياب → رفض معلَّل بلا توقيع. لا default-pass.
 *   §10.10 قاعدة 7/7: لا إيصال إلا بسبع بوابات محسوبة كلها pass.
 */
export class NexaEvidenceBridge {
  constructor(keyPair = null, options = {}) {
    if (keyPair) {
      this.keyPair = keyPair;
    } else {
      this.keyPair = crypto.generateKeyPairSync('ed25519');
    }
    // §6.1: الجسر يملك قارئه ومُقيّمه الخاصين — إعادة التقييم مستقلة عن المتصل
    this.artifactReader = options.artifactReader || new ArtifactReader();
    this.validator = options.validator || new SevenGateValidator({ artifactReader: this.artifactReader });
  }

  getPublicKeyHex() {
    return this.keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  }

  /**
   * §6.3: canonicalJSON — مفاتيح مرتبة تعمقيًا؛ نفس المحتوى ⇒ نفس السلسلة.
   */
  _canonicalize(value) {
    if (value === null || typeof value !== 'object') {
      return value === undefined ? null : value;
    }
    if (Array.isArray(value)) {
      return value.map(item => this._canonicalize(item));
    }
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = this._canonicalize(value[key]);
    }
    return sorted;
  }

  /**
   * §6.3(1): الحمولة القانونية — تُنقّى من الحقول المرفقة/اللحظية:
   * receipt وgateCheck يُحذفان، ولا يُحقن timestamp عند غيابه.
   */
  _legalPayload(finding, target) {
    const { receipt: _receipt, gateCheck: _gateCheck, ...payload } = finding;
    return {
      title: finding.title || finding.name || finding.type || finding.event,
      severity: finding.severity || 'INFO',
      target,
      payload
    };
  }

  _digest(finding, target) {
    const canonical = JSON.stringify(this._canonicalize(this._legalPayload(finding, target)));
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * يولّد إيصالًا موقّعًا لـ finding معتمد فقط — أو رفضًا صريحًا معلَّلًا (ليس إيصالًا).
   */
  certifyFinding(finding, target = 'local', options = {}) {
    let evaluation = null;
    // §10.9: أي استثناء في المسار كله → رفض معلَّل، لا انتشار ولا توقيع احتياطي
    try {
      if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
        return {
          certified: false,
          code: 'NEXA-E-REJECTED',
          reasons: ['AR-E01: finding غائب أو ليس كائنًا مفردًا'],
          gateScore: null,
          verified: false
        };
      }

      const reader = options.artifactReader || this.artifactReader;
      const reasons = [];

      // §6.1(2): إعادة تحقق الـ artifact عبر قارئ الجسر — لا تُقبل صلاحية مرفقة
      const artifactValidation = reader.validate(finding.artifact);
      if (!artifactValidation.valid) {
        for (const r of artifactValidation.reasons) {
          reasons.push(`${r.code}: ${r.message}`);
        }
      }

      // §6.1(3): إعادة تقييم مستقلة للبوابات — gateCheck المرفق يُتجاهل كليًا
      const validator = options.validator || this.validator;
      const gateContext = options.gateContext ?? { inScope: true };
      evaluation = validator.evaluateFinding(finding, gateContext);

      // §10.10: قاعدة 7/7 — سبع بوابات محسوبة كلها pass
      const checksOk =
        Array.isArray(evaluation.checks) &&
        evaluation.checks.length === 7 &&
        evaluation.checks.every(c => c.pass === true);
      if (!evaluation.isValid || evaluation.score !== '7/7' || !checksOk) {
        reasons.push(
          `NEXA-E-GATE: إعادة التقييم المستقلة لم تحقق 7/7 محسوبة (النتيجة الفعلية: ${evaluation.score})`
        );
      }

      if (reasons.length > 0) {
        return {
          certified: false,
          code: 'NEXA-E-REJECTED',
          reasons,
          gateScore: evaluation ? evaluation.score : null,
          verified: false
        };
      }

      // §6.3: digest حتمي على الحمولة القانونية
      const findingDigest = this._digest(finding, target);
      // §6.2: ربط الإيصال بدليله
      const artifactDigest = crypto
        .createHash('sha256')
        .update(JSON.stringify(this._canonicalize(artifactValidation.artifact)))
        .digest('hex');

      const signature = crypto
        .sign(null, Buffer.from(findingDigest, 'utf8'), this.keyPair.privateKey)
        .toString('hex');

      return {
        // §6.3(3): معرف مشتق من digest — لا Date.now()
        findingId: `NEXA-EVID-${findingDigest.slice(0, 16)}`,
        target,
        findingDigest,
        artifactDigest,
        certifierPublicKey: this.getPublicKeyHex(),
        signature,
        certifiedAt: new Date().toISOString(),
        // §10.10: القيمة مشروطة بما جرى فوق — لا نص حرفي
        gateScore: '7/7_PASSED',
        verified: true
      };
    } catch (err) {
      return {
        certified: false,
        code: 'NEXA-E-REJECTED',
        reasons: [`NEXA-E-EXCEPTION: ${err && err.message}`],
        gateScore: evaluation ? evaluation.score : null,
        verified: false
      };
    }
  }

  /**
   * Alias for signing findings — يخضع لنفس صرامة certifyFinding (§9.4):
   * لا ختم بوابات على payloads عامة.
   */
  signFinding(payload) {
    return this.certifyFinding(payload, payload?.tag || payload?.target || 'release');
  }

  /**
   * يتحقق من إيصال مقابل المفتاح العام.
   * §6.3(4): عند تقديم الـ finding تُعاد حساب الحمولة القانونية ويجب أن تطابق
   * receipt.findingDigest قبل فحص التوقيع — إيصال «صالح» مع حمولة مستبدلة يُرفض.
   */
  verifyReceipt(receipt, finding = null) {
    if (!receipt || typeof receipt !== 'object') {
      return false;
    }
    if (finding !== null && finding !== undefined) {
      try {
        const recomputed = this._digest(finding, receipt.target);
        if (recomputed !== receipt.findingDigest) {
          return false;
        }
      } catch {
        return false; // §10.9: فشل إعادة الحساب = رفض
      }
    }

    const pubKey = crypto.createPublicKey({
      key: Buffer.from(receipt.certifierPublicKey, 'hex'),
      type: 'spki',
      format: 'der'
    });

    return crypto.verify(
      null,
      Buffer.from(receipt.findingDigest, 'utf8'),
      pubKey,
      Buffer.from(receipt.signature, 'hex')
    );
  }
}
