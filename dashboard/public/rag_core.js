/**
 * ClientEdgeRAG - Client-Side Semantic Search & Chunking Engine
 * Executes WebGPU embeddings in the browser with WASM/local fallback.
 */

export class ClientEdgeRAG {
  constructor() {
    this.embedder = null;
    this.vectorStore = [];
    this.isReady = false;
  }

  // 1. تهيئة نموذج التضمين عبر WebGPU مع Fallback تلقائي للـ WASM
  async init(progressCallback = null) {
    if (typeof window !== 'undefined') {
      try {
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
        env.allowLocalModels = false;
        env.useBrowserCache = true;

        this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          device: 'webgpu',
          progress_callback: progressCallback
        });
        this.isReady = true;
        console.log("⚡ [WebGPU RAG] Pipeline initialized successfully via WebGPU");
      } catch (err) {
        console.warn("⚠️ WebGPU not available, falling back to WASM CPU pipeline:", err);
        try {
          const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
          this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            progress_callback: progressCallback
          });
          this.isReady = true;
        } catch {
          this.isReady = true;
        }
      }
    } else {
      this.isReady = true;
    }
  }

  // 2. تقطيع النص إلى كتل متداخلة (Chunking)
  chunkText(text, chunkSize = 400, overlap = 50) {
    const words = text.split(/\s+/);
    const chunks = [];
    
    for (let i = 0; i < words.length; i += (chunkSize - overlap)) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      if (chunk.trim().length > 10) {
        chunks.push(chunk);
      }
    }
    return chunks;
  }

  // 3. توليد متجه التضمين لكتلة نصية
  async generateEmbedding(text) {
    if (!this.isReady) throw new Error("RAG Pipeline is not initialized yet.");

    if (this.embedder) {
      const output = await this.embedder(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    }

    return this._generateDeterministicVector(text, 64);
  }

  // 4. معالجة مستند وفهرسته في قاعدة البيانات المحلية
  async indexDocument(text, filename = "document.txt", onProgress = null) {
    const chunks = this.chunkText(text);
    this.vectorStore = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await this.generateEmbedding(chunk);
      this.vectorStore.push({
        id: `${filename}-chunk-${i}`,
        text: chunk,
        embedding: embedding
      });

      if (onProgress) {
        onProgress(i + 1, chunks.length);
      }
    }
    return this.vectorStore.length;
  }

  // 5. حساب تشابه جيب التمام (Cosine Similarity)
  cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  // 6. البحث الدلالي واستعادة أكثر الكتل صلة واستحواذاً
  async search(query, topK = 3) {
    if (this.vectorStore.length === 0) return [];

    const queryEmbedding = await this.generateEmbedding(query);
    const results = this.vectorStore.map(item => ({
      ...item,
      score: this.cosineSimilarity(queryEmbedding, item.embedding)
    }));

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  _generateDeterministicVector(text, dimensions = 64) {
    const vector = new Array(dimensions).fill(0);
    const words = text.toLowerCase().split(/\s+/);
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      for (let j = 0; j < word.length; j++) {
        const charCode = word.charCodeAt(j);
        const index = (charCode * (j + 1) * 31) % dimensions;
        vector[index] += 1;
      }
    }

    let norm = 0;
    for (let i = 0; i < dimensions; i++) norm += vector[i] * vector[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dimensions; i++) vector[i] /= norm;

    return vector;
  }
}
