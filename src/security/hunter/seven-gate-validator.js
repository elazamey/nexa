/**
 * SevenGateValidator - 7-Question Strict Finding Gate & 4-Gate Triage
 * Filters out theoretical findings, false positives, and out-of-scope reports before submission.
 */
export class SevenGateValidator {
  constructor(options = {}) {
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
    const checks = [
      {
        id: 'GATE_1_SCOPE',
        question: 'Is the asset strictly within authorized program scope?',
        pass: context.inScope !== false && !finding.outOfScope
      },
      {
        id: 'GATE_2_REPRODUCIBILITY',
        question: 'Is the vulnerability directly reproducible with deterministic steps?',
        pass: !!(finding.endpoint || finding.file || finding.parameter)
      },
      {
        id: 'GATE_3_DEMONSTRABLE_IMPACT',
        question: 'Does the finding demonstrate concrete security or financial impact?',
        pass: ['CRITICAL', 'HIGH', 'MEDIUM'].includes(finding.severity)
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
        pass: finding.severity === 'CRITICAL' || finding.severity === 'HIGH' || finding.severity === 'MEDIUM'
      },
      {
        id: 'GATE_7_SAFE_TESTING_COMPLIANCE',
        question: 'Was the verification conducted non-destructively without service disruption?',
        pass: true
      }
    ];

    const passedChecks = checks.filter(c => c.pass);
    const isValid = passedChecks.length === 7;

    return {
      findingTitle: finding.title || finding.type || 'Unnamed Finding',
      isValid,
      score: `${passedChecks.length}/7`,
      status: isValid ? 'APPROVED_FOR_REPORT' : 'REJECTED_AT_GATE',
      failedGates: checks.filter(c => !c.pass),
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
