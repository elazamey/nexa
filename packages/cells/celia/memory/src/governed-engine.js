/**
 * NEXA Memory v0.5 — Governed Memory Engine (Unified)
 * 
 * Self-Evolving Agent OS — Memory State Machine + Procedural + Failure + Belief Revision + Forgetting + Ledger
 * 
 * Architecture:
 * NEXA MEMORY v0.5 ENGINE
 * ├── 1. Memory State Machine (PROPOSED → ACTIVE → WEAKENED → RETIRED)
 * ├── 2. Procedural Memory (Recipe-based Execution Re-use)
 * ├── 3. Failure Memory (Preemption & Error Prevention Rules)
 * ├── 4. Belief Revision (Immutable Revision Edges & Superseding)
 * ├── 5. Forgetting Engine (Utility Score-based Automatic Sweeping)
 * ├── 6. State-Aware Pre-Filtering (System Context Matching)
 * └── 7. Evidence-Bound Memory Ledger (Cryptographically Auditable)
 * 
 * No pgvector needed for core — local Map + JSONL/SQLite, vector DB optional future.
 */

import { MemoryState, MemoryType, MemoryNode } from './lifecycle.js';
import { NexaProceduralMemory } from './procedural-store.js';
import { BeliefRevisionEngine } from './belief-engine.js';
import { MemoryLedger, LedgerAction } from './memory-ledger.js';
import { generateEmbedding, cosineSimilarity, VECTOR_DIM } from './vector-store.js';

export { MemoryState, MemoryType, MemoryNode, LedgerAction, VECTOR_DIM };
export { NexaProceduralMemory, BeliefRevisionEngine, MemoryLedger };

export class NexaGovernedMemoryEngine {
  constructor({ maxNodes = 1000, maxLedger = 10000, ownerKid = null } = {}) {
    this.proceduralStore = new NexaProceduralMemory({ maxNodes });
    this.ledger = new MemoryLedger({ maxEntries: maxLedger });
    this.beliefEngine = new BeliefRevisionEngine(this.proceduralStore, this.ledger);

    this.ownerKid = ownerKid || 'nexa:governed:memory:v0.5';

    // Vector cache for optional semantic search (local, no Supabase needed)
    this.vectorCache = new Map(); // id → embedding

    // Telemetry
    this.createdAt = Date.now();
  }

  // === Procedural Memory ===

  async registerStrategy({ taskIntent, condition, strategyDAG, evidenceRef, confidence }) {
    const node = this.proceduralStore.registerStrategy({
      taskIntent,
      condition,
      strategyDAG,
      evidenceRef,
      ownerKid: this.ownerKid,
      confidence
    });

    // Generate embedding for semantic search
    try {
      const embedding = await generateEmbedding(taskIntent + ' ' + JSON.stringify(condition));
      this.vectorCache.set(node.id, embedding);
    } catch {}

    this.ledger.recordChange(LedgerAction.MEMORY_CREATED, node, evidenceRef, 'PROCEDURAL_REGISTER');
    this.ledger.recordChange(LedgerAction.MEMORY_VALIDATED, node, evidenceRef, 'PROCEDURAL_VALIDATE');

    return node;
  }

  async registerFailure({ failurePattern, cause, preventiveFix, contextState, evidenceRef }) {
    const node = this.proceduralStore.registerFailure({
      failurePattern,
      cause,
      preventiveFix,
      contextState,
      evidenceRef,
      ownerKid: this.ownerKid
    });

    try {
      const embedding = await generateEmbedding(failurePattern + ' ' + cause);
      this.vectorCache.set(node.id, embedding);
    } catch {}

    this.ledger.recordChange(LedgerAction.MEMORY_CREATED, node, evidenceRef, 'FAILURE_REGISTER');
    return node;
  }

  async registerBelief({ belief, condition, evidenceRef, confidence }) {
    const node = this.proceduralStore.registerBelief({
      belief,
      condition,
      evidenceRef,
      ownerKid: this.ownerKid,
      confidence
    });

    try {
      const embedding = await generateEmbedding(belief);
      this.vectorCache.set(node.id, embedding);
    } catch {}

    this.ledger.recordChange(LedgerAction.MEMORY_CREATED, node, evidenceRef, 'BELIEF_REGISTER');
    return node;
  }

  // === Recall — State-Aware + Utility + Vector ===

  recallRelevantKnowledge(taskIntent, currentSystemState = {}, options = {}) {
    const { includeVector = true, vectorThreshold = 0.15, limit = 12 } = options;

    // 1. State-aware procedural + failure recall
    const { preventions, strategies, beliefs } = this.proceduralStore.recallRelevantKnowledge(taskIntent, currentSystemState);

    // 2. Optional vector similarity boost (local, no Supabase)
    let vectorMatches = [];
    if (includeVector) {
      try {
        const queryEmbeddingPromise = generateEmbedding(taskIntent);
        // Synchronous fallback for now — we will compute async in separate method
        // For sync path, use existing cache
        vectorMatches = this._vectorSearchSync(taskIntent, vectorThreshold, limit);
      } catch {}
    }

    // Merge and deduplicate
    const allStrategies = [...strategies];
    for (const vm of vectorMatches) {
      if (!allStrategies.find(s => s.id === vm.id) && vm.type === 'procedural') {
        allStrategies.push(vm);
      }
    }

    this.ledger.recordRecall(taskIntent, { preventions, strategies: allStrategies, beliefs });

    return {
      preventions,
      strategies: allStrategies.slice(0, limit),
      beliefs,
      vectorMatches: vectorMatches.slice(0, limit),
      total: preventions.length + allStrategies.length + beliefs.length
    };
  }

  async recallWithEmbedding(taskIntent, currentSystemState = {}, options = {}) {
    const { threshold = 0.15, limit = 12 } = options;
    const queryEmbedding = await generateEmbedding(taskIntent);

    const scored = [];
    for (const [id, embedding] of this.vectorCache.entries()) {
      const node = this.proceduralStore.get(id);
      if (!node || node.isTerminal()) continue;

      const similarity = cosineSimilarity(queryEmbedding, embedding);
      if (similarity > threshold) {
        scored.push({
          id: node.id,
          type: node.type,
          state: node.state,
          content: node.content,
          similarity,
          utility: node.calculateUtility(currentSystemState),
          confidence: node.confidence
        });
      }
    }

    scored.sort((a, b) => {
      // Sort by utility * similarity
      const scoreA = a.utility * 0.6 + a.similarity * 0.4;
      const scoreB = b.utility * 0.6 + b.similarity * 0.4;
      return scoreB - scoreA;
    });

    return scored.slice(0, limit);
  }

  // === Belief Revision ===

  reviseBelief(oldId, newContent, evidenceRef) {
    return this.beliefEngine.reviseBelief(oldId, newContent, evidenceRef);
  }

  // === Forgetting Engine ===

  runForgettingSweep(threshold = 0.1, options = {}) {
    return this.beliefEngine.runForgettingSweep(threshold, options);
  }

  runWeakeningSweep(threshold = 0.4) {
    return this.beliefEngine.runWeakeningSweep(threshold);
  }

  pruneRetired(retentionDays = 7) {
    return this.beliefEngine.pruneRetired(retentionDays);
  }

  // === Success/Failure Tracking ===

  recordSuccess(id, evidenceRef = null) {
    const node = this.proceduralStore.recordSuccess(id, evidenceRef);
    if (node) {
      this.ledger.recordChange(LedgerAction.MEMORY_SUCCESS, node, evidenceRef, 'EXECUTOR');
    }
    return node;
  }

  recordFailure(id, evidenceRef = null, cause = null) {
    const node = this.proceduralStore.recordFailure(id, evidenceRef, cause);
    if (node) {
      this.ledger.recordChange(LedgerAction.MEMORY_FAILURE, node, evidenceRef, 'EXECUTOR');
    }
    return node;
  }

  // === Stats & Health ===

  getStats() {
    return {
      ...this.proceduralStore.getStats(),
      ledger: this.ledger.getStats(),
      revisions: this.beliefEngine.revisionHistory.length,
      vectorCache: this.vectorCache.size,
      uptime: Date.now() - this.createdAt
    };
  }

  getLedgerEntries(filter = {}) {
    return this.ledger.getEntries(filter);
  }

  verifyLedger() {
    return this.ledger.verifyChain();
  }

  listMemories(filter = {}) {
    return this.proceduralStore.list(filter);
  }

  getMemory(id) {
    return this.proceduralStore.get(id);
  }

  // === Persistence ===

  export() {
    return {
      memories: this.proceduralStore.export(),
      ledger: this.ledger.export(),
      revisions: this.beliefEngine.revisionHistory,
      vectorCache: [...this.vectorCache.entries()],
      ownerKid: this.ownerKid,
      createdAt: this.createdAt
    };
  }

  import(data) {
    if (data.memories) this.proceduralStore.import(data.memories);
    if (data.ledger) this.ledger.import(data.ledger);
    if (data.revisions) this.beliefEngine.revisionHistory = data.revisions;
    if (data.vectorCache) this.vectorCache = new Map(data.vectorCache);
    if (data.ownerKid) this.ownerKid = data.ownerKid;
  }

  // Internal: sync vector search using cached embeddings
  _vectorSearchSync(taskIntent, threshold, limit) {
    // Simple word overlap for sync path — more semantic than random
    const queryWords = new Set(taskIntent.toLowerCase().split(/[^a-z0-9_]+/).filter(w => w.length > 2));
    const scored = [];

    for (const node of this.proceduralStore.store.values()) {
      if (node.isTerminal()) continue;

      const contentStr = JSON.stringify(node.content).toLowerCase();
      const contentWords = contentStr.split(/[^a-z0-9_]+/).filter(w => w.length > 2);
      let overlap = 0;
      for (const w of contentWords) {
        if (queryWords.has(w)) overlap++;
      }

      const similarity = queryWords.size > 0 ? overlap / queryWords.size : 0;
      if (similarity > threshold) {
        scored.push({
          id: node.id,
          type: node.type,
          state: node.state,
          content: node.content,
          similarity,
          utility: node.calculateUtility(),
          confidence: node.confidence
        });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }
}
