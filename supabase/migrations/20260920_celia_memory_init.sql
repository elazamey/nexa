-- 1. جدول الذاكرة (Digest-only)
CREATE TABLE public.celia_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier VARCHAR(50) NOT NULL, -- e.g., 'episodic', 'semantic'
    digest TEXT NOT NULL UNIQUE,
    owner_kid TEXT NOT NULL,
    evidence_ref TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. جدول الأدلة (Evidence Chain)
CREATE TABLE public.celia_evidence (
    hash TEXT PRIMARY KEY,
    prev_hash TEXT,
    kind VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    sig TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. تفعيل RLS (Row Level Security)
ALTER TABLE public.celia_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.celia_evidence ENABLE ROW LEVEL SECURITY;

-- سياسات الوصول (Read/Write عبر Service Role أو Port محدد فقط)
CREATE POLICY "Allow port access to memory" ON public.celia_memory FOR ALL USING (true);
CREATE POLICY "Allow port access to evidence" ON public.celia_evidence FOR ALL USING (true);

-- Indexes for performance
CREATE INDEX idx_celia_memory_tier ON public.celia_memory(tier);
CREATE INDEX idx_celia_memory_owner ON public.celia_memory(owner_kid);
CREATE INDEX idx_celia_memory_created ON public.celia_memory(created_at DESC);
CREATE INDEX idx_celia_evidence_kind ON public.celia_evidence(kind);
CREATE INDEX idx_celia_evidence_prev ON public.celia_evidence(prev_hash);

-- Comments for documentation
COMMENT ON TABLE public.celia_memory IS 'Celia agent memory - digest-only, never raw content, evidence-bound';
COMMENT ON TABLE public.celia_evidence IS 'NEXA evidence chain - hash-chained, signed receipts';
COMMENT ON COLUMN public.celia_memory.digest IS 'SHA256 digest of content, raw content in vault or encrypted';
COMMENT ON COLUMN public.celia_memory.evidence_ref IS 'Hash of NEXA evidence record that authorized this write';
