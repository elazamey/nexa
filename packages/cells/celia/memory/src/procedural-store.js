/**
 * NEXA Memory v0.5 — Procedural & Failure Engine
 * 
 * Stores HOW to execute and WHAT to avoid, not just WHAT happened.
 * Indexed by intent & failure signatures, state-aware retrieval.
 * 
 * - Procedural Memory: Recipe-based execution reuse
 * - Failure Memory: Preemption & error prevention rules
 * 
 * Security: No fs, no net — pure in-memory with Map, evidence-bound
 */

import crypto from 'node:crypto';
import { MemoryNode, MemoryState, MemoryType } from './lifecycle.js';

export class NexaProceduralMemory {
  constructor({ maxNodes = 1000 } = {}) {
    this.store = new Map(); // id → MemoryNode
    this.intentIndex = new Map(); // taskIntent → Set<id>
    this.failureIndex = new Map(); // failurePattern → Set<id>
    this.typeIndex = new Map(); // type → Set<id>
    this.maxNodes = maxNodes;

    // Telemetry
    this.stats = {
      proceduralCount: 0,
      failureCount: 0,
      totalRecalls: 0,
      preventionsTriggered: 0,
      strategiesReused: 0
    };
  }

  /**
   * Register successful strategy — Procedural Memory
   */
  registerStrategy({ taskIntent, condition = {}, strategyDAG, evidenceRef, ownerKid = null, confidence = 0.9 }) {
    if (!taskIntent || !strategyDAG) {
      throw new Error('registerStrategy needs { taskIntent, strategyDAG, evidenceRef }');
    }

    const id = `proc_${crypto.createHash('sha256').update(taskIntent + JSON.stringify(condition)).digest('hex').slice(0, 12)}`;

    // If exists, update instead of duplicate — belief revision path
    if (this.store.has(id)) {
      const existing = this.store.get(id);
      existing.content.strategyDAG = strategyDAG;
      existing.content.condition = condition;
      existing.version++;
      existing.recordSuccess(evidenceRef);
      existing.transitionTo(MemoryState.VALIDATED, evidenceRef, 'STRATEGY_UPDATE');
      return existing;
    }

    const node = new MemoryNode({
      id,
      type: MemoryType.PROCEDURAL,
      content: { taskIntent, condition, strategyDAG },
      contextState: condition,
      evidenceRef,
      ownerKid
    });

    node.state = MemoryState.VALIDATED;
    node.confidence = confidence;
    node.successCount = 1;

    this.store.set(id, node);
    this._indexNode(node);
    this.stats.proceduralCount++;

    // Enforce max nodes — forgetting sweep if needed
    if (this.store.size > this.maxNodes) {
      this._enforceLimit();
    }

    return node;
  }

  /**
   * Register failure to avoid — Failure Memory (high preventive weight)
   */
  registerFailure({ failurePattern, cause, preventiveFix, contextState = {}, evidenceRef, ownerKid = null }) {
    if (!failurePattern || !cause) {
      throw new Error('registerFailure needs { failurePattern, cause, preventiveFix, evidenceRef }');
    }

    const id = `fail_${crypto.createHash('sha256').update(failurePattern + cause).digest('hex').slice(0, 12)}`;

    if (this.store.has(id)) {
      const existing = this.store.get(id);
      existing.content.preventiveFix = preventiveFix;
      existing.content.cause = cause;
      existing.version++;
      existing.confidence = 1.0;
      existing.failureCount++;
      existing.transitionTo(MemoryState.ACTIVE, evidenceRef, 'FAILURE_UPDATE');
      return existing;
    }

    const node = new MemoryNode({
      id,
      type: MemoryType.FAILURE,
      content: { failurePattern, cause, preventiveFix },
      contextState,
      evidenceRef,
      ownerKid
    });

    node.state = MemoryState.ACTIVE;
    node.confidence = 1.0; // Failures have very high preventive weight
    node.failureCount = 1;

    this.store.set(id, node);
    this._indexNode(node);
    this.stats.failureCount++;

    if (this.store.size > this.maxNodes) {
      this._enforceLimit();
    }

    return node;
  }

  /**
   * Register belief — can be revised later
   */
  registerBelief({ belief, condition = {}, evidenceRef, ownerKid = null, confidence = 0.6 }) {
    const id = `belief_${crypto.createHash('sha256').update(belief + JSON.stringify(condition)).digest('hex').slice(0, 12)}`;

    if (this.store.has(id)) {
      const existing = this.store.get(id);
      existing.content.belief = belief;
      existing.version++;
      existing.recordSuccess(evidenceRef);
      return existing;
    }

    const node = new MemoryNode({
      id,
      type: MemoryType.BELIEF,
      content: { belief, condition },
      contextState: condition,
      evidenceRef,
      ownerKid
    });

    node.state = MemoryState.ACTIVE;
    node.confidence = confidence;

    this.store.set(id, node);
    this._indexNode(node);
    return node;
  }

  /**
   * State-aware retrieval — preventions + strategies matching intent and system state
   */
  recallRelevantKnowledge(taskIntent, currentSystemState = {}) {
    this.stats.totalRecalls++;

    const preventions = [];
    const strategies = [];
    const beliefs = [];

    for (const node of this.store.values()) {
      if (node.isTerminal()) continue;

      const utility = node.calculateUtility(currentSystemState);

      // 1. Failure memory — prevent recurring mistakes
      if (node.type === MemoryType.FAILURE) {
        const pattern = node.content.failurePattern || '';
        // Fuzzy match: taskIntent includes pattern or pattern includes part of intent
        if (taskIntent.toLowerCase().includes(pattern.toLowerCase()) || 
            pattern.toLowerCase().includes(taskIntent.toLowerCase().split(' ')[0])) {
          preventions.push({
            id: node.id,
            ...node.content,
            utility,
            confidence: node.confidence,
            state: node.state
          });
          node.lastUsedAt = Date.now();
          this.stats.preventionsTriggered++;
        }
      }

      // 2. Procedural — successful strategies
      if (node.type === MemoryType.PROCEDURAL) {
        const intentMatch = node.content.taskIntent === taskIntent ||
                           taskIntent.includes(node.content.taskIntent) ||
                           node.content.taskIntent.includes(taskIntent);

        if (intentMatch) {
          if (utility > 0.4) {
            strategies.push({
              id: node.id,
              ...node.content,
              utility,
              confidence: node.confidence,
              state: node.state,
              successCount: node.successCount
            });
            node.lastUsedAt = Date.now();
            this.stats.strategiesReused++;
          } else {
            // Weaken low-utility strategies
            if (node.state === MemoryState.ACTIVE) {
              node.transitionTo(MemoryState.WEAKENED, null, 'LOW_UTILITY');
            }
          }
        }
      }

      // 3. Belief — contextual beliefs
      if (node.type === MemoryType.BELIEF && utility > 0.3) {
        beliefs.push({
          id: node.id,
          ...node.content,
          utility,
          confidence: node.confidence,
          state: node.state
        });
      }
    }

    // Sort by utility descending
    preventions.sort((a, b) => b.utility - a.utility);
    strategies.sort((a, b) => b.utility - a.utility);
    beliefs.sort((a, b) => b.utility - a.utility);

    return { preventions, strategies, beliefs };
  }

  /**
   * Get node by id
   */
  get(id) {
    return this.store.get(id) || null;
  }

  /**
   * List all nodes with optional filter
   */
  list({ type = null, state = null, minUtility = 0, limit = 100 } = {}) {
    let nodes = [...this.store.values()];

    if (type) nodes = nodes.filter(n => n.type === type);
    if (state) nodes = nodes.filter(n => n.state === state);
    if (minUtility > 0) nodes = nodes.filter(n => n.calculateUtility() > minUtility);

    nodes.sort((a, b) => b.calculateUtility() - a.calculateUtility());
    return nodes.slice(0, limit).map(n => n.toJSON());
  }

  /**
   * Record success for a node
   */
  recordSuccess(id, evidenceRef = null) {
    const node = this.store.get(id);
    if (!node) throw new Error(`Node not found: ${id}`);
    node.recordSuccess(evidenceRef);
    return node;
  }

  /**
   * Record failure for a node
   */
  recordFailure(id, evidenceRef = null, cause = null) {
    const node = this.store.get(id);
    if (!node) throw new Error(`Node not found: ${id}`);
    return node.recordFailure(evidenceRef, cause);
  }

  /**
   * Stats for dashboard telemetry
   */
  getStats() {
    const states = {};
    const types = {};
    let totalUtility = 0;
    let retrievable = 0;

    for (const node of this.store.values()) {
      states[node.state] = (states[node.state] || 0) + 1;
      types[node.type] = (types[node.type] || 0) + 1;
      totalUtility += node.calculateUtility();
      if (node.isRetrievable()) retrievable++;
    }

    return {
      total: this.store.size,
      retrievable,
      states,
      types,
      avgUtility: this.store.size > 0 ? totalUtility / this.store.size : 0,
      ...this.stats
    };
  }

  // Internal: index node for fast lookup
  _indexNode(node) {
    // Intent index
    if (node.content.taskIntent) {
      const intent = node.content.taskIntent;
      if (!this.intentIndex.has(intent)) this.intentIndex.set(intent, new Set());
      this.intentIndex.get(intent).add(node.id);
    }

    // Failure index
    if (node.content.failurePattern) {
      const pattern = node.content.failurePattern;
      if (!this.failureIndex.has(pattern)) this.failureIndex.set(pattern, new Set());
      this.failureIndex.get(pattern).add(node.id);
    }

    // Type index
    if (!this.typeIndex.has(node.type)) this.typeIndex.set(node.type, new Set());
    this.typeIndex.get(node.type).add(node.id);
  }

  // Internal: enforce max nodes via forgetting sweep
  _enforceLimit() {
    const nodes = [...this.store.values()]
      .filter(n => n.state !== MemoryState.ACTIVE || n.type !== MemoryType.FAILURE) // Keep active failures
      .sort((a, b) => a.calculateUtility() - b.calculateUtility());

    const toRemove = nodes.slice(0, Math.ceil(this.store.size - this.maxNodes * 0.8));
    for (const node of toRemove) {
      if (node.type === MemoryType.FAILURE && node.state === MemoryState.ACTIVE) continue; // Never auto-remove active failures
      node.transitionTo(MemoryState.RETIRED, null, 'LIMIT_ENFORCE');
      this.store.delete(node.id);
    }
  }

  /**
   * Export for persistence (JSONL / SQLite)
   */
  export() {
    return [...this.store.values()].map(n => n.toJSON());
  }

  /**
   * Import from persistence
   */
  import(dataArray) {
    for (const data of dataArray) {
      const node = new MemoryNode({
        id: data.id,
        type: data.type,
        content: data.content,
        contextState: data.contextState,
        evidenceRef: data.evidenceRef,
        ownerKid: data.ownerKid
      });
      node.state = data.state;
      node.createdAt = data.createdAt;
      node.lastUsedAt = data.lastUsedAt;
      node.lastValidatedAt = data.lastValidatedAt;
      node.successCount = data.successCount;
      node.failureCount = data.failureCount;
      node.confidence = data.confidence;
      node.supersededBy = data.supersededBy;
      node.supersedes = data.supersedes;
      node.version = data.version;
      node.evidenceChain = data.evidenceChain || [];

      this.store.set(node.id, node);
      this._indexNode(node);
    }
  }
}
