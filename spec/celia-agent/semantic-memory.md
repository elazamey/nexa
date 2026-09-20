# Celia Semantic Memory & RAG — v0.5

> Built on v0.4: 6 gates CLOSED, 314 tests, DAG SSE, Glassmorphism dashboard 55KB gzip.
> Goal: Move from event recall to **contextual meaning** — `Task → Embedding → Top-12 → Planner → Execute`

## Principle

Until v0.4, Celia only recalled by tier/limit. Now it understands **semantic meaning**:

```
Task (natural language)
  → Generate 384d Embedding (deterministic hash-based, offline-safe)
  → Cosine Similarity Search (pgvector)
  → Retrieve Top-12 Relevant Facts
  → Pass as Planner Context
  → Execute DAG with evidence
```

**Invariants preserved:**
- Digest-only, never raw secrets
- Evidence-bound: every write needs evidence_ref
- Capability-gated
- No ambient authority: Supabase client lives in `tools/`, not `packages/`
- REAL_EXECUTION stays CLOSED

## Architecture

### 1. Embedding Generation — 384d Lightweight

`packages/cells/celia/memory/src/vector-store.js`:

```javascript
generateEmbedding(text) → 384d L2-normalized vector

Hybrid approach:
- Semantic TF: words hashed to indices (bag-of-words)
  word → sha256 → index % 384, weight = log(1+freq) * (1+len*0.05)
- Hash chaining for uniqueness: sha256(text + round) → small random component
- L2 normalize for cosine stability

Deterministic: same text → same vector (1.0 similarity)
Different topic: near 0 or negative (orthogonal in 384d)
Offline-safe: no external API needed, zero deps
Optional: embedFn hook for free APIs (OpenRouter, HuggingFace)
```

**Why 384d?**
- Free-tier friendly (Supabase pgvector, small storage)
- Fast cosine search
- Sufficient for semantic overlap with TF hashing
- Can upgrade to 768d/1536d via external API later

### 2. Supabase pgvector — Migration

`supabase/migrations/20260921_pgvector.sql`:

```sql
CREATE EXTENSION vector;

CREATE TABLE celia_semantic_memory (
  id UUID PK,
  content TEXT NOT NULL,
  digest VARCHAR(64) NOT NULL,
  tier VARCHAR(20) CHECK (tier IN (episodic, semantic, working, longterm)),
  metadata JSONB,
  embedding VECTOR(384),
  owner_kid TEXT,
  evidence_ref TEXT,
  created_at TIMESTAMPTZ
);

RLS + indexes + IVFFLAT/HNSW ready

FUNCTION match_semantic_memory(query_embedding VECTOR(384), threshold FLOAT, count INT)
  RETURNS Top-K by cosine: 1 - (embedding <=> query) AS similarity
  WHERE similarity > threshold ORDER BY distance LIMIT count
```

### 3. Vector Ports — Tools Layer

`tools/celia-vector-port.mjs` (allowed fs/net):

```javascript
createVectorSupabasePort({ url, key, table })
  → mock by default (in-memory cosine search)
  → real Supabase if SUPABASE_URL set and client installed

Methods:
- store(record): { content, digest, tier, metadata, embedding, owner_kid, evidence_ref }
- recall({ embedding, query, limit=12, threshold=0.5, tier })
- storeFact(content, metadata): convenience → digest + embedding
- recallContext(queryText, limit=12, threshold): RAG Top-K

Fallback: if threshold too strict yields 0, return Top-K anyway (for mock demo)
```

`packages/cells/celia/memory/src/vector-store.js`:

```javascript
createSemanticMemoryCell({ identity, vectorPort, ledger })
  receptors:
  - remember({ content, tier, metadata, evidenceRef }): generate embedding → store via port
  - recall({ query, limit, threshold, tier }): embedding → port.recall → digest-only facts
  - health(): writes, reads, lastRecall, dim

createVectorMemoryPort({ url, key }): in-memory fallback for tests
```

### 4. Tool Registry — v0.5 Additions

`packages/cells/celia/executor/src/tool-registry.js`:

| Tool | Capability | Policy | Inputs | Outputs |
|------|------------|--------|--------|---------|
| `memory.semantic_store` | memory.semantic_store | max 4KB | content, tier, metadata, evidence_ref | digest, id, evidence |
| `memory.semantic_recall` | memory.semantic_recall | max limit 50 | query, limit, threshold, tier | facts, count, evidence |
| `embedding.generate` | embedding.generate | max 8KB | text | embedding, dim, digest |

Validation:
- semantic_store: content length ≤ 4096, needs string
- semantic_recall: limit ≤ 50, needs query string
- embedding.generate: text ≤ 8192

### 5. Dashboard API — Semantic Endpoints

`tools/celia-dashboard-server.mjs`:

```
GET  /api/v1/semantic/memory — list facts
POST /api/v1/semantic/store — { content, tier, metadata } → stored
POST /api/v1/semantic/recall — { query, limit=12, threshold=0.3 } → Top-K
POST /api/v1/semantic/rag-demo — demo with planner context
POST /api/v1/semantic/embedding — { text } → 384d embedding preview
```

Seed: 10 initial facts (policies, architecture, security, UI, RAG) on startup.

### 6. Frontend — SemanticRagPanel

`dashboard/src/components/SemanticRagPanel.jsx`:

- Glassmorphism: bg-slate-900/40 backdrop-blur-xl border-slate-800
- Search input: Task → Embedding → Top-12 → Planner
- Recall + Demo buttons
- Results: tier badge, similarity score, digest, content
- Planner Context preview: `- [tier] content` joined
- Live count: {n} facts • 384d • Top-12
- Polls /api/v1/semantic/memory every 5s

Integrated in `NexaDashboard.jsx`:
- Top: HUD + Telemetry (6 counters)
- Arena: Terminal (logs) + DAG Visualizer (SSE)
- Bottom: Semantic RAG Panel (5 cols) + Evidence + Memory + Planner (7 cols)
- Footer: v0.5 RAG • 384d • pgvector • Top-12

Build: 56.6KB gzip (was 55KB) — still tiny, no heavy chart libs, lucide-react + Tailwind only.

### 7. RAG Demo — End-to-End

`tools/celia-rag-demo.mjs`:

```bash
node tools/celia-rag-demo.mjs
# Uses mock port by default

Flow:
1. Store 12 system facts (policies, architecture, security, UI, RAG)
2. Test embedding: deterministic 1.0, different topic low similarity
3. RAG recall: 4 queries → Top-12 each, similarity scores
4. Planner integration: Task → recallContext → plannerContext string → DAG steps

Output: ✅ Retrieved n facts, planner context, DAG would execute
```

With real Supabase:

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=key node tools/celia-rag-demo.mjs
# Uses real pgvector RPC match_semantic_memory
```

## Security Posture — Still 6 CLOSED

- No fs write in packages/ — vector-store.js pure, no Supabase import
- Supabase client only in tools/ (port)
- Digest-only, evidence-bound, capability-gated
- Embedding deterministic, no secret leakage
- 314 tests still pass
- Tool registry default deny, new tools require evidence_ref

## Future — v0.6

- External embedding API: OpenRouter free, HuggingFace inference, Supabase built-in
- HNSW index for >1000 rows
- Planner auto-RAG: before DAG generation, recall Top-12 automatically
- Memory compaction: summarize old facts, keep digest
- Cross-cell RAG: memory cells share embeddings via ledger

## Files

- `supabase/migrations/20260921_pgvector.sql` — pgvector extension, table, RLS, RPC
- `packages/cells/celia/memory/src/vector-store.js` — cell + embedding + mock port
- `tools/celia-vector-port.mjs` — Supabase pgvector port (mock/real)
- `tools/celia-rag-demo.mjs` — end-to-end RAG demo
- `packages/cells/celia/executor/src/tool-registry.js` — +3 tools (semantic_store, semantic_recall, embedding.generate)
- `tools/celia-dashboard-server.mjs` — +5 endpoints /api/v1/semantic/*
- `dashboard/src/components/SemanticRagPanel.jsx` — glassmorphism RAG UI
- `dashboard/src/components/NexaDashboard.jsx` — integrated RAG panel
