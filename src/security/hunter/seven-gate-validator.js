import { ArtifactReader } from './artifact-reader.js';
import { evaluateSafeTestingRecord } from './safe-testing.js';
import { evaluateImpactDemonstration } from './impact-evidence.js';
import { evaluateBoundaryEvidence } from './boundary-evidence.js';
import { evaluateScopeAuthorization } from './scope-evidence.js';

/**
 * SevenGateValidator - 7-Question Strict Finding Gate & 4-Gate Triage
 * Filters out theoretical findings, false positives, and out-of-scope reports before submission.
 *
 * GATE_2_REPRODUCIBILITY تُقيَّم عبر ArtifactReader المستقل فقط (عقد قارئ الـ artifact
 * v0.3 §5.1): locator نصي وحده لا يكفي — يلزم artifact صالح البنية.
 * GATE_7_SAFE_TESTING_COMPLIANCE (D1.3 / DI-07) كانت `pass: true` حرفيًا؛ صارت تُحسب من
 * سجل سلوك الاختبار مربوطًا بمنتج الدليل نفسه (`safe-testing.js`) — غياب السجل رفضٌ مُعلَّل.
 * لا بوابة هنا بقيمة pass حرفية؛ وأي رفض يحمل سبب في failedGates.
 */
export class SevenGateValidator {
  constructor(options = {}) {
    // §5.1(3): القارئ يُحقن — لا يُقبل ناتج قراءة مُمرَّر من الكاشف
    this.artifactReader = options.artifactReader || new ArtifactReader();
    this.neverSubmitClasses = [
      'MISSING_CSP_HEADER',
      'MISSING_X_FRAME_OPTIONS',
      'SELF_XSS',
      'EMAIL_SPOOFING_SPF_DKIM_MISSING',
      'SOFTWARE_BANNER_DISCLOSURE',
      'SSL_TLS_CIPHER_SUITE_WEAKNESS',
      'LOGIN_RATE_LIMITING_THEORETICAL'
    ];
  }

  /**
   * Evaluates a candidate finding through the 7-Question Gate
   */
  evaluateFinding(finding, context = {}) {
    // الدليل يُقرأ مرة واحدة: صلاحيته تُغذّي GATE_2، ومنتِجه يربط شهادة GATE_7 به (D1.3)
    const artifactOutcome = this.artifactReader.validate(finding.artifact);
    const safeTesting = evaluateSafeTestingRecord(
      finding.safeTesting !== undefined ? finding.safeTesting : context.safeTesting,
      artifactOutcome.artifact
    );
    // D1.4 (DI-06): مسندان مستقلان — الأثر من مضمون الادعاء، والحدود من سجلّ {from,to,kind}
    // مقيَّد بجدول الأصناف. لا شدة في أيٍّ منهما: رفع severity كان يفتح البوابتين معًا.
    // D1.5 (DI-13): النطاق يُطابق هنا من سجل بيانات — ادعاء `inScope:true` لا يُجيب البوابة
    const scope = evaluateScopeAuthorization(finding, context);
    const impact = evaluateImpactDemonstration(finding);
    const boundary = evaluateBoundaryEvidence(finding);
    const checks = [
      {
        id: 'GATE_1_SCOPE',
        question: 'Is the asset strictly within authorized program scope?',
        // D1.5: المطابقة معادة الحساب (target ∈ allow ∖ deny) وأصل الـ finding مطابق للهدف
        pass: scope.pass,
        reason: scope.reason
      },
      {
        id: 'GATE_2_REPRODUCIBILITY',
        question: 'Is the vulnerability directly reproducible with deterministic steps?',
        // §5.1: المرور الحصري عبر artifact يجتاز القارئ المستقل — لا مجرد locator نصي
        pass: artifactOutcome.valid
      },
      {
        id: 'GATE_3_DEMONSTRABLE_IMPACT',
        question: 'Does the finding demonstrate concrete security or financial impact?',
        // D1.4: مضمون الادعاء لا ترتيبه — متجه ضرر مسمّى، بلا صياغة احتمال
        pass: impact.pass,
        reason: impact.reason
      },
      {
        id: 'GATE_4_POC_EVIDENCE',
        question: 'Is tangible proof-of-concept evidence provided (payload, request/response, AST trace)?',
        pass: !!(finding.description && (finding.cwe || finding.type || finding.impact))
      },
      {
        id: 'GATE_5_NO_FALSE_POSITIVE',
        question: 'Is this finding free from known non-impact / informative-only classes?',
        pass: !this.neverSubmitClasses.includes(finding.vulnClass || finding.type)
      },
      {
        id: 'GATE_6_BOUNDARY_BYPASS',
        question: 'Does this exploit cross an actual tenant, authorization, or process boundary?',
        // D1.4: سجلّ حدود مقيَّد بالصنف، لا مرآة لـ GATE_3
        pass: boundary.pass,
        reason: boundary.reason
      },
      {
        id: 'GATE_7_SAFE_TESTING_COMPLIANCE',
        question: 'Was the verification conducted non-destructively without service disruption?',
        // D1.3 (DI-07): محسوبة من سجلّ سلوك الاختبار، لا من حرف true مهدى
        pass: safeTesting.pass,
        reason: safeTesting.reason
      }
    ];

    const passedChecks = checks.filter(c => c.pass);
    const isValid = passedChecks.length === 7;

    return {
      findingTitle: finding.title || finding.type || 'Unnamed Finding',
      isValid,
      score: `${passedChecks.length}/7`,
      status: isValid ? 'APPROVED_FOR_REPORT' : 'REJECTED_AT_GATE',
      // المساند السبعة كما حُسبت فعليًا — يستخدمها جسر الشهادة في قاعدة 7/7 (§10.10)
      checks: checks.map(c => ({ id: c.id, question: c.question, pass: c.pass === true })),
      failedGates: checks.filter(c => !c.pass).map(c => ({ id: c.id, question: c.question, reason: c.reason || null })),
      verdict: isValid 
        ? 'Finding passed all 7 validation gates. Ready for submission.'
        : `Finding killed by ${checks.filter(c => !c.pass).map(c => c.id).join(', ')}.`
    };
  }

  /**
   * Validates an entire list of findings and filters for high-confidence items
   */
  filterValidFindings(findings, context = {}) {
    const validated = [];
    const rejected = [];

    for (const f of findings) {
      const evaluation = this.evaluateFinding(f, context);
      if (evaluation.isValid) {
        validated.push({ ...f, gateCheck: evaluation });
      } else {
        rejected.push({ ...f, gateCheck: evaluation });
      }
    }

    return {
      validated,
      rejected,
      stats: {
        total: findings.length,
        passed: validated.length,
        rejected: rejected.length,
        passRate: findings.length > 0 ? `${Math.round((validated.length / findings.length) * 100)}%` : '100%'
      }
    };
  }
}
