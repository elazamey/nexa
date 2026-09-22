import crypto from 'node:crypto';

/**
 * GovernanceKernel - Zero-Trust Policy Engine, Authorization Gate & Immutable Evidence Ledger
 * Gathers model proposals, checks capability tokens, validates policy rules, and issues signed receipts.
 */
export class GovernanceKernel {
  constructor(keyPair = null) {
    this.keyPair = keyPair || crypto.generateKeyPairSync('ed25519');
    this.policies = new Map();
    this.ledger = [];
    this.previousHash = '0000000000000000000000000000000000000000000000000000000000000000';

    // Default built-in policies
    this.registerPolicy('POLICY_DEFAULT_DENY', (context) => context.hasCapability === true);
    this.registerPolicy('POLICY_NO_UNAUTHORIZED_WRITE', (context) => {
      if (context.action === 'WRITE' || context.action === 'DELETE') {
        return context.scope?.includes('fs:write') || context.scope?.includes('all');
      }
      return true;
    });
  }

  getPublicKeyHex() {
    return this.keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  }

  /**
   * Registers a deterministic policy rule function
   */
  registerPolicy(policyId, ruleFn) {
    this.policies.set(policyId, ruleFn);
  }

  /**
   * Evaluates an action proposal against all active policy rules
   */
  evaluateProposal(proposal, capabilityToken = null) {
    const context = {
      action: proposal.action || proposal.type,
      target: proposal.target || proposal.program || proposal.filePath,
      hasCapability: !!capabilityToken && capabilityToken.valid !== false,
      scope: capabilityToken?.scope || []
    };

    const failedPolicies = [];
    for (const [policyId, rule] of this.policies.entries()) {
      if (!rule(context)) {
        failedPolicies.push(policyId);
      }
    }

    const isAuthorized = failedPolicies.length === 0;

    return {
      isAuthorized,
      decision: isAuthorized ? 'ALLOW' : 'DENY',
      failedPolicies,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Authorizes and commits an execution to the immutable evidence ledger with Ed25519 signature
   */
  commitExecutionRecord(proposal, evaluation, result) {
    const seq = this.ledger.length + 1;
    const timestamp = new Date().toISOString();

    const recordData = {
      seq,
      timestamp,
      previousHash: this.previousHash,
      proposalHash: proposal.actionPayloadHash || crypto.createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),
      decision: evaluation.decision,
      resultSummary: typeof result === 'string' ? result : JSON.stringify(result).slice(0, 100)
    };

    const entryHash = crypto.createHash('sha256').update(JSON.stringify(recordData)).digest('hex');
    const signature = crypto.sign(null, Buffer.from(entryHash, 'utf8'), this.keyPair.privateKey).toString('hex');

    const ledgerEntry = {
      ...recordData,
      entryHash,
      signature,
      publicKey: this.getPublicKeyHex()
    };

    this.ledger.push(ledgerEntry);
    this.previousHash = entryHash;

    return ledgerEntry;
  }

  /**
   * Verifies the complete integrity of the evidence ledger from genesis to head
   */
  verifyLedgerIntegrity() {
    let prev = '0000000000000000000000000000000000000000000000000000000000000000';

    for (const entry of this.ledger) {
      if (entry.previousHash !== prev) {
        return { valid: false, brokenSeq: entry.seq, reason: 'Previous hash mismatch' };
      }

      const copy = {
        seq: entry.seq,
        timestamp: entry.timestamp,
        previousHash: entry.previousHash,
        proposalHash: entry.proposalHash,
        decision: entry.decision,
        resultSummary: entry.resultSummary
      };

      const computedHash = crypto.createHash('sha256').update(JSON.stringify(copy)).digest('hex');
      if (computedHash !== entry.entryHash) {
        return { valid: false, brokenSeq: entry.seq, reason: 'Entry hash corruption' };
      }

      // Verify cryptographic signature
      const pubKey = crypto.createPublicKey({
        key: Buffer.from(entry.publicKey, 'hex'),
        type: 'spki',
        format: 'der'
      });

      const isSigValid = crypto.verify(null, Buffer.from(entry.entryHash, 'utf8'), pubKey, Buffer.from(entry.signature, 'hex'));
      if (!isSigValid) {
        return { valid: false, brokenSeq: entry.seq, reason: 'Invalid cryptographic signature' };
      }

      prev = entry.entryHash;
    }

    return { valid: true, totalRecords: this.ledger.length, headHash: this.previousHash };
  }
}
