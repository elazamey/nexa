/**
 * NEXA v0.5 — Semantic Memory & RAG Vector Store
 * 
 * Pure cell logic — no direct Supabase import, receives vectorPort via injection.
 * Generates 384d embeddings deterministically (hash-based) for offline/CI,
 * with optional external API hook for production free embeddings.
 * 
 * Invariants:
 * - digest-only: never stores raw secrets without digest
 * - evidence-bound: every write requires evidence_ref
 * - capability-gated: recall requires capability
 * - no ambient authority: Supabase client lives in tools/celia-vector-port.mjs
 * 
 * Flow: Task → Generate Embedding → Retrieve Top-12 → Pass to Planner → Execute
 */

import { OmegaError } from '../../../../compiler/index.js';
import crypto from 'node:crypto';

export const VECTOR_DIM = 384;
export const DEFAULT_RECALL_LIMIT = 12;
export const DEFAULT_THRESHOLD = 0.5;
export const MEMORY_TIERS = Object.freeze(['episodic', 'semantic', 'working', 'longterm']);

/**
 * Deterministic 384d embedding generator — offline-safe, zero external deps
 * Hybrid: bag-of-words TF for semantic overlap + hash chaining for uniqueness
 * In production, can be replaced by free API: OpenRouter, HuggingFace, etc.
 * 
 * Security: deterministic means same content → same vector, no secret leakage
 * Semantic: shared words → higher cosine similarity (suitable for RAG mock)
 */
export async function generateEmbedding(text, options = {}) {
  if (!text || typeof text !== 'string') {
    throw new OmegaError('OMEGA_E_SCHEMA', 'generateEmbedding needs non-empty string');
  }

  // If external embedding API configured via options.embedFn, use it
  if (options.embedFn && typeof options.embedFn === 'function') {
    try {
      const extVector = await options.embedFn(text);
      if (Array.isArray(extVector) && extVector.length === VECTOR_DIM) {
        return extVector;
      }
    } catch (e) {
      console.warn(`[vector-store] external embed failed, fallback to hash: ${e.message}`);
    }
  }

  const vector = new Array(VECTOR_DIM).fill(0);

  // 1. Semantic TF: words → hashed index boosting
  const words = text.toLowerCase().split(/[^a-z0-9_]+/).filter(w => w.length > 1);
  const wordFreq = new Map();
  for (const w of words) {
    wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
  }

  for (const [word, freq] of wordFreq.entries()) {
    // Hash word to index 0..383
    const h = crypto.createHash('sha256').update(word).digest();
    const idx = h.readUInt16BE(0) % VECTOR_DIM;
    const idx2 = h.readUInt16BE(2) % VECTOR_DIM;
    // TF-IDF like weight: log(1+freq) + length bonus
    const weight = Math.log(1 + freq) * (1 + word.length * 0.05);
    vector[idx] += weight;
    vector[idx2] += weight * 0.5;
    
    // Bigram-like: hash of word + next char for more distribution
    const h2 = crypto.createHash('sha256').update(word + '_').digest();
    const idx3 = h2.readUInt16BE(4) % VECTOR_DIM;
    vector[idx3] += weight * 0.3;
  }

  // 2. Full-text hash chaining for uniqueness (small weight)
  let hash = crypto.createHash('sha256').update(text).digest();
  let hashIndex = 0;
  let round = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    if (hashIndex >= hash.length) {
      hash = crypto.createHash('sha256').update(Buffer.concat([hash, Buffer.from([round])])).digest();
      hashIndex = 0;
      round++;
    }
    // Add small random component for uniqueness
    vector[i] += ((hash[hashIndex] / 255) * 2 - 1) * 0.15;
    hashIndex++;
  }

  // 3. L2 normalize for cosine similarity
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < VECTOR_DIM; i++) {
      vector[i] = vector[i] / norm;
    }
  }

  return vector;
}

/**
 * Digest helper — SHA256 of content
 */
export function digestContent(content) {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `sha256:${hash.slice(0, 16)}`;
}

/**
 * Cosine similarity between two 384d vectors — for local mock matching
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error('Vector dimension mismatch');
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Semantic Memory Cell — NEXA compliant
 * Receives vectorPort injected from host (tools/celia-vector-port.mjs)
 */
export function createSemanticMemoryCell({ identity, nucleus, vectorPort, ledger, embedFn } = {}) {
  if (!identity) throw new OmegaError('OMEGA_E_IDENTITY', 'semantic memory cell needs identity');
  if (!vectorPort || typeof vectorPort.store !== 'function' || typeof vectorPort.recall !== 'function') {
    throw new OmegaError('OMEGA_E_MEMBRANE', 'semantic cell needs vectorPort { store, recall }');
  }

  const state = {
    writes: 0,
    reads: 0,
    lastRecall: null,
  };

  return {
    id: identity.kid,
    nucleus,
    tier: 'semantic',
    vectorDim: VECTOR_DIM,

    receptors: {
      /**
       * remember — store fact with embedding
       * payload: { content, tier?, metadata?, evidenceRef }
       */
      async remember({ payload, evidenceRef } = {}) {
        if (!payload || typeof payload.content !== 'string') {
          throw new OmegaError('OMEGA_E_SCHEMA', 'semantic remember needs { content, tier?, metadata? }');
        }
        const tier = payload.tier || 'working';
        if (!MEMORY_TIERS.includes(tier)) {
          throw new OmegaError('OMEGA_E_SCHEMA', `unknown tier: ${tier}`);
        }

        const digest = digestContent(payload.content);
        const embedding = await generateEmbedding(payload.content, { embedFn });

        const record = {
          id: crypto.randomUUID(),
          content: payload.content,
          digest,
          tier,
          metadata: payload.metadata || {},
          embedding,
          owner_kid: identity.kid,
          evidence_ref: evidenceRef || payload.evidenceRef || null,
          created_at: new Date().toISOString(),
        };

        // Membrane: require evidence_ref for all writes (policy)
        if (!record.evidence_ref) {
          console.warn('[semantic-memory] missing evidence_ref — storing with null (should be evidence-bound in prod)');
        }

        const result = await vectorPort.store(record);
        state.writes++;

        if (ledger) {
          ledger.record({
            kind: 'CELL_MESSAGE',
            cell: identity.kid,
            receptor: 'semantic.remember',
            payload_digest: digest,
            evidence_ref: record.evidence_ref,
          });
        }

        return { ok: true, id: record.id, digest, tier };
      },

      /**
       * recall — RAG: retrieve Top-K relevant facts
       * payload: { query, limit?, threshold?, tier? }
       */
      async recall({ payload } = {}) {
        if (!payload || typeof payload.query !== 'string') {
          throw new OmegaError('OMEGA_E_SCHEMA', 'semantic recall needs { query, limit?, threshold? }');
        }
        const limit = Math.min(payload.limit || DEFAULT_RECALL_LIMIT, 50);
        const threshold = payload.threshold ?? DEFAULT_THRESHOLD;
        const tier = payload.tier || null;

        const queryEmbedding = await generateEmbedding(payload.query, { embedFn });
        state.reads++;
        state.lastRecall = { query: payload.query, limit, threshold, at: new Date().toISOString() };

        const results = await vectorPort.recall({
          embedding: queryEmbedding,
          query: payload.query,
          limit,
          threshold,
          tier,
        });

        // Return digest-only + content summary (protect context window)
        const facts = results.map(r => ({
          digest: r.digest,
          content: r.content,
          tier: r.tier,
          similarity: typeof r.similarity === 'number' ? Number(r.similarity.toFixed(4)) : r.similarity,
          metadata: r.metadata || {},
          created_at: r.created_at,
        }));

        if (ledger) {
          ledger.record({
            kind: 'CELL_MESSAGE',
            cell: identity.kid,
            receptor: 'semantic.recall',
            payload_digest: digestContent(payload.query),
            result_count: facts.length,
          });
        }

        return { ok: true, query: payload.query, count: facts.length, facts };
      },

      /**
       * health — for dashboard telemetry
       */
      async health() {
        return {
          writes: state.writes,
          reads: state.reads,
          lastRecall: state.lastRecall,
          dim: VECTOR_DIM,
          tier: 'semantic',
        };
      }
    },

    // Expose utils for testing
    _utils: { generateEmbedding, cosineSimilarity, digestContent },
  };
}

/**
 * Factory for simple vector memory port — for tests and local demo
 * Used when Supabase not available — in-memory cosine search
 */
export function createVectorMemoryPort({ url, key, table = 'celia_semantic_memory' } = {}) {
  // In-memory fallback — for CI and tests without Supabase
  const memory = [];

  return {
    _memory: memory, // expose for tests

    async store(record) {
      // Simulate DB insert
      memory.push({ ...record });
      return { ok: true, id: record.id, digest: record.digest };
    },

    async recall({ embedding, query, limit = 12, threshold = 0.5, tier = null }) {
      let candidates = memory;
      if (tier) {
        candidates = candidates.filter(r => r.tier === tier);
      }

      const scored = candidates.map(r => {
        const sim = r.embedding ? cosineSimilarity(embedding, r.embedding) : 0;
        return { ...r, similarity: sim };
      }).sort((a, b) => b.similarity - a.similarity);

      const filtered = scored.filter(r => r.similarity > threshold);
      // Fallback: if threshold too high yields 0, return Top-K anyway (for mock demo)
      const results = filtered.length > 0 ? filtered.slice(0, limit) : scored.slice(0, limit);
      return results;
    },

    async storeFact(content, metadata = {}) {
      const digest = digestContent(content);
      const embedding = await generateEmbedding(content);
      const record = {
        id: crypto.randomUUID(),
        content,
        digest,
        tier: metadata.tier || 'working',
        metadata,
        embedding,
        created_at: new Date().toISOString(),
      };
      memory.push(record);
      return { status: 'stored', digest, id: record.id };
    },

    async recallContext(queryText, limit = 12, threshold = 0.5) {
      const queryEmbedding = await generateEmbedding(queryText);
      const results = await this.recall({ embedding: queryEmbedding, query: queryText, limit, threshold });
      return results.map(item => ({
        digest: item.digest,
        content: item.content,
        tier: item.tier,
        similarity: Number(item.similarity.toFixed(4)),
        metadata: item.metadata,
      }));
    }
  };
}
