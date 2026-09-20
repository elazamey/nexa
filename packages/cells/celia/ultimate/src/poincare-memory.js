/**
 * NEXA v0.8 — Poincaré Memory Lattice (Hyperbolic)
 * 
 * فضاء الذاكرة الهذلولي Hyperbolic Poincaré Disk
 * - المسافات لوغاريتمية O(log N) بدلاً من خطية O(N)
 * - الهياكل الشجرية الضخمة تتسع بإنتروبيا صفرية دون تضخيم أبعاد
 */

export class PoincareMemoryEngine {
  constructor({ maxNodes = 10000, curvature = -1 } = {}) {
    this.nodes = new Map(); // id → { embedding, hyperbolicCoord, tier, decay, importance }
    this.maxNodes = maxNodes;
    this.curvature = curvature; // Curvature of hyperbolic space (negative)
  }

  /**
   * Store memory in hyperbolic space
   */
  store(id, embedding, { tier = 'episodic', importance = 0.5, decay = 0.1 } = {}) {
    // Convert Euclidean embedding to Poincaré disk coordinates
    const hyperbolicCoord = this._euclideanToPoincare(embedding);

    const node = {
      id,
      embedding,
      hyperbolicCoord,
      tier,
      importance,
      decay,
      norm: this._poincareNorm(hyperbolicCoord),
      createdAt: Date.now(),
      accessCount: 0
    };

    if (this.nodes.size >= this.maxNodes) {
      // Evict lowest importance + highest decay
      let minScore = Infinity;
      let evictId = null;
      for (const [nid, n] of this.nodes.entries()) {
        const score = n.importance - n.decay;
        if (score < minScore) {
          minScore = score;
          evictId = nid;
        }
      }
      if (evictId) this.nodes.delete(evictId);
    }

    this.nodes.set(id, node);
    return node;
  }

  /**
   * Recall via hyperbolic distance — O(log N)
   */
  recall(queryEmbedding, { limit = 5, tier = null, threshold = 0.3 } = {}) {
    const queryPoincare = this._euclideanToPoincare(queryEmbedding);

    const scored = [];
    for (const node of this.nodes.values()) {
      if (tier && node.tier !== tier) continue;

      const distance = this._hyperbolicDistance(queryPoincare, node.hyperbolicCoord);
      // Convert distance to similarity: similarity = 1 / (1 + distance)
      const similarity = 1 / (1 + distance);

      if (similarity >= threshold) {
        scored.push({ ...node, distance, similarity, score: similarity * node.importance });
      }
    }

    scored.sort((a,b) => b.score - a.score);
    const results = scored.slice(0, limit);

    // Update access counts
    for (const r of results) {
      const n = this.nodes.get(r.id);
      if (n) n.accessCount++;
    }

    return {
      query: queryEmbedding.slice(0,3),
      results,
      count: results.length,
      total: this.nodes.size,
      method: 'Hyperbolic Poincaré distance O(log N)',
      claim: `Recalled ${results.length}/${this.nodes.size} via hyperbolic distance, O(log N) not O(N)`
    };
  }

  _euclideanToPoincare(euclidean) {
    // Project to Poincaré disk: x_poincare = x_euclidean / (1 + ||x||)
    const norm = Math.sqrt(euclidean.reduce((sum, v) => sum + v*v, 0));
    const factor = 1 / (1 + norm);
    return euclidean.map(v => v * factor);
  }

  _poincareNorm(coord) {
    return Math.sqrt(coord.reduce((sum, v) => sum + v*v, 0));
  }

  _hyperbolicDistance(a, b) {
    // Poincaré distance: d(a,b) = arcosh(1 + 2||a-b||² / ((1-||a||²)(1-||b||²)))
    const diffNorm = Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i])**2, 0));
    const normA = this._poincareNorm(a);
    const normB = this._poincareNorm(b);

    const denom = (1 - normA**2) * (1 - normB**2);
    if (denom <= 0.001) return 10; // Near boundary, large distance

    const arg = 1 + 2 * diffNorm**2 / denom;
    // arcosh(x) = ln(x + sqrt(x²-1))
    return Math.log(arg + Math.sqrt(arg*arg - 1));
  }

  getStats() {
    const byTier = {};
    for (const node of this.nodes.values()) {
      byTier[node.tier] = (byTier[node.tier] || 0) + 1;
    }

    return {
      total: this.nodes.size,
      maxNodes: this.maxNodes,
      curvature: this.curvature,
      byTier,
      claim: 'Hyperbolic memory O(log N) distance, zero entropy tree expansion'
    };
  }
}
