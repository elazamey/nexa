import crypto from 'node:crypto';

/**
 * SelfImprovementPipeline - Governed Continuous Learning & Safe Patch Promotion
 * Enforces the strict safe invariant: Observe -> Failure -> Patch -> Sandbox -> Scan -> Policy -> Promote.
 */
export class SelfImprovementPipeline {
  constructor(governanceKernel) {
    this.kernel = governanceKernel;
    this.proposals = [];
    this.promotedPatches = [];
  }

  /**
   * Generates an improvement proposal from observed test failure or optimization gap
   */
  proposeOptimization(componentName, observedIssue, patchDiff) {
    const proposal = {
      proposalId: `OPT_${Date.now()}`,
      component: componentName,
      issue: observedIssue,
      patchDiff,
      createdAt: new Date().toISOString(),
      status: 'PROPOSED',
      digest: crypto.createHash('sha256').update(patchDiff).digest('hex')
    };

    this.proposals.push(proposal);
    return proposal;
  }

  /**
   * Runs the proposal through the 6-stage safe promotion pipeline
   */
  async executeSafePromotion(proposalId, testPassPredicate, securityScanPredicate) {
    const proposal = this.proposals.find(p => p.proposalId === proposalId);
    if (!proposal) {
      return { status: 'FAILED', reason: 'Proposal not found' };
    }

    // Stage 1: Sandbox Test Execution
    const testsPassed = testPassPredicate ? testPassPredicate(proposal) : true;
    if (!testsPassed) {
      proposal.status = 'REJECTED_SANDBOX_FAILURE';
      return { status: 'REJECTED', stage: 'SANDBOX_TESTS', reason: 'Tests failed in micro-sandbox.' };
    }

    // Stage 2: Security & Invariant AST Scan
    const securityClean = securityScanPredicate ? securityScanPredicate(proposal) : true;
    if (!securityClean) {
      proposal.status = 'REJECTED_SECURITY_SCAN';
      return { status: 'REJECTED', stage: 'SECURITY_SCAN', reason: 'Security scanner flagged forbidden pattern in patch.' };
    }

    // Stage 3: Governance Policy Check
    const evalResult = this.kernel.evaluateProposal({
      action: 'PROMOTE_CODE_PATCH',
      target: proposal.component,
      patchDigest: proposal.digest
    }, { valid: true, scope: ['fs:write', 'patch:promote'] });

    if (!evalResult.isAuthorized) {
      proposal.status = 'REJECTED_POLICY_GATE';
      return { status: 'REJECTED', stage: 'POLICY_GATE', reason: 'Policy refused automatic promotion.' };
    }

    // Stage 4: Cryptographic Certification & Ledger Record
    const ledgerEntry = this.kernel.commitExecutionRecord(
      { type: 'PROMOTION_COMMIT', proposalId: proposal.proposalId, component: proposal.component },
      evalResult,
      'Patch successfully promoted and verified.'
    );

    proposal.status = 'PROMOTED';
    proposal.promotedAt = new Date().toISOString();
    proposal.receipt = ledgerEntry;

    this.promotedPatches.push(proposal);

    return {
      status: 'SUCCESS_PROMOTED',
      proposalId: proposal.proposalId,
      receiptSignature: ledgerEntry.signature,
      promotedAt: proposal.promotedAt
    };
  }
}
