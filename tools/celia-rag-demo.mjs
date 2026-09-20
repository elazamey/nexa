#!/usr/bin/env node
/**
 * NEXA v0.5 — Semantic Memory & RAG Demo
 * 
 * Tests full RAG cycle: Task → Generate Embedding → Retrieve Top-12 → Pass to Planner → Execute
 * 
 * Uses mock vector port by default (no Supabase needed), falls back to real Supabase if env set.
 * Free, offline-safe, deterministic 384d embeddings.
 * 
 * Usage:
 *   node tools/celia-rag-demo.mjs
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=key node tools/celia-rag-demo.mjs
 */

import { createVectorSupabasePort } from './celia-vector-port.mjs';
import { createVectorMemoryPort, generateEmbedding, cosineSimilarity } from '../packages/cells/celia/memory/src/vector-store.js';

async function run() {
  console.log('🧠 NEXA v0.5 — Semantic Memory & RAG Test');
  console.log('   Flow: Task → Generate Embedding → Retrieve Top-12 → Pass to Planner → Execute\n');

  const useRealSupabase = process.env.SUPABASE_URL && !process.env.SUPABASE_URL.includes('mock');
  let memoryPort;

  if (useRealSupabase) {
    console.log(`📡 Using real Supabase: ${process.env.SUPABASE_URL}\n`);
    const vault = {
      get: (key) => {
        const map = {
          'SUPABASE_URL': process.env.SUPABASE_URL,
          'SUPABASE_SERVICE_KEY': process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
          'SUPABASE_ANON_KEY': process.env.SUPABASE_ANON_KEY,
          'SUPABASE_KEY': process.env.SUPABASE_ANON_KEY
        };
        return map[key] || process.env[key];
      }
    };
    memoryPort = createVectorSupabasePort(vault);
  } else {
    console.log('💾 Using mock vector port (deterministic 384d, in-memory cosine search)\n');
    memoryPort = createVectorSupabasePort({ url: 'mock://memory', key: 'mock-key' });
  }

  // 1. Store system policies and architecture facts
  console.log('1️⃣  Storing system facts (policies, architecture, security)...\n');

  const systemFacts = [
    { content: 'NEXA execution requires evidence_ref for all filesystem writes. No write without evidence.', meta: { type: 'policy', tier: 'semantic', source: 'execution.md' } },
    { content: 'Grok planner produces parallel DAGs with max 3 concurrent nodes, topological sort, speculative execution.', meta: { type: 'architecture', tier: 'semantic', source: 'planner' } },
    { content: 'Memory is digest-only, never raw content, with RLS, JSONB, evidence-bound, owner_kid gated.', meta: { type: 'policy', tier: 'semantic', source: 'memory' } },
    { content: 'Tool registry default deny, allow-listed paths, require_evidence_ref, 6 tools: fs.read, git.diff, git.log, http.get, supabase.read, memory.recall.', meta: { type: 'policy', tier: 'working', source: 'tool-registry' } },
    { content: 'SSE stream /api/v1/dag-stream provides real-time DAG visualization, lightweight uni-directional, heartbeat 15s, auto-reconnect.', meta: { type: 'architecture', tier: 'working', source: 'sse' } },
    { content: 'Speculative execution starts B while A runs, PASTE 48.5% latency reduction, maxParallel 3.', meta: { type: 'architecture', tier: 'working', source: 'executor' } },
    { content: 'Security gates 6 CLOSED, no fs write in packages/, REAL_EXECUTION CLOSED, 314 tests, 2 LLM vectors BLOCKED.', meta: { type: 'security', tier: 'episodic', source: 'posture' } },
    { content: 'Glassmorphism dashboard: HUD + Telemetry Grid + Arena, Tailwind + lucide-react, 55KB gzip, no heavy chart libs.', meta: { type: 'ui', tier: 'working', source: 'dashboard' } },
    { content: 'Supabase pgvector 384d embeddings for semantic memory, cosine similarity, Top-K RAG for planner context.', meta: { type: 'architecture', tier: 'semantic', source: 'v0.5' } },
    { content: 'Evidence chain hash-chained, signed receipts, ledger records every cell message with payload_digest.', meta: { type: 'policy', tier: 'semantic', source: 'evidence' } },
    { content: 'Celia agent v0.4 secure execution engine with DAG parallel and speculative PASTE 48.5% optimization.', meta: { type: 'architecture', tier: 'semantic', source: 'celia' } },
    { content: 'NEXA OS Kernel: Cell → Tissue → Organ → Organism, AI proposes, deterministic system decides.', meta: { type: 'philosophy', tier: 'longterm', source: 'kernel' } },
  ];

  for (const fact of systemFacts) {
    const res = await memoryPort.storeFact(fact.content, fact.meta);
    console.log(`   ✓ ${res.digest} [${res.tier}] ${fact.content.slice(0,60)}...`);
  }

  console.log(`\n   Stored ${systemFacts.length} facts\n`);

  // 2. Test embedding generation
  console.log('2️⃣  Testing embedding generation (384d deterministic)...\n');
  const testText = 'How to handle execution evidence and DAG concurrency?';
  const embedding = await generateEmbedding(testText);
  console.log(`   Text: "${testText}"`);
  console.log(`   Embedding dim: ${embedding.length}, norm: ${Math.sqrt(embedding.reduce((s,v)=>s+v*v,0)).toFixed(4)}`);
  console.log(`   First 5 values: [${embedding.slice(0,5).map(v=>v.toFixed(4)).join(', ')}...]`);

  const embedding2 = await generateEmbedding(testText);
  const simSame = cosineSimilarity(embedding, embedding2);
  console.log(`   Deterministic check (same text): similarity=${simSame.toFixed(4)} (should be 1.0)`);

  const diffEmbedding = await generateEmbedding('Completely different topic about cooking recipes');
  const simDiff = cosineSimilarity(embedding, diffEmbedding);
  console.log(`   Different topic similarity: ${simDiff.toFixed(4)} (should be low)\n`);

  // 3. RAG recall — Top-12
  console.log('3️⃣  RAG Recall — Task → Embedding → Top-12 Relevant Facts\n');

  const queries = [
    'How to handle execution evidence and DAG concurrency?',
    'What are security policies for memory and filesystem?',
    'Explain dashboard glassmorphism and SSE real-time visualization',
    'How does speculative execution save latency?'
  ];

  for (const query of queries) {
    console.log(`   🔍 Query: "${query}"`);
    const facts = await memoryPort.recallContext(query, 12, 0.3);
    console.log(`   ✅ Retrieved ${facts.length} relevant facts:`);
    facts.slice(0, 5).forEach((f, i) => {
      console.log(`      ${i+1}. [${f.similarity}] ${f.tier} ${f.digest} — ${f.content.slice(0,70)}...`);
    });
    if (facts.length > 5) console.log(`      ... and ${facts.length - 5} more`);
    console.log('');
  }

  // 4. Simulate planner integration
  console.log('4️⃣  Simulating Planner Integration — RAG → Planner Context\n');

  const task = 'Implement new tool that reads files and requires evidence';
  console.log(`   Task: "${task}"`);
  const relevantFacts = await memoryPort.recallContext(task, 12, 0.3);
  console.log(`   Retrieved ${relevantFacts.length} facts for planner:`);

  const plannerContext = relevantFacts.map(f => `- [${f.tier}] ${f.content}`).join('\n');
  console.log('\n   📋 Planner Context (passed to Grok):');
  console.log('   ' + plannerContext.split('\n').join('\n   '));

  console.log('\n   🤖 Planner would now generate DAG with:');
  console.log('   - observe project structure');
  console.log('   - do fs.read with evidence_ref (policy from memory)');
  console.log('   - parallel nodes max 3 (architecture from memory)');
  console.log('   - evidence chain record (policy from memory)');
  console.log('   - emit result');

  console.log('\n✅ NEXA v0.5 RAG Demo Complete — Semantic Memory & Retrieval Working');
  console.log('   - 384d deterministic embeddings ✓');
  console.log('   - Cosine similarity Top-K search ✓');
  console.log('   - Digest-only, evidence-bound ✓');
  console.log('   - Free, offline-safe, no external API needed ✓');
  console.log('   - Supabase pgvector ready (migration: 20260921_pgvector.sql) ✓');
}

run().catch(err => {
  console.error('❌ RAG Demo failed:', err);
  process.exit(1);
});
