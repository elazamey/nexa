import crypto from 'node:crypto';

/**
 * MemoryMesh - 4-Tier Memory & Temporal Knowledge Graph
 * Unifies Working, Episodic, Semantic, and Procedural memory with Graphiti-style temporal relations.
 */
export class MemoryMesh {
  constructor() {
    this.workingMemory = new Map();
    this.episodicMemory = [];
    this.semanticMemory = new Map();
    this.proceduralMemory = new Map();
    this.temporalKnowledgeGraph = {
      nodes: new Map(),
      edges: []
    };
  }

  /**
   * Sets a temporary value in short-term Working Memory
   */
  setWorking(key, value) {
    this.workingMemory.set(key, {
      value,
      updatedAt: new Date().toISOString()
    });
  }

  getWorking(key) {
    return this.workingMemory.get(key)?.value ?? null;
  }

  /**
   * Records an execution episode with state before/after, action taken, and outcome
   */
  recordEpisode(episode) {
    const record = {
      id: `ep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      action: episode.action,
      intent: episode.intent,
      result: episode.result,
      provenance: episode.provenance || 'agent_execution',
      digest: crypto.createHash('sha256').update(JSON.stringify(episode)).digest('hex')
    };
    this.episodicMemory.push(record);
    return record;
  }

  /**
   * Adds a factual knowledge node to the Temporal Knowledge Graph
   */
  addKnowledgeNode(entityId, entityType, attributes = {}, validFrom = null) {
    const node = {
      id: entityId,
      type: entityType,
      attributes,
      validFrom: validFrom || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.temporalKnowledgeGraph.nodes.set(entityId, node);
    return node;
  }

  /**
   * Adds a temporal relation edge between two entities (e.g. Entity A -> 'CALLS' -> Entity B at time T)
   */
  addTemporalRelation(sourceId, relation, targetId, metadata = {}) {
    const edge = {
      id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      source: sourceId,
      relation,
      target: targetId,
      timestamp: new Date().toISOString(),
      metadata
    };
    this.temporalKnowledgeGraph.edges.push(edge);
    return edge;
  }

  /**
   * Adds a verified procedural recipe (skill / tool flow)
   */
  registerProcedure(procedureName, steps = [], preconditions = {}) {
    this.proceduralMemory.set(procedureName, {
      name: procedureName,
      steps,
      preconditions,
      verifiedAt: new Date().toISOString()
    });
  }

  /**
   * Queries the temporal knowledge graph around an entity
   */
  queryEntityHistory(entityId) {
    const node = this.temporalKnowledgeGraph.nodes.get(entityId);
    const incoming = this.temporalKnowledgeGraph.edges.filter(e => e.target === entityId);
    const outgoing = this.temporalKnowledgeGraph.edges.filter(e => e.source === entityId);

    return {
      entity: node || null,
      timeline: [...incoming, ...outgoing].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    };
  }
}
