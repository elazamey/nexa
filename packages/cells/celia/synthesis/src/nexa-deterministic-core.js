/**
 * @nexa/synthesis — NEXA Deterministic Immunity Core
 * 
 * Cryptographic Invariant Enforcement, Ed25519 Envelope Verification,
 * Macaroon Capabilities, Default-Deny Policy, and Hash-Chained Evidence Receipts.
 * 
 * Principle: "AI Proposes, NEXA Decides" — The deterministic cryptographic judge
 * that possesses exclusive authority to grant, verify, record, and commit state transitions.
 */

import { createIdentity } from '../../../../identity/index.js';
import { mintCapability, attenuate, verifyCapability } from '../../../../capability/index.js';
import { Policy } from '../../../../policy/index.js';
import { buildEnvelope, verifyEnvelope, ReplayGuard, UsageLedger } from '../../../../protocol/index.js';
import { EvidenceLog, createReceipt } from '../../../../evidence/index.js';
import { formatInstant } from '../../../../ast/index.js';

export class NexaDeterministicCore {
  constructor({
    operator = null,
    audience = null,
    trustedIssuers = [],
    policyRules = []
  } = {}) {
    // Generate or bind operator identity
    this.operator = operator || createIdentity({ label: 'nexa-grand-operator' });
    this.audience = audience || createIdentity({ label: 'nexa-grand-audience' });
    
    this.trustedIssuers = trustedIssuers.length > 0 
      ? trustedIssuers 
      : [this.operator.kid];

    // Default policy rules: Default-Deny + Allow specific actions
    const rules = policyRules.length > 0 ? policyRules : [
      {
        id: 'rule-001-workspace-read',
        effect: 'ALLOW',
        resource: 'workspace:*',
        actions: ['read', 'inspect'],
        description: 'Allow reading workspace state with valid token'
      },
      {
        id: 'rule-002-workspace-commit',
        effect: 'ALLOW',
        resource: 'workspace_commit:*',
        actions: ['commit', 'apply_patch'],
        description: 'Allow atomic commit with verified macaroon capability'
      }
    ];

    this.policy = new Policy({ rules });
    this.replayGuard = new ReplayGuard();
    this.usageLedger = new UsageLedger();
    this.evidenceLog = new EvidenceLog({ actor: this.operator });

    this.stats = {
      envelopesVerified: 0,
      capabilitiesVerified: 0,
      decisionsAllowed: 0,
      decisionsDenied: 0,
      receiptsIssued: 0
    };
  }

  /**
   * Mints an authentic capability token for a caller principal.
   */
  mintAuthority({
    subject,
    resource = 'workspace_commit:global',
    actions = ['commit', 'apply_patch'],
    maxUses = 1,
    ttlSeconds = 300,
    constraints = {}
  }) {
    const exp = formatInstant(Date.now() + (ttlSeconds * 1000));
    return mintCapability({
      issuer: this.operator,
      subject,
      resource,
      actions,
      constraints,
      caveats: {
        max_uses: maxUses,
        max_depth: 1,
        exp
      }
    });
  }

  /**
   * Attenuates an existing capability token to narrow its scope or actions.
   */
  attenuateAuthority(token, { delegator, subject, resource, actions, caveats = {} }) {
    return attenuate(token, {
      delegator,
      subject,
      resource: resource || token.resource,
      actions: actions || token.actions,
      caveats
    });
  }

  /**
   * Evaluates and authoritatively decides on a proposed action.
   * 
   * Steps:
   * 1. Cryptographic envelope signature verification (Ed25519)
   * 2. Replay attack verification (ReplayGuard)
   * 3. Capability macaroon chain & budget verification (UsageLedger)
   * 4. Policy lattice evaluation (Default-Deny)
   * 5. Evidence chain logging & signed cryptographic receipt issuance
   * 
   * @param {Object} envelope - Canonical signed Ed25519 envelope
   * @param {Object} options
   * @returns {Object} Authoritative decision with signed cryptographic receipt
   */
  evaluateAndDecide(envelope, { now = new Date() } = {}) {
    this.stats.envelopesVerified++;
    const startTime = Date.now();

    // 1. Verify envelope cryptographic signature
    let verifiedEnvelope;
    try {
      verifiedEnvelope = verifyEnvelope(envelope, {
        now,
        skewSeconds: 30,
        allowedTypes: ['CALL']
      });
    } catch (err) {
      this.stats.decisionsDenied++;
      return this._logDecisionAndReceipt({
        decision: 'DENY',
        reason: `Envelope signature invalid: ${err.message}`,
        code: 'NEXA_E_IDENTITY_INVALID',
        envelope,
        durationMs: Date.now() - startTime
      });
    }

    // 2. Replay guard check
    if (this.replayGuard.hasSeen(envelope)) {
      this.stats.decisionsDenied++;
      return this._logDecisionAndReceipt({
        decision: 'DENY',
        reason: 'Replay detected: Envelope nonce/hash already seen',
        code: 'NEXA_E_REPLAY_DETECTED',
        envelope,
        durationMs: Date.now() - startTime
      });
    }

    const { resource, action, capability: token } = envelope.body || {};

    // 3. Verify Capability Macaroon
    if (!token) {
      this.stats.decisionsDenied++;
      return this._logDecisionAndReceipt({
        decision: 'DENY',
        reason: 'Missing capability token in envelope body',
        code: 'NEXA_E_CAP_REQUIRED',
        envelope,
        durationMs: Date.now() - startTime
      });
    }

    let grant;
    try {
      this.stats.capabilitiesVerified++;
      const capResult = verifyCapability(token, {
        now,
        presenter: envelope.from,
        trustedIssuers: this.trustedIssuers,
        resource,
        action,
        uses: (id) => this.usageLedger.used(id)
      });
      grant = capResult.grant;
    } catch (err) {
      this.stats.decisionsDenied++;
      return this._logDecisionAndReceipt({
        decision: 'DENY',
        reason: `Capability verification failed: ${err.message}`,
        code: 'NEXA_E_CAP_DENIED',
        envelope,
        durationMs: Date.now() - startTime
      });
    }

    // 4. Evaluate Policy Lattice (Default-Deny)
    const policyVerdict = this.policy.evaluate({
      subject: envelope.from,
      resource,
      action,
      capability: grant,
      signals: { signed: true }
    });

    if (policyVerdict.effect !== 'ALLOW') {
      this.stats.decisionsDenied++;
      return this._logDecisionAndReceipt({
        decision: 'DENY',
        reason: `Policy rejected action ${action} on ${resource}`,
        code: 'NEXA_E_POLICY_DENIED',
        rule: policyVerdict.rule,
        envelope,
        durationMs: Date.now() - startTime
      });
    }

    // Commit state in replay guard and usage ledger
    this.replayGuard.commit(envelope, now);
    const links = [token]; // Spend the immediate token
    this.usageLedger.spend(links.map(l => l.id), links.map(l => l.caveats));
    this.stats.decisionsAllowed++;

    return this._logDecisionAndReceipt({
      decision: 'ALLOW',
      reason: 'Cryptographically verified, capability authenticated, policy approved',
      code: 'NEXA_OK_AUTHORIZED',
      rule: policyVerdict.rule,
      grant,
      envelope,
      durationMs: Date.now() - startTime
    });
  }

  _logDecisionAndReceipt({ decision, reason, code, rule = null, grant = null, envelope, durationMs }) {
    const subject = envelope?.from || this.operator.kid;
    const resource = envelope?.body?.resource || 'workspace_commit:global';
    const action = envelope?.body?.action || 'commit';
    const capability = envelope?.body?.capability?.id;

    const record = this.evidenceLog.append({
      kind: 'POLICY_DECISION',
      decision,
      subject,
      resource,
      action,
      ...(capability ? { capability } : {}),
      detail: {
        code,
        reason,
        rule
      }
    });

    const receipt = createReceipt({
      actor: this.operator,
      record,
      chainHead: record.hash
    });

    this.stats.receiptsIssued++;

    return {
      decision,
      allowed: decision === 'ALLOW',
      code,
      reason,
      rule,
      recordHash: record.hash,
      receipt,
      durationMs,
      evidenceHead: this.evidenceLog.head?.hash,
      verifiedOffline: true
    };
  }

  getStats() {
    return {
      ...this.stats,
      evidenceChainLength: this.evidenceLog.length,
      operatorKid: this.operator.kid,
      audienceKid: this.audience.kid,
      engine: 'NEXA Deterministic Immunity Core (Ed25519 & Macaroons)'
    };
  }
}
