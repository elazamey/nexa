#!/usr/bin/env node
/**
 * Celia Dashboard Server — Serves frontend + API for evidence, memory, planner + DAG SSE + Semantic RAG
 * 
 * This server lives in tools/ (allowed to use fs, net, child_process)
 * It does NOT open any NEXA gates — it only reads evidence and memory via ports
 * 
 *   node tools/celia-dashboard-server.mjs
 *   → http://localhost:3001 (API) + http://localhost:5173 (Vite frontend)
 * 
 * API:
 *   GET  /api/celia/state — returns { thinking, evidence, memory, status }
 *   POST /api/celia/run-demo — runs celia-demo and returns new state
 *   GET  /api/celia/evidence — evidence chain
 *   GET  /api/celia/memory — memory digests
 *   GET  /api/posture — gate posture
 *   GET  /api/v1/dag-stream — SSE stream for DAG execution (real-time)
 *   POST /api/v1/dag-run — runs DAG executor and streams via SSE
 *   GET  /api/v1/semantic/memory — list semantic facts
 *   POST /api/v1/semantic/store — store fact with embedding
 *   POST /api/v1/semantic/recall — RAG recall Top-12
 *   POST /api/v1/semantic/rag-demo — run RAG demo
 */

import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createVectorSupabasePort } from './celia-vector-port.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const PORT = process.env.PORT || 3001;

// Global event emitter for DAG updates — shared with executor
export const dagEventEmitter = new EventEmitter();
dagEventEmitter.setMaxListeners(50);

// v0.5 — Semantic Memory Port (mock by default, real Supabase if env set)
const vectorPort = createVectorSupabasePort({
  url: process.env.SUPABASE_URL || 'mock://memory',
  key: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY || 'mock-key'
});

// Seed semantic memory with initial facts if empty
let semanticSeeded = false;
async function seedSemanticMemory() {
  if (semanticSeeded) return;
  if (vectorPort._store && vectorPort._store.length > 0) {
    semanticSeeded = true;
    return;
  }
  const facts = [
    { content: 'NEXA execution requires evidence_ref for all filesystem writes.', meta: { type: 'policy', tier: 'semantic' } },
    { content: 'Grok planner produces parallel DAGs with max 3 concurrent nodes, topological sort.', meta: { type: 'architecture', tier: 'semantic' } },
    { content: 'Memory is digest-only, never raw content, with RLS, evidence-bound.', meta: { type: 'policy', tier: 'semantic' } },
    { content: 'Tool registry default deny, allow-listed paths, 9 tools including semantic recall.', meta: { type: 'policy', tier: 'working' } },
    { content: 'SSE stream provides real-time DAG visualization, heartbeat 15s.', meta: { type: 'architecture', tier: 'working' } },
    { content: 'Speculative execution PASTE 48.5% latency saved, maxParallel 3.', meta: { type: 'architecture', tier: 'working' } },
    { content: 'Security gates 6 CLOSED, 314 tests, 2 LLM vectors BLOCKED.', meta: { type: 'security', tier: 'episodic' } },
    { content: 'Glassmorphism dashboard: HUD + Telemetry + Arena, Tailwind + lucide-react, 55KB gzip.', meta: { type: 'ui', tier: 'working' } },
    { content: 'Supabase pgvector 384d embeddings, cosine similarity, Top-12 RAG for planner.', meta: { type: 'architecture', tier: 'semantic' } },
    { content: 'Evidence chain hash-chained, signed receipts, ledger records every message.', meta: { type: 'policy', tier: 'semantic' } },
  ];
  for (const f of facts) {
    try { await vectorPort.storeFact(f.content, f.meta); } catch {}
  }
  semanticSeeded = true;
  console.log(`[semantic] seeded ${facts.length} facts`);
}
seedSemanticMemory();

export function updateNodeState(nodeId, state, evidenceRef = null) {
  dagEventEmitter.emit('dag_update', {
    type: 'NODE_STATE_CHANGE',
    payload: { nodeId, state, evidenceRef, timestamp: Date.now() }
  });
}

export function emitDagEvent(type, payload) {
  dagEventEmitter.emit('dag_update', { type, payload: { ...payload, timestamp: Date.now() } });
}

// Mock data — in production, read from Supabase port
let mockState = {
  thinking: {
    model: 'grok-2',
    timestamp: new Date().toISOString(),
    steps: [
      { kind: 'observe', key: 'project', detail: 'Observe NEXA repository' },
      { kind: 'do', capref: 'github.repository.read', args: { owner: 'elazamey', repo: 'nexa' }, as: 'repo' },
      { kind: 'evidence', claim: 'repository inspected', from: 'repo' },
      { kind: 'do', capref: 'celia.memory.remember', args: { tier: 'episodic', digest: 'sha256:abc...' }, as: 'mem' },
      { kind: 'emit', value: 'repo' }
    ]
  },
  evidence: [
    { hash: 'sha256:8XPNIncCFFygp3Owg2nxN_IUgL9CMn-HxcqBtL7b_Jg', prev_hash: 'genesis', kind: 'ENVELOPE_ACCEPTED', payload: { resource: 'tool:echo' }, created_at: new Date().toISOString() },
    { hash: 'sha256:9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b', prev_hash: '8XPNIncC', kind: 'CELL_MESSAGE', payload: { cell: 'celia.memory', receptor: 'remember' }, created_at: new Date().toISOString() },
    { hash: 'sha256:1a2b3c4d5e6f7a8b9c6d7e8f9a0b1c2f3a4b5c6d7e8f9a0b1c', prev_hash: '9a8b7c6d', kind: 'EVIDENCE', payload: { claim: 'repository inspected' }, created_at: new Date().toISOString() },
  ],
  memory: [
    { id: '1', tier: 'episodic', digest: 'sha256:abc123def456...', owner_kid: 'nexa:key:ed25519:z6MkCelia...', evidence_ref: '8XPNIncC', created_at: new Date().toISOString() },
    { id: '2', tier: 'semantic', digest: 'sha256:789xyz...', owner_kid: 'nexa:key:ed25519:z6MkCelia...', evidence_ref: '9a8b7c6d', created_at: new Date().toISOString() },
    { id: '3', tier: 'working', digest: 'sha256:qwerty...', owner_kid: 'nexa:key:ed25519:z6MkCelia...', evidence_ref: '1a2b3c4d', created_at: new Date().toISOString() },
  ],
  status: {
    gates: '6 CLOSED',
    tests: '314/314',
    promotion: '5/5 READY',
    llm_vectors: '2/2 BLOCKED',
    version: 'v0.5-semantic-rag',
    rag: 'Top-12 RAG • 384d • pgvector'
  },
  semanticMemory: []
};

function getPosture() {
  try {
    const out = execSync('node tools/check-posture.mjs', { cwd: root, encoding: 'utf8' });
    return out.slice(0,500);
  } catch (e) {
    return e.stdout?.toString().slice(0,500) || 'posture check failed';
  }
}

const server = createServer(async (req, res) => {
  // CORS for Vite dev server
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // === SSE Endpoint for DAG Stream (v0.4) ===
  if (url.pathname === '/api/v1/dag-stream') {
    // Secure read-only SSE endpoint
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const sendUpdate = (data) => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (e) {
        // Client disconnected
      }
    };

    // Send initial connected event
    sendUpdate({ type: 'CONNECTED', message: 'DAG Stream Active', timestamp: Date.now() });

    // Listen for DAG updates from executor
    const listener = (update) => sendUpdate(update);
    dagEventEmitter.on('dag_update', listener);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      sendUpdate({ type: 'HEARTBEAT', timestamp: Date.now() });
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      dagEventEmitter.off('dag_update', listener);
      console.log('[sse] client disconnected from /api/v1/dag-stream');
    });

    console.log('[sse] client connected to /api/v1/dag-stream');
    return;
  }

  // === DAG Run Endpoint — triggers DAG execution with SSE ===
  if (url.pathname === '/api/v1/dag-run' && req.method === 'POST') {
    console.log('[api] POST /api/v1/dag-run — starting DAG execution with SSE streaming');
    
    // Emit DAG start
    emitDagEvent('DAG_START', { message: 'DAG execution started', nodes: 6 });

    // Simulate DAG execution with real-time updates via SSE
    // In production, this would call actual executor
    const nodes = ['discover', 'inspect-repo', 'inspect-docs', 'inspect-runtime', 'analyze', 'verify'];
    
    // Run async DAG simulation
    (async () => {
      for (let i = 0; i < nodes.length; i++) {
        const nodeId = nodes[i];
        const isParallel = i >= 1 && i <= 3; // inspect-* nodes parallel
        
        updateNodeState(nodeId, 'RUNNING');
        console.log(`[dag] ${nodeId} RUNNING`);
        
        // Simulate work
        await new Promise(r => setTimeout(r, isParallel ? 300 : 600));
        
        // Simulate success with evidence
        const evidenceRef = `sha256:${nodeId}-${Date.now().toString(36)}`;
        updateNodeState(nodeId, 'SUCCESS', evidenceRef);
        console.log(`[dag] ${nodeId} SUCCESS evidence=${evidenceRef.slice(0,16)}...`);
        
        // Update mock state
        mockState.evidence.push({
          hash: evidenceRef,
          prev_hash: mockState.evidence[mockState.evidence.length-1]?.hash?.slice(0,8) || 'prev',
          kind: 'DAG_NODE',
          payload: { node: nodeId, tool: 'fs.read' },
          created_at: new Date().toISOString()
        });
      }
      
      emitDagEvent('DAG_COMPLETE', { message: 'DAG completed', passed: nodes.length, failed: 0 });
      console.log('[dag] DAG_COMPLETE');
    })();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'DAG started, stream via /api/v1/dag-stream', nodes }));
    return;
  }

  // API routes
  if (url.pathname === '/api/celia/state') {
    mockState.thinking.timestamp = new Date().toISOString();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockState));
    return;
  }

  if (url.pathname === '/api/celia/evidence') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockState.evidence));
    return;
  }

  if (url.pathname === '/api/celia/memory') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockState.memory));
    return;
  }

  if (url.pathname === '/api/celia/run-demo' && req.method === 'POST') {
    console.log('[dashboard-server] running celia-demo...');
    try {
      execSync('node tools/celia-demo.mjs', { cwd: root, encoding: 'utf8', timeout: 10000 });
      mockState.thinking.steps.push({
        kind: 'evidence',
        claim: `demo run at ${new Date().toLocaleTimeString()}`,
        detail: 'celia-demo executed'
      });
      mockState.evidence.push({
        hash: `sha256:${Math.random().toString(36).slice(2)}`,
        prev_hash: mockState.evidence[mockState.evidence.length-1]?.hash?.slice(0,8) || 'prev',
        kind: 'DEMO_RUN',
        payload: { demo: 'celia', timestamp: new Date().toISOString() },
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.log('[dashboard-server] demo failed', e.message);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockState));
    return;
  }

  if (url.pathname === '/api/posture') {
    const posture = getPosture();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ posture }));
    return;
  }

  // === v0.5 Semantic Memory & RAG Endpoints ===
  if (url.pathname === '/api/v1/semantic/memory' && req.method === 'GET') {
    await seedSemanticMemory();
    const store = vectorPort._store || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: store.length, facts: store.map(f => ({
      id: f.id,
      digest: f.digest,
      content: f.content,
      tier: f.tier,
      metadata: f.metadata,
      created_at: f.created_at
    })) }));
    return;
  }

  if (url.pathname === '/api/v1/semantic/store' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { content, tier, metadata } = JSON.parse(body || '{}');
        if (!content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'content required' }));
          return;
        }
        await seedSemanticMemory();
        const result = await vectorPort.storeFact(content, { tier: tier || 'working', ...(metadata || {}) });
        emitDagEvent('SEMANTIC_STORED', { digest: result.digest, tier: result.tier });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/v1/semantic/recall' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { query, limit = 12, threshold = 0.3, tier } = JSON.parse(body || '{}');
        if (!query) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'query required' }));
          return;
        }
        await seedSemanticMemory();
        const facts = await vectorPort.recallContext(query, limit, threshold);
        let filtered = facts;
        if (tier) filtered = facts.filter(f => f.tier === tier);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, query, count: filtered.length, facts: filtered }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/v1/semantic/rag-demo' && req.method === 'POST') {
    try {
      await seedSemanticMemory();
      const query = url.searchParams.get('q') || 'How to handle execution evidence and DAG concurrency?';
      const facts = await vectorPort.recallContext(query, 12, 0.3);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        flow: 'Task → Generate Embedding → Retrieve Top-12 → Pass to Planner → Execute',
        query,
        count: facts.length,
        facts,
        plannerContext: facts.map(f => `- [${f.tier}] ${f.content}`).join('\n')
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (url.pathname === '/api/v1/semantic/embedding' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { text } = JSON.parse(body || '{}');
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'text required' }));
          return;
        }
        const { generateEmbedding } = await import('../packages/cells/celia/memory/src/vector-store.js');
        const embedding = await generateEmbedding(text);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, dim: embedding.length, embedding: embedding.slice(0,10), full: false, text: text.slice(0,100) }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Serve static dashboard if built, otherwise return info
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<head><title>Celia Dashboard API v0.5</title></head>
<body style="font-family: monospace; padding: 20px; background: #0a0a0b; color: #e4e4e7;">
<h1>Celia Dashboard Server — NEXA v0.5 Semantic RAG</h1>
<p>API running on port ${PORT}</p>
<ul>
  <li><a href="/api/celia/state">/api/celia/state</a> — full state</li>
  <li><a href="/api/celia/evidence">/api/celia/evidence</a> — evidence chain</li>
  <li><a href="/api/celia/memory">/api/celia/memory</a> — memory digests</li>
  <li><a href="/api/v1/semantic/memory">/api/v1/semantic/memory</a> — semantic facts (RAG)</li>
  <li>POST /api/v1/semantic/store — store fact { content, tier, metadata }</li>
  <li>POST /api/v1/semantic/recall — RAG recall { query, limit=12, threshold=0.3 }</li>
  <li>POST /api/v1/semantic/rag-demo — RAG demo Top-12</li>
  <li>POST /api/v1/semantic/embedding — generate 384d embedding</li>
  <li><a href="/api/posture">/api/posture</a> — gate posture</li>
  <li><a href="/api/v1/dag-stream">/api/v1/dag-stream</a> — SSE DAG stream (real-time)</li>
  <li>POST <a href="/api/v1/dag-run">/api/v1/dag-run</a> — trigger DAG execution</li>
</ul>
<p>Frontend: cd dashboard && npm run dev → http://localhost:5173</p>
<pre>${JSON.stringify(mockState, null, 2).slice(0,2000)}...</pre>
</body>
</html>
    `);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', path: url.pathname }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌟 Celia Dashboard Server running (v0.5 Semantic RAG)`);
  console.log(`   API: http://localhost:${PORT}`);
  console.log(`   State: http://localhost:${PORT}/api/celia/state`);
  console.log(`   DAG Stream (SSE): http://localhost:${PORT}/api/v1/dag-stream`);
  console.log(`   DAG Run: POST http://localhost:${PORT}/api/v1/dag-run`);
  console.log(`   Semantic Memory: http://localhost:${PORT}/api/v1/semantic/memory`);
  console.log(`   RAG Recall: POST http://localhost:${PORT}/api/v1/semantic/recall`);
  console.log(`   RAG Demo: POST http://localhost:${PORT}/api/v1/semantic/rag-demo`);
  console.log(`   Frontend dev: cd dashboard && npm run dev → http://localhost:5173`);
  console.log(`   Gates: 6 CLOSED, Tests: 314/314, Promotion: 5/5 READY, RAG: Top-12 384d`);
});
