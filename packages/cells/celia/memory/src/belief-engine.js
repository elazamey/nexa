/**
 * NEXA Memory v0.5 — Belief Revision & Forgetting Engine
 * 
 * Revises old beliefs when new evidence disproves them,
 * and archives dead knowledge automatically via utility scoring.
 * 
 * - Belief Revision: Immutable revision edges & superseding
 * - Forgetting Engine: Utility Score-based Automatic Sweeping
 * - State-Aware Pre-Filtering
 */

import { MemoryState, MemoryType } from './lifecycle.js';
import { MemoryNode } from './lifecycle.js';

export class BeliefRevisionEngine {
  constructor(proceduralStore, ledger = null) {
    if (!proceduralStore) throw new Error('BeliefRevisionEngine needs proceduralStore');
    this.proceduralStore = proceduralStore;
    this.ledger = ledger;

    this.revisionHistory = []; // { oldId, newId, reason, timestamp, evidenceRef }
  }

  /**
   * Revise belief based on new evidence — creates new node, supersedes old
   */
  reviseBelief(oldMemoryId, newContent, evidenceRef, actor = 'BELIEF_REVISION') {
    const oldNode = this.proceduralStore.store.get(oldMemoryId);
    if (!oldNode) throw new Error(`Memory node not found: ${oldMemoryId}`);
    if (!evidenceRef) {
      console.warn('[belief-engine] reviseBelief without evidenceRef — should be evidence-bound');
    }

    // Create new node with updated content
    const newId = `${oldNode.id}_rev_${Date.now().toString(36)}`;
    
    const newNode = new MemoryNode({
      id: newId,
      type: oldNode.type,
      content: {
        ...oldNode.content,
        ...newContent,
        revisedFrom: oldMemoryId,
        revisedAt: new Date().toISOString()
      },
      contextState: newContent.condition || newContent.contextState || oldNode.contextState,
      evidenceRef,
      ownerKid: oldNode.ownerKid
    });

    newNode.state = MemoryState.VALIDATED;
    newNode.confidence = newContent.confidence || 0.8;
    newNode.version = oldNode.version + 1;
    newNode.supersedes = oldMemoryId;
    newNode.successCount = oldNode.successCount;
    newNode.failureCount = 0; // Reset failures for new revision

    // Link old → new and mark superseded
    const transition = oldNode.transitionTo(MemoryState.SUPERSEDED, evidenceRef, actor);
    oldNode.supersededBy = newId;

    this.proceduralStore.store.set(newId, newNode);
    this.proceduralStore._indexNode(newNode);

    const revision = {
      previous: oldNode.id,
      current: newNode.id,
      status: 'REVISED',
      reason: newContent.reason || 'new evidence',
      evidenceRef,
      actor,
      timestamp: new Date().toISOString(),
      transition
    };

    this.revisionHistory.push(revision);

    if (this.ledger) {
      this.ledger.recordChange('MEMORY_REVISED', newNode, evidenceRef, actor);
      this.ledger.recordChange('MEMORY_SUPERSEDED', oldNode, evidenceRef, actor);
    }

    return revision;
  }

  /**
   * Supersede with strategy — for procedural memory updates
   */
  supersedeStrategy(oldId, { taskIntent, condition, strategyDAG, evidenceRef, reason }) {
    return this.reviseBelief(oldId, {
      taskIntent: taskIntent,
      condition,
      strategyDAG,
      reason: reason || 'strategy improved'
    }, evidenceRef, 'STRATEGY_SUPERSEDE');
  }

  /**
   * Forgetting Engine Sweep — archives low-utility nodes automatically
   * 
   * @param {number} minUtilityThreshold — nodes below this are retired (default 0.1)
   * @param {object} options — { keepFailures: true, keepActiveBeliefs: false }
   */
  runForgettingSweep(minUtilityThreshold = 0.1, options = {}) {
    const { keepFailures = true, keepActiveBeliefs = false, maxRetire = 100 } = options;
    let retiredCount = 0;
    const retired = [];

    // Sort by utility ascending — lowest first
    const candidates = [...this.proceduralStore.store.values()]
      .filter(node => {
        if (node.state === MemoryState.RETIRED) return false;
        if (node.state === MemoryState.SUPERSEDED) return false;
        if (keepFailures && node.type === MemoryType.FAILURE && node.state === MemoryState.ACTIVE) return false;
        if (keepActiveBeliefs && node.type === MemoryType.BELIEF && node.state === MemoryState.ACTIVE) return false;
        return true;
      })
      .sort((a, b) => a.calculateUtility() - b.calculateUtility());

    for (const node of candidates) {
      if (retiredCount >= maxRetire) break;

      const utility = node.calculateUtility();

      if (utility < minUtilityThreshold) {
        const prevState = node.state;
        try {
          node.transitionTo(MemoryState.RETIRED, null, 'FORGETTING_SWEEP');
          retired.push({
            id: node.id,
            type: node.type,
            state: prevState,
            utility,
            reason: `utility ${utility.toFixed(3)} < threshold ${minUtilityThreshold}`
          });
          retiredCount++;

          if (this.ledger) {
            this.ledger.recordChange('MEMORY_RETIRED', node, null, 'FORGETTING_ENGINE');
          }
        } catch (e) {
          // Invalid transition — skip
          console.warn(`[forgetting] cannot retire ${node.id} from ${prevState}: ${e.message}`);
        }
      }
    }

    return {
      swept: retiredCount,
      threshold: minUtilityThreshold,
      retired,
      time: new Date().toISOString(),
      remaining: this.proceduralStore.store.size
    };
  }

  /**
   * Weakening sweep — moves ACTIVE nodes with low utility to WEAKENED
   */
  runWeakeningSweep(utilityThreshold = 0.4) {
    let weakenedCount = 0;
    const weakened = [];

    for (const node of this.proceduralStore.store.values()) {
      if (node.state !== MemoryState.ACTIVE) continue;
      if (node.type === MemoryType.FAILURE) continue; // Never weaken active failures

      const utility = node.calculateUtility();
      if (utility < utilityThreshold) {
        try {
          node.transitionTo(MemoryState.WEAKENED, null, 'WEAKENING_SWEEP');
          weakened.push({ id: node.id, utility, type: node.type });
          weakenedCount++;

          if (this.ledger) {
            this.ledger.recordChange('MEMORY_WEAKENED', node, null, 'WEAKENING_ENGINE');
          }
        } catch (e) {
          console.warn(`[weakening] cannot weaken ${node.id}: ${e.message}`);
        }
      }
    }

    return {
      weakened: weakenedCount,
      threshold: utilityThreshold,
      nodes: weakened,
      time: new Date().toISOString()
    };
  }

  /**
   * Get revision history
   */
  getRevisionHistory(limit = 50) {
    return this.revisionHistory.slice(-limit).reverse();
  }

  /**
   * Find latest active version of a memory chain
   */
  getLatestVersion(originalId) {
    let current = this.proceduralStore.get(originalId);
    if (!current) return null;

    const chain = [current];
    while (current && current.supersededBy) {
      current = this.proceduralStore.get(current.supersededBy);
      if (current) chain.push(current);
    }

    return {
      original: originalId,
      latest: chain[chain.length - 1],
      chain: chain.map(n => ({ id: n.id, state: n.state, version: n.version, supersededBy: n.supersededBy })),
      length: chain.length
    };
  }

  /**
   * Prune retired nodes — hard delete after retention period
   * 
   * @param {number} retentionDays — days to keep retired nodes
   */
  pruneRetired(retentionDays = 7) {
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    let pruned = 0;

    for (const [id, node] of this.proceduralStore.store.entries()) {
      if (node.state === MemoryState.RETIRED && node.lastUsedAt < cutoff) {
        this.proceduralStore.store.delete(id);
        pruned++;
      }
    }

    return { pruned, retentionDays, cutoff: new Date(cutoff).toISOString() };
  }
}
