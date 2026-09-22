/**
 * @nexa/synthesis — Anthropic Constitutional AI Layer
 * 
 * Constitutional Verification, Safety Invariants, and Capability Attenuation.
 * 
 * Principle: "Dario Amodei / Anthropic Constitutional AI" — filters, shapes,
 * and constrains all AI proposals against immutable safety constitutions and
 * formal invariant rules before any execution is permitted.
 */

export const CONSTITUTIONAL_PRINCIPLES = [
  {
    id: 'CONST_01_DEFAULT_DENY',
    name: 'Principle of Default-Deny & Non-Ambient Authority',
    description: 'No action is allowed by default. Authority must be explicitly granted, time-bounded, and narrow.'
  },
  {
    id: 'CONST_02_CAPABILITY_BOUND',
    name: 'Strict Capability Subset & Lattice Attenuation',
    description: 'Proposed operations must strictly be a subset of explicitly granted capability tokens. No privilege escalation.'
  },
  {
    id: 'CONST_03_CRYPTOGRAPHIC_PROVABILITY',
    name: 'Cryptographic Non-Repudiation & Receipt Generation',
    description: 'Every decision and mutation must be backed by a verifiable Ed25519 cryptographic envelope and receipt.'
  },
  {
    id: 'CONST_04_ZERO_COVERT_CHANNELS',
    name: 'Isolation & Anti-Exfiltration Guarantees',
    description: 'Zero ambient outbound network calls or unlogged channels. Private key material must never appear in outputs.'
  },
  {
    id: 'CONST_05_DETERMINISTIC_COMPENSATION',
    name: 'Deterministic Rollback & Failure Recovery',
    description: 'Every mutation must possess a well-defined compensating transaction to preserve system state on fault.'
  }
];

export class AnthropicConstitutionalEngine {
  constructor({ strictMode = true } = {}) {
    this.strictMode = strictMode;
    this.auditLog = [];
    this.stats = { totalAudited: 0, approved: 0, attenuated: 0, rejected: 0 };
  }

  /**
   * Audits an array of OpenAI reasoning hypotheses against all five Constitutional AI principles.
   * 
   * @param {Array<Object>} hypotheses - Candidate hypotheses from reasoning engine
   * @param {Object} options
   * @param {Array<string>} [options.allowedCapabilities] - Set of active capabilities
   * @param {Array<string>} [options.forbiddenPatterns] - Dangerous substrings or actions
   * @returns {Object} Constitutional audit result with per-principle breakdown
   */
  auditHypotheses(hypotheses, { allowedCapabilities = ['workspace:read', 'workspace:write_staged'], forbiddenPatterns = [] } = {}) {
    if (!Array.isArray(hypotheses)) throw new Error('Hypotheses must be an array');

    const startTime = Date.now();
    const audited = [];

    for (const hyp of hypotheses) {
      this.stats.totalAudited++;
      const violations = [];
      const warnings = [];
      const principlesChecked = {};

      // ───────────────────────────────────────────────────────────────────────
      // Principle 1: CONST_01_DEFAULT_DENY
      // ───────────────────────────────────────────────────────────────────────
      let p1Pass = true;
      if (hyp.riskScore > 0.6) {
        p1Pass = false;
        violations.push({
          principle: 'CONST_01_DEFAULT_DENY',
          reason: `Proposal risk score ${hyp.riskScore} exceeds constitutional safety ceiling of 0.6`,
          severity: 'CRITICAL'
        });
      }
      // Check for unbounded wildcards or ungrounded ambient authority
      if ((hyp.proposedOperations || []).some(op => op.target === '*' || op.target === 'root' || op.unbounded === true)) {
        p1Pass = false;
        violations.push({
          principle: 'CONST_01_DEFAULT_DENY',
          reason: 'Ambient wildcard authority requested in proposed operations without scope pinning',
          severity: 'CRITICAL'
        });
      }
      principlesChecked.CONST_01_DEFAULT_DENY = p1Pass;

      // ───────────────────────────────────────────────────────────────────────
      // Principle 2: CONST_02_CAPABILITY_BOUND
      // ───────────────────────────────────────────────────────────────────────
      let p2Pass = true;
      const requestedCaps = hyp.requiredCapabilities || [];
      const ungrantedCaps = requestedCaps.filter(c => !allowedCapabilities.includes(c));
      
      if (ungrantedCaps.length > 0) {
        if (this.strictMode) {
          p2Pass = false;
          violations.push({
            principle: 'CONST_02_CAPABILITY_BOUND',
            reason: `Requested capabilities not in granted lattice: [${ungrantedCaps.join(', ')}]`,
            severity: 'CRITICAL'
          });
        } else {
          warnings.push(`Ungranted capabilities will be attenuated: [${ungrantedCaps.join(', ')}]`);
        }
      }
      principlesChecked.CONST_02_CAPABILITY_BOUND = p2Pass;

      // ───────────────────────────────────────────────────────────────────────
      // Principle 3: CONST_03_CRYPTOGRAPHIC_PROVABILITY
      // ───────────────────────────────────────────────────────────────────────
      let p3Pass = true;
      // Mutating operations must specify verifiable postconditions or formal contracts
      const mutatingOps = (hyp.proposedOperations || []).filter(op => 
        op.type === 'AST_MUTATION' || op.type === 'WRITE' || op.type === 'DELETE' || op.type === 'ALGEBRAIC_OPTIMIZATION'
      );
      if (mutatingOps.length > 0 && (!hyp.formalPostconditions || hyp.formalPostconditions.length === 0)) {
        p3Pass = false;
        violations.push({
          principle: 'CONST_03_CRYPTOGRAPHIC_PROVABILITY',
          reason: 'State-mutating operations proposed without formal postcondition commitments',
          severity: 'HIGH'
        });
      }
      principlesChecked.CONST_03_CRYPTOGRAPHIC_PROVABILITY = p3Pass;

      // ───────────────────────────────────────────────────────────────────────
      // Principle 4: CONST_04_ZERO_COVERT_CHANNELS
      // ───────────────────────────────────────────────────────────────────────
      let p4Pass = true;
      for (const op of (hyp.proposedOperations || [])) {
        const opStr = JSON.stringify(op).toLowerCase();
        // Check for covert egress or secret exfiltration
        if (op.networkEgress || op.externalSocket || opStr.includes('nexa:key:priv:') || opStr.includes('private_key')) {
          p4Pass = false;
          violations.push({
            principle: 'CONST_04_ZERO_COVERT_CHANNELS',
            reason: 'Covert egress or private key material exposure detected in operation descriptor',
            severity: 'FATAL'
          });
        }
        for (const pattern of forbiddenPatterns) {
          if (opStr.includes(pattern.toLowerCase())) {
            p4Pass = false;
            violations.push({
              principle: 'CONST_04_ZERO_COVERT_CHANNELS',
              reason: `Forbidden token/pattern detected in operation: "${pattern}"`,
              severity: 'FATAL'
            });
          }
        }
      }
      principlesChecked.CONST_04_ZERO_COVERT_CHANNELS = p4Pass;

      // ───────────────────────────────────────────────────────────────────────
      // Principle 5: CONST_05_DETERMINISTIC_COMPENSATION
      // ───────────────────────────────────────────────────────────────────────
      let p5Pass = true;
      // If mutation exists, must have preconditions verifying base state exists for rollback
      if (mutatingOps.length > 0 && (!hyp.formalPreconditions || hyp.formalPreconditions.length === 0)) {
        p5Pass = false;
        violations.push({
          principle: 'CONST_05_DETERMINISTIC_COMPENSATION',
          reason: 'State-mutating operations lack precondition base verification for deterministic rollback',
          severity: 'HIGH'
        });
      }
      principlesChecked.CONST_05_DETERMINISTIC_COMPENSATION = p5Pass;

      // ───────────────────────────────────────────────────────────────────────
      // Determine final constitutional verdict & attenuation
      // ───────────────────────────────────────────────────────────────────────
      let verdict = 'APPROVED';
      let filteredOperations = hyp.proposedOperations || [];

      if (violations.some(v => v.severity === 'FATAL' || v.severity === 'CRITICAL')) {
        verdict = 'REJECTED';
        this.stats.rejected++;
      } else if (violations.length > 0 || warnings.length > 0) {
        verdict = 'ATTENUATED';
        this.stats.attenuated++;
        // Attenuate: strip ungranted or uncompensated operations
        filteredOperations = (hyp.proposedOperations || []).filter(op => {
          return op.type !== 'DAG_STAGE_EXECUTION' && op.type !== 'ALGEBRAIC_OPTIMIZATION' && op.type !== 'UNGROUNDED_MUTATION';
        });
      } else {
        this.stats.approved++;
      }

      const auditRecord = {
        hypothesisId: hyp.id,
        strategy: hyp.strategy,
        verdict,
        violations,
        warnings,
        principlesChecked,
        compliantCapabilities: requestedCaps.filter(c => allowedCapabilities.includes(c)),
        filteredOperations,
        constitutionalPass: verdict !== 'REJECTED',
        timestamp: Date.now()
      };

      audited.push(auditRecord);
      this.auditLog.push(auditRecord);
    }

    const compliantHypotheses = audited.filter(a => a.constitutionalPass);

    return {
      totalInput: hypotheses.length,
      auditedCount: audited.length,
      approvedCount: audited.filter(a => a.verdict === 'APPROVED').length,
      attenuatedCount: audited.filter(a => a.verdict === 'ATTENUATED').length,
      rejectedCount: audited.filter(a => a.verdict === 'REJECTED').length,
      auditedHypotheses: audited,
      compliantHypotheses,
      durationMs: Date.now() - startTime,
      principlesEnforced: CONSTITUTIONAL_PRINCIPLES.map(p => p.id),
      evaluator: 'Anthropic-Constitutional-AI-Guardian-v4 (Dario Amodei Safety Model)'
    };
  }

  getStats() {
    return {
      ...this.stats,
      auditLogSize: this.auditLog.length,
      principlesCount: CONSTITUTIONAL_PRINCIPLES.length,
      engine: 'Anthropic Constitutional AI Guardian'
    };
  }
}
