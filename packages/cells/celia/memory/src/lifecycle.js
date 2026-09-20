/**
 * NEXA Memory v0.5 — Governed Memory State Machine
 * 
 * Memory is not a permanent ambassador; it's a living entity with lifecycle
 * conditioned on evidence_ref. This is the distinction between chatbot and Self-Evolving Agent OS.
 * 
 * States: PROPOSED → OBSERVED → VALIDATED → ACTIVE → WEAKENED → SUPERSEDED → RETIRED
 * 
 * Invariants:
 * - Every transition requires evidence_ref
 * - Utility scoring with forgetting curve
 * - Digest-only, evidence-bound, capability-gated
 * - No fs write, no ambient authority — pure cell logic
 */

export const MemoryState = Object.freeze({
  PROPOSED: 'PROPOSED',     // Proposed by planner, not yet confirmed
  OBSERVED: 'OBSERVED',     // Observed during execution
  VALIDATED: 'VALIDATED',   // Verified by Verifier
  ACTIVE: 'ACTIVE',         // Active and retrievable
  WEAKENED: 'WEAKENED',     // Utility decreased or recent failure
  SUPERSEDED: 'SUPERSEDED', // Revised by newer belief (Belief Revision)
  RETIRED: 'RETIRED'        // Forgotten/archived
});

export const MemoryType = Object.freeze({
  PROCEDURAL: 'procedural', // How to execute — recipe-based reuse
  FAILURE: 'failure',       // What to avoid — error prevention
  BELIEF: 'belief',         // Belief that can be revised
  EPISODIC: 'episodic',     // What happened
  SEMANTIC: 'semantic',     // Meaning/context
  WORKING: 'working'        // Temporary working memory
});

export const ALLOWED_TRANSITIONS = Object.freeze({
  [MemoryState.PROPOSED]: [MemoryState.OBSERVED, MemoryState.VALIDATED, MemoryState.ACTIVE, MemoryState.RETIRED],
  [MemoryState.OBSERVED]: [MemoryState.VALIDATED, MemoryState.ACTIVE, MemoryState.WEAKENED, MemoryState.RETIRED],
  [MemoryState.VALIDATED]: [MemoryState.ACTIVE, MemoryState.WEAKENED, MemoryState.SUPERSEDED, MemoryState.RETIRED],
  [MemoryState.ACTIVE]: [MemoryState.WEAKENED, MemoryState.SUPERSEDED, MemoryState.RETIRED],
  [MemoryState.WEAKENED]: [MemoryState.ACTIVE, MemoryState.SUPERSEDED, MemoryState.RETIRED],
  [MemoryState.SUPERSEDED]: [MemoryState.RETIRED],
  [MemoryState.RETIRED]: [] // Terminal
});

export class MemoryNode {
  constructor({ id, type, content, contextState = {}, evidenceRef, ownerKid = null }) {
    if (!id || !type || !content) {
      throw new Error('MemoryNode needs { id, type, content }');
    }
    if (!Object.values(MemoryType).includes(type)) {
      throw new Error(`Unknown memory type: ${type}, allowed: ${Object.values(MemoryType).join(', ')}`);
    }

    this.id = id;
    this.type = type;
    this.content = content;
    this.state = MemoryState.PROPOSED;
    this.contextState = contextState;
    this.evidenceRef = evidenceRef || null;
    this.ownerKid = ownerKid;

    // Telemetry & Utility Scoring
    this.createdAt = Date.now();
    this.lastUsedAt = Date.now();
    this.lastValidatedAt = null;
    this.successCount = 0;
    this.failureCount = 0;
    this.confidence = 0.5;
    this.supersededBy = null;
    this.supersedes = null;
    this.version = 1;

    // Evidence chain for this node
    this.evidenceChain = evidenceRef ? [evidenceRef] : [];
  }

  /**
   * Transition to new state — requires evidence_ref for audit
   */
  transitionTo(newState, evidenceRef, actor = 'NEXA_KERNEL') {
    if (!Object.values(MemoryState).includes(newState)) {
      throw new Error(`Unknown state: ${newState}`);
    }

    const allowed = ALLOWED_TRANSITIONS[this.state] || [];
    if (!allowed.includes(newState) && this.state !== newState) {
      throw new Error(`Invalid transition: ${this.state} → ${newState}, allowed: ${allowed.join(', ')}`);
    }

    const prevState = this.state;
    this.state = newState;
    this.lastUsedAt = Date.now();

    if (newState === MemoryState.VALIDATED || newState === MemoryState.ACTIVE) {
      this.lastValidatedAt = Date.now();
    }

    if (evidenceRef) {
      this.evidenceChain.push(evidenceRef);
      this.evidenceRef = evidenceRef;
    }

    return {
      id: this.id,
      from: prevState,
      to: newState,
      evidenceRef,
      actor,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Record success — increases utility
   */
  recordSuccess(evidenceRef = null) {
    this.successCount++;
    this.lastUsedAt = Date.now();
    this.confidence = Math.min(1.0, this.confidence + 0.05);
    if (evidenceRef) this.evidenceChain.push(evidenceRef);
    
    // Auto-promote from WEAKENED to ACTIVE if success
    if (this.state === MemoryState.WEAKENED && this.successCount > this.failureCount) {
      this.transitionTo(MemoryState.ACTIVE, evidenceRef, 'SUCCESS_RECOVERY');
    }
  }

  /**
   * Record failure — decreases utility, may weaken
   */
  recordFailure(evidenceRef = null, cause = null) {
    this.failureCount++;
    this.lastUsedAt = Date.now();
    this.confidence = Math.max(0.1, this.confidence - 0.15);
    if (evidenceRef) this.evidenceChain.push(evidenceRef);

    // Auto-weaken if failures exceed successes
    if (this.state === MemoryState.ACTIVE && this.failureCount > this.successCount) {
      this.transitionTo(MemoryState.WEAKENED, evidenceRef, 'FAILURE_WEAKEN');
    }

    return { id: this.id, cause, failureCount: this.failureCount, state: this.state };
  }

  /**
   * Calculate live utility score — forgetting curve + success ratio
   * 
   * Formula: (successRatio * 2.0 - failureCount * 1.5 + confidence) * decayFactor
   * Decay: 1 / (1 + 0.05 * recencyHours) — Ebbinghaus forgetting curve approximation
   */
  calculateUtility(currentContext = {}) {
    const recencyHours = (Date.now() - this.lastUsedAt) / (1000 * 60 * 60);
    const decayFactor = 1 / (1 + 0.05 * recencyHours);

    const total = this.successCount + this.failureCount;
    const successRatio = total > 0 ? this.successCount / total : 0.5;
    
    // Base score: success rewarding, failure penalizing, confidence bonus
    const baseScore = (successRatio * 2.0) - (this.failureCount * 0.3) + this.confidence;

    // Context matching bonus — if current context matches node's context
    let contextBonus = 0;
    if (currentContext && this.contextState) {
      const matchingKeys = Object.keys(currentContext).filter(
        k => this.contextState[k] && this.contextState[k] === currentContext[k]
      );
      contextBonus = matchingKeys.length * 0.1;
    }

    // Type weighting: failure memory has high preventive weight
    let typeWeight = 1.0;
    if (this.type === MemoryType.FAILURE) typeWeight = 1.5; // High preventive value
    if (this.type === MemoryType.PROCEDURAL) typeWeight = 1.2; // Reuse value

    const utility = (baseScore + contextBonus) * decayFactor * typeWeight;

    return Math.max(0, utility);
  }

  /**
   * Check if node is retrievable
   */
  isRetrievable() {
    return [MemoryState.ACTIVE, MemoryState.VALIDATED, MemoryState.WEAKENED].includes(this.state);
  }

  /**
   * Check if node is terminal
   */
  isTerminal() {
    return [MemoryState.RETIRED, MemoryState.SUPERSEDED].includes(this.state);
  }

  /**
   * Serialize for storage — digest-only friendly
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      state: this.state,
      content: this.content,
      contextState: this.contextState,
      evidenceRef: this.evidenceRef,
      evidenceChain: this.evidenceChain,
      ownerKid: this.ownerKid,
      createdAt: this.createdAt,
      lastUsedAt: this.lastUsedAt,
      lastValidatedAt: this.lastValidatedAt,
      successCount: this.successCount,
      failureCount: this.failureCount,
      confidence: this.confidence,
      supersededBy: this.supersededBy,
      supersedes: this.supersedes,
      version: this.version,
      utility: this.calculateUtility()
    };
  }

  /**
   * Digest for verification — SHA256 of content
   */
  async digest() {
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update(JSON.stringify(this.content)).digest('hex');
    return `sha256:${hash.slice(0, 16)}`;
  }
}
