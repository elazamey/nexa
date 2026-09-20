/**
 * NEXA OS v0.6 — Adaptive DAG Engine with Dynamic Node Injection
 * 
 * DAG that mutates in real-time. If Node_3 fails, inject 3a,3b,3c without affecting completed nodes.
 * 
 * [Node1: Inspect] → [Node2: Build] → [Node3: Test (Failed)]
 *                                    → [3a: Parse Error] → [3b: AST Patch] → [3c: Re-test] → [Node4: Deploy]
 */

export const DagNodeStatus = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  INJECTED: 'INJECTED'
});

export class AdaptiveDagEngine {
  constructor({ maxDepth = 5, maxInjections = 20, maxNodes = 100 } = {}) {
    this.dag = {
      id: `dag_${Date.now().toString(36)}`,
      nodes: [],
      edges: [],
      version: 1,
      createdAt: Date.now()
    };

    this.maxDepth = maxDepth;
    this.maxInjections = maxInjections;
    this.maxNodes = maxNodes;

    this.injectionCount = 0;
    this.injectionHistory = [];
  }

  /**
   * Initialize DAG from static definition
   */
  initialize(nodes, edges = []) {
    this.dag.nodes = nodes.map(n => ({
      ...n,
      status: DagNodeStatus.PENDING,
      retries: 0,
      injectedFrom: null,
      depth: 0,
      createdAt: Date.now()
    }));
    this.dag.edges = edges;
    this.dag.version = 1;
    this.injectionCount = 0;
    this.injectionHistory = [];
    return this.dag;
  }

  /**
   * Inject new nodes after failed node
   */
  injectNodes(failedNodeId, newNodes, evidenceRef = null) {
    const failedNode = this.dag.nodes.find(n => n.id === failedNodeId);
    if (!failedNode) throw new Error(`Failed node not found: ${failedNodeId}`);
    if (failedNode.status !== DagNodeStatus.FAILED) {
      throw new Error(`Can only inject after FAILED node, got ${failedNode.status}`);
    }

    if (this.injectionCount >= this.maxInjections) {
      throw new Error(`Max injections exceeded: ${this.maxInjections}`);
    }

    if (failedNode.depth >= this.maxDepth) {
      throw new Error(`Max depth exceeded for node ${failedNodeId}: depth ${failedNode.depth} >= max ${this.maxDepth}`);
    }

    if (this.dag.nodes.length + newNodes.length > this.maxNodes) {
      throw new Error(`Max nodes exceeded: ${this.dag.nodes.length} + ${newNodes.length} > ${this.maxNodes}`);
    }

    const injected = [];
    let prevId = failedNodeId;

    for (let i = 0; i < newNodes.length; i++) {
      const def = newNodes[i];
      // Generate id like 3a, 3b, 3c or failedNodeId_a, etc.
      const suffix = def.suffix || String.fromCharCode(97 + i); // a, b, c
      const newId = def.id || `${failedNodeId}_${suffix}`;

      if (this.dag.nodes.find(n => n.id === newId)) {
        throw new Error(`Node id already exists: ${newId}`);
      }

      const newNode = {
        id: newId,
        suffix,
        originalId: def.originalId || def.id,
        taskIntent: def.taskIntent || def.id,
        tool: def.tool || failedNode.tool,
        kind: def.kind || 'recovery',
        status: DagNodeStatus.INJECTED,
        retries: 0,
        injectedFrom: failedNodeId,
        depth: failedNode.depth + 1,
        evidenceRef: evidenceRef || def.evidenceRef || null,
        createdAt: Date.now(),
        ...def,
        id: newId // Ensure id not overwritten
      };

      this.dag.nodes.push(newNode);
      injected.push(newNode);

      // Add edge from prev to new
      this.dag.edges.push({
        from: prevId,
        to: newId,
        type: 'recovery',
        evidenceRef
      });

      prevId = newId;
    }

    // Rewire original outgoing edges from failed node to last injected node
    const outgoing = this.dag.edges.filter(e => e.from === failedNodeId && e.type !== 'recovery');
    for (const edge of outgoing) {
      // Change from failedNodeId → to to lastInjected → to
      if (injected.length > 0) {
        this.dag.edges.push({
          from: injected[injected.length - 1].id,
          to: edge.to,
          type: 'rewired',
          originalFrom: failedNodeId,
          evidenceRef
        });
      }
    }

    // Remove original outgoing edges from failed node (they are now rewired)
    this.dag.edges = this.dag.edges.filter(e => !(e.from === failedNodeId && e.type !== 'recovery' && outgoing.includes(e)));

    this.dag.version++;
    this.injectionCount += injected.length;

    const injectionRecord = {
      failedNodeId,
      injectedIds: injected.map(n => n.id),
      injected,
      evidenceRef,
      version: this.dag.version,
      timestamp: new Date().toISOString()
    };

    this.injectionHistory.push(injectionRecord);

    return {
      dag: this.dag,
      injected,
      injection: injectionRecord
    };
  }

  /**
   * Get nodes that are ready to execute (deps SUCCESS)
   */
  getExecutableNodes() {
    const nodeMap = new Map(this.dag.nodes.map(n => [n.id, n]));

    return this.dag.nodes.filter(node => {
      if (node.status !== DagNodeStatus.PENDING && node.status !== DagNodeStatus.INJECTED) return false;

      // Find incoming edges
      const incoming = this.dag.edges.filter(e => e.to === node.id);
      if (incoming.length === 0) return true; // No deps, executable

      // All deps must be SUCCESS
      return incoming.every(edge => {
        const dep = nodeMap.get(edge.from);
        return dep && dep.status === DagNodeStatus.SUCCESS;
      });
    });
  }

  /**
   * Get failed nodes that haven't been handled yet
   */
  getFailedNodes() {
    return this.dag.nodes.filter(n => n.status === DagNodeStatus.FAILED && !n.handled);
  }

  /**
   * Check if should inject recovery nodes for failed node
   */
  shouldInject(failedNode) {
    if (!failedNode) return false;
    if (failedNode.critical) return false; // Critical nodes stop DAG
    if (failedNode.retries >= 2) return false; // Max retries
    if (failedNode.depth >= this.maxDepth) return false;
    if (this.injectionCount >= this.maxInjections) return false;
    if (failedNode.injectedFrom) {
      // Already injected — check depth of chain
      const chainLength = this._getInjectionChainLength(failedNode.id);
      if (chainLength >= 3) return false; // Max 3 recovery attempts per branch
    }
    return true;
  }

  /**
   * Mark node as handled (injection attempted)
   */
  markHandled(nodeId) {
    const node = this.dag.nodes.find(n => n.id === nodeId);
    if (node) node.handled = true;
  }

  /**
   * Update node status
   */
  updateNodeStatus(nodeId, status, evidenceRef = null) {
    const node = this.dag.nodes.find(n => n.id === nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    node.status = status;
    if (evidenceRef) node.evidenceRef = evidenceRef;
    node.updatedAt = Date.now();
    return node;
  }

  /**
   * Generate recovery nodes from error — parses error log
   */
  generateRecoveryNodes(failedNode, error) {
    const errorStr = (error?.message || error || '').toString().toLowerCase();

    const nodes = [];

    // Always first: parse error log
    nodes.push({
      suffix: 'a',
      taskIntent: `parse error log for ${failedNode.id}`,
      tool: 'fs.read',
      kind: 'recovery_parse',
      originalId: `${failedNode.id}_parse`,
      error: errorStr.slice(0, 200)
    });

    // Second: based on error type, generate fix
    if (errorStr.includes('syntax') || errorStr.includes('parse') || errorStr.includes('unexpected token')) {
      nodes.push({
        suffix: 'b',
        taskIntent: `apply AST patch for ${failedNode.id} syntax error`,
        tool: 'ast.patch',
        kind: 'recovery_fix',
        fixType: 'syntax'
      });
    } else if (errorStr.includes('test') || errorStr.includes('fail') || errorStr.includes('assert')) {
      nodes.push({
        suffix: 'b',
        taskIntent: `fix failing test in ${failedNode.id}`,
        tool: 'ast.patch',
        kind: 'recovery_fix',
        fixType: 'test'
      });
    } else if (errorStr.includes('not found') || errorStr.includes('cannot find')) {
      nodes.push({
        suffix: 'b',
        taskIntent: `resolve missing dependency for ${failedNode.id}`,
        tool: 'fs.read',
        kind: 'recovery_fix',
        fixType: 'dependency'
      });
    } else {
      nodes.push({
        suffix: 'b',
        taskIntent: `apply generic fix for ${failedNode.id}`,
        tool: 'fs.read',
        kind: 'recovery_fix',
        fixType: 'generic'
      });
    }

    // Third: re-run failed node
    nodes.push({
      suffix: 'c',
      taskIntent: `re-run ${failedNode.id} after fix`,
      tool: failedNode.tool,
      kind: 'recovery_verify',
      originalId: failedNode.id,
      isRetry: true
    });

    return nodes;
  }

  /**
   * Get DAG stats
   */
  getStats() {
    const byStatus = {};
    const byDepth = {};
    let maxDepth = 0;

    for (const node of this.dag.nodes) {
      byStatus[node.status] = (byStatus[node.status] || 0) + 1;
      byDepth[node.depth] = (byDepth[node.depth] || 0) + 1;
      if (node.depth > maxDepth) maxDepth = node.depth;
    }

    return {
      total: this.dag.nodes.length,
      edges: this.dag.edges.length,
      version: this.dag.version,
      maxDepth,
      injectionCount: this.injectionCount,
      byStatus,
      byDepth,
      injections: this.injectionHistory.length
    };
  }

  _getInjectionChainLength(nodeId) {
    let length = 0;
    let currentId = nodeId;
    while (currentId) {
      const node = this.dag.nodes.find(n => n.id === currentId);
      if (!node || !node.injectedFrom) break;
      length++;
      currentId = node.injectedFrom;
    }
    return length;
  }

  export() {
    return {
      dag: this.dag,
      injectionCount: this.injectionCount,
      injectionHistory: this.injectionHistory,
      maxDepth: this.maxDepth,
      maxInjections: this.maxInjections
    };
  }

  import(data) {
    this.dag = data.dag;
    this.injectionCount = data.injectionCount;
    this.injectionHistory = data.injectionHistory;
    this.maxDepth = data.maxDepth;
    this.maxInjections = data.maxInjections;
  }
}
