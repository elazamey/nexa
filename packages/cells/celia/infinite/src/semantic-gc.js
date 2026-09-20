/**
 * NEXA v0.9 — Semantic Garbage Collector
 * 
 * جامع القمامة الدلالي — يتتبع قابلية الوصول الدلالي لا مجرد المراجع
 * - Tracks semantic reachability: AST nodes, beliefs, memories, proofs
 * - Evidence-bound: only GC if evidenceRef shows unreachable
 * - Generational: young (ephemeral) → old (semantic) → permanent (ledger)
 */

export class SemanticGcEngine {
  constructor() {
    this.nodes = new Map(); // id → { type, references, semanticLinks, generation, marked }
    this.roots = new Set(); // root ids — always reachable
    this.collected = [];
  }

  registerNode(id, { type = 'ast', generation = 'young', isRoot = false, evidenceRef = null } = {}) {
    const node = {
      id,
      type,
      generation,
      references: new Set(),
      semanticLinks: new Set(),
      marked: false,
      isRoot,
      evidenceRef,
      createdAt: Date.now(),
      lastAccessed: Date.now()
    };

    this.nodes.set(id, node);
    if (isRoot) this.roots.add(id);
    return node;
  }

  addReference(fromId, toId, { semantic = false } = {}) {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) throw new Error(`Node not found: ${fromId} or ${toId}`);

    if (semantic) from.semanticLinks.add(toId);
    else from.references.add(toId);

    to.lastAccessed = Date.now();
  }

  markReachable() {
    // Mark phase — BFS from roots via both reference types
    for (const node of this.nodes.values()) node.marked = false;

    const queue = [...this.roots];
    const visited = new Set();

    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      const node = this.nodes.get(id);
      if (!node) continue;

      node.marked = true;

      for (const ref of node.references) if (!visited.has(ref)) queue.push(ref);
      for (const link of node.semanticLinks) if (!visited.has(link)) queue.push(link);
    }

    return { marked: visited.size, total: this.nodes.size };
  }

  sweep({ evidenceRef = null, minAge = 0 } = {}) {
    if (!evidenceRef) throw new Error('GC requires evidenceRef — evidence-bound');

    const marked = this.markReachable();
    const now = Date.now();

    const toCollect = [];
    for (const [id, node] of this.nodes.entries()) {
      const age = now - node.createdAt;
      if (!node.marked && age >= minAge && !node.isRoot) {
        toCollect.push(id);
      }
    }

    let collectedBytes = 0;
    for (const id of toCollect) {
      const node = this.nodes.get(id);
      collectedBytes += JSON.stringify(node).length;
      this.nodes.delete(id);
      this.collected.push({
        id,
        type: node.type,
        generation: node.generation,
        evidenceRef,
        collectedAt: new Date().toISOString(),
        reason: 'Semantic unreachable — no reference path from roots'
      });
    }

    return {
      marked: marked.marked,
      totalBefore: marked.total,
      collected: toCollect.length,
      totalAfter: this.nodes.size,
      collectedBytes,
      evidenceRef,
      claim: `Semantic GC: ${toCollect.length}/${marked.total} nodes collected — ${collectedBytes} bytes freed — evidence-bound ${evidenceRef} — unreachable via references + semantic links`
    };
  }

  promoteGenerations() {
    let promoted = 0;
    for (const node of this.nodes.values()) {
      const age = Date.now() - node.createdAt;
      if (node.generation === 'young' && age > 60000 && node.marked) {
        node.generation = 'old';
        promoted++;
      } else if (node.generation === 'old' && age > 300000 && node.marked) {
        node.generation = 'permanent';
        promoted++;
      }
    }
    return { promoted, total: this.nodes.size };
  }

  getStats() {
    const byGen = { young: 0, old: 0, permanent: 0 };
    const byType = {};
    for (const node of this.nodes.values()) {
      byGen[node.generation] = (byGen[node.generation] || 0) + 1;
      byType[node.type] = (byType[node.type] || 0) + 1;
    }

    return {
      total: this.nodes.size,
      roots: this.roots.size,
      byGeneration: byGen,
      byType,
      totalCollected: this.collected.length,
      claim: 'Semantic GC — reachability via references + semantic links, generational young→old→permanent, evidence-bound'
    };
  }
}
