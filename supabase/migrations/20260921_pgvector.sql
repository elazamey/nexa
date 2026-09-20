-- NEXA v0.5 — Semantic Memory & RAG with pgvector
-- Task → Generate Embedding → Retrieve Top-12 Relevant Facts → Pass to Planner → Execute

-- 1. تفعيل امتداد المتجهات
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. جدول الذاكرة الدلالية — digest-only + vector search
CREATE TABLE IF NOT EXISTS public.celia_semantic_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    digest VARCHAR(64) NOT NULL,
    tier VARCHAR(20) DEFAULT 'working' CHECK (tier IN ('episodic', 'semantic', 'working', 'longterm')),
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding VECTOR(384), -- 384d lightweight, free-tier friendly, fast
    owner_kid TEXT,
    evidence_ref TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. RLS — Row Level Security (same pattern as celia_memory)
ALTER TABLE public.celia_semantic_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow port access to semantic memory" ON public.celia_semantic_memory;
CREATE POLICY "Allow port access to semantic memory" ON public.celia_semantic_memory FOR ALL USING (true);

-- 4. Indexes — performance for RAG
CREATE INDEX IF NOT EXISTS idx_celia_semantic_tier ON public.celia_semantic_memory(tier);
CREATE INDEX IF NOT EXISTS idx_celia_semantic_digest ON public.celia_semantic_memory(digest);
CREATE INDEX IF NOT EXISTS idx_celia_semantic_created ON public.celia_semantic_memory(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_celia_semantic_owner ON public.celia_semantic_memory(owner_kid);

-- Vector index — IVFFLAT for cosine similarity (requires at least some rows, created after data)
-- For production with >1000 rows: CREATE INDEX ON celia_semantic_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- For HNSW (pgvector 0.5+): CREATE INDEX ON celia_semantic_memory USING hnsw (embedding vector_cosine_ops);
-- We create HNSW if available, fallback to IVFFLAT is handled manually

-- 5. دالة البحث عن الاسترجاع السياقي Top-K — Cosine Similarity
CREATE OR REPLACE FUNCTION public.match_semantic_memory (
    query_embedding VECTOR(384),
    match_threshold FLOAT DEFAULT 0.5,
    match_count INT DEFAULT 12
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    digest VARCHAR(64),
    tier VARCHAR(20),
    metadata JSONB,
    owner_kid TEXT,
    evidence_ref TEXT,
    similarity FLOAT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        celia_semantic_memory.id,
        celia_semantic_memory.content,
        celia_semantic_memory.digest,
        celia_semantic_memory.tier,
        celia_semantic_memory.metadata,
        celia_semantic_memory.owner_kid,
        celia_semantic_memory.evidence_ref,
        1 - (celia_semantic_memory.embedding <=> query_embedding) AS similarity,
        celia_semantic_memory.created_at
    FROM public.celia_semantic_memory
    WHERE celia_semantic_memory.embedding IS NOT NULL
      AND 1 - (celia_semantic_memory.embedding <=> query_embedding) > match_threshold
    ORDER BY celia_semantic_memory.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 6. دالة إضافية — البحث مع فلترة tier
CREATE OR REPLACE FUNCTION public.match_semantic_memory_by_tier (
    query_embedding VECTOR(384),
    filter_tier VARCHAR(20),
    match_threshold FLOAT DEFAULT 0.5,
    match_count INT DEFAULT 12
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    digest VARCHAR(64),
    tier VARCHAR(20),
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        celia_semantic_memory.id,
        celia_semantic_memory.content,
        celia_semantic_memory.digest,
        celia_semantic_memory.tier,
        celia_semantic_memory.metadata,
        1 - (celia_semantic_memory.embedding <=> query_embedding) AS similarity
    FROM public.celia_semantic_memory
    WHERE celia_semantic_memory.embedding IS NOT NULL
      AND celia_semantic_memory.tier = filter_tier
      AND 1 - (celia_semantic_memory.embedding <=> query_embedding) > match_threshold
    ORDER BY celia_semantic_memory.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 7. Comments
COMMENT ON TABLE public.celia_semantic_memory IS 'NEXA v0.5 Semantic Memory — digest-only, vector search, evidence-bound, RAG for planner';
COMMENT ON COLUMN public.celia_semantic_memory.embedding IS '384d vector for cosine similarity, generated via hash-based deterministic embedding or external free API (OpenRouter/HF)';
COMMENT ON COLUMN public.celia_semantic_memory.digest IS 'SHA256 digest of content for verification';
COMMENT ON FUNCTION public.match_semantic_memory IS 'RAG recall: Top-K cosine similarity search for planner context (default 12 facts, threshold 0.5)';
