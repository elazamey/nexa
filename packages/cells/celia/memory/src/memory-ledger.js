/**
 * NEXA Memory v0.5 — Memory Ledger (Audit Trail)
 * 
 * Cryptographically auditable, hash-chained ledger for memory state changes.
 * Every memory transition is recorded with evidence_ref and actor.
 * 
 * - Immutable: hash-chained, cannot be tampered
 * - Evidence-bound: every entry has evidenceRef
 * - Auditable: actor, timestamp, action, state
 */

import crypto from 'node:crypto';

export const LedgerAction = Object.freeze({
  MEMORY_CREATED: 'MEMORY_CREATED',
  MEMORY_OBSERVED: 'MEMORY_OBSERVED',
  MEMORY_VALIDATED: 'MEMORY_VALIDATED',
  MEMORY_ACTIVATED: 'MEMORY_ACTIVATED',
  MEMORY_WEAKENED: 'MEMORY_WEAKENED',
  MEMORY_REVISED: 'MEMORY_REVISED',
  MEMORY_SUPERSEDED: 'MEMORY_SUPERSEDED',
  MEMORY_RETIRED: 'MEMORY_RETIRED',
  MEMORY_RECALLED: 'MEMORY_RECALLED',
  MEMORY_SUCCESS: 'MEMORY_SUCCESS',
  MEMORY_FAILURE: 'MEMORY_FAILURE'
});

export class MemoryLedger {
  constructor({ maxEntries = 10000 } = {}) {
    this.ledger = [];
    this.maxEntries = maxEntries;
    this.actionCounts = {};
  }

  /**
   * Record state change — hash-chained
   */
  recordChange(action, node, evidenceRef = null, actor = 'NEXA_KERNEL') {
    if (!Object.values(LedgerAction).includes(action) && !action.startsWith('MEMORY_')) {
      console.warn(`[ledger] unknown action: ${action}, allowing but should be in LedgerAction`);
    }

    const prevHash = this.ledger.length > 0 ? this.ledger[this.ledger.length - 1].hash : 'GENESIS';

    const entry = {
      index: this.ledger.length,
      timestamp: new Date().toISOString(),
      action,
      memoryId: node?.id || 'unknown',
      memoryType: node?.type || 'unknown',
      state: node?.state || 'unknown',
      evidenceRef: evidenceRef || node?.evidenceRef || null,
      actor,
      prevHash,
      hash: null,
      metadata: {
        confidence: node?.confidence,
        utility: node?.calculateUtility ? node.calculateUtility() : null,
        successCount: node?.successCount,
        failureCount: node?.failureCount
      }
    };

    // Hash: SHA256(prevHash + JSON(entry without hash))
    const entryWithoutHash = { ...entry, hash: undefined };
    entry.hash = crypto.createHash('sha256')
      .update(prevHash + JSON.stringify(entryWithoutHash))
      .digest('hex');

    this.ledger.push(entry);
    this.actionCounts[action] = (this.actionCounts[action] || 0) + 1;

    // Enforce max entries — keep genesis + recent
    if (this.ledger.length > this.maxEntries) {
      const excess = this.ledger.length - this.maxEntries;
      this.ledger.splice(1, excess); // Keep genesis at 0, remove oldest after
      // Re-index
      this.ledger.forEach((e, i) => e.index = i);
    }

    return entry;
  }

  /**
   * Record creation
   */
  recordCreation(node, evidenceRef, actor = 'NEXA_KERNEL') {
    return this.recordChange(LedgerAction.MEMORY_CREATED, node, evidenceRef, actor);
  }

  /**
   * Record recall
   */
  recordRecall(query, results, evidenceRef = null, actor = 'PLANNER') {
    const fakeNode = {
      id: `recall_${Date.now()}`,
      type: 'recall',
      state: 'RECALLED',
      confidence: null,
      calculateUtility: () => 0
    };
    return this.recordChange(LedgerAction.MEMORY_RECALLED, fakeNode, evidenceRef, actor);
  }

  /**
   * Verify chain integrity — detects tampering
   */
  verifyChain() {
    if (this.ledger.length === 0) return { valid: true, entries: 0 };

    for (let i = 0; i < this.ledger.length; i++) {
      const entry = this.ledger[i];
      const expectedPrevHash = i === 0 ? 'GENESIS' : this.ledger[i - 1].hash;

      if (entry.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          error: `Hash mismatch at index ${i}: expected prevHash ${expectedPrevHash}, got ${entry.prevHash}`,
          index: i
        };
      }

      const entryWithoutHash = { ...entry, hash: undefined };
      const expectedHash = crypto.createHash('sha256')
        .update(entry.prevHash + JSON.stringify(entryWithoutHash))
        .digest('hex');

      if (entry.hash !== expectedHash) {
        return {
          valid: false,
          error: `Hash tampered at index ${i}: expected ${expectedHash}, got ${entry.hash}`,
          index: i
        };
      }
    }

    return { valid: true, entries: this.ledger.length, genesis: this.ledger[0]?.hash };
  }

  /**
   * Get entries with filter
   */
  getEntries({ action = null, memoryId = null, actor = null, limit = 100, fromIndex = 0 } = {}) {
    let entries = this.ledger;

    if (action) entries = entries.filter(e => e.action === action);
    if (memoryId) entries = entries.filter(e => e.memoryId === memoryId);
    if (actor) entries = entries.filter(e => e.actor === actor);

    entries = entries.slice(fromIndex, fromIndex + limit);
    return entries;
  }

  /**
   * Get stats for dashboard
   */
  getStats() {
    return {
      total: this.ledger.length,
      actions: { ...this.actionCounts },
      genesis: this.ledger[0]?.hash?.slice(0, 16) || null,
      latest: this.ledger[this.ledger.length - 1]?.hash?.slice(0, 16) || null,
      valid: this.verifyChain().valid
    };
  }

  /**
   * Export for persistence (JSONL)
   */
  export() {
    return this.ledger.map(e => ({ ...e }));
  }

  /**
   * Import from persistence — verifies chain
   */
  import(entries) {
    this.ledger = entries.map(e => ({ ...e }));
    this.actionCounts = {};
    for (const e of this.ledger) {
      this.actionCounts[e.action] = (this.actionCounts[e.action] || 0) + 1;
    }

    const verification = this.verifyChain();
    if (!verification.valid) {
      console.warn(`[ledger] imported chain invalid: ${verification.error}`);
    }

    return verification;
  }

  /**
   * Clear (for tests)
   */
  clear() {
    this.ledger = [];
    this.actionCounts = {};
  }
}
