#!/usr/bin/env node
/**
 * Celia Dashboard Server — Serves frontend + API for evidence, memory, planner + DAG SSE + Semantic RAG + Governed Memory
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
 *   GET  /api/v1/semantic/memory — list semantic facts (legacy pgvector)
 *   POST /api/v1/semantic/store — store fact with embedding
 *   POST /api/v1/semantic/recall — RAG recall Top-12
 *   POST /api/v1/semantic/rag-demo — run RAG demo
 *   GET  /api/v1/governed/memory — list governed memories (State Machine)
 *   POST /api/v1/governed/recall — state-aware recall (preventions + strategies)
 *   POST /api/v1/governed/register — register procedural/failure/belief
 *   POST /api/v1/governed/revise — belief revision
 *   POST /api/v1/governed/sweep — forgetting/weakening sweep
 *   GET  /api/v1/governed/ledger — audit trail
 *   GET  /api/v1/governed/stats — engine stats
 */

import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createVectorSupabasePort } from './celia-vector-port.mjs';
import { NexaGovernedMemoryEngine } from '../packages/cells/celia/memory/src/governed-engine.js';

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

// v0.5 Governed Memory Engine — Self-Evolving Agent OS (no pgvector needed)
const governedEngine = new NexaGovernedMemoryEngine({ maxNodes: 500, ownerKid: 'nexa:governed:api:v0.5' });

// Seed governed memory with initial strategies and failures
let governedSeeded = false;
async function seedGovernedMemory() {
  if (governedSeeded) return;
  if (governedEngine.proceduralStore.store.size > 0) {
    governedSeeded = true;
    return;
  }
  try {
    await governedEngine.registerStrategy({
      taskIntent: 'read file with evidence',
      condition: { tool: 'fs.read', requiresEvidence: true },
      strategyDAG: { nodes: [{ id: 'observe', kind: 'observe' }, { id: 'read', kind: 'do', tool: 'fs.read' }], maxParallel: 1 },
      evidenceRef: 'evidence:fs-read-v0.5',
      confidence: 0.9
    });
    await governedEngine.registerStrategy({
      taskIntent: 'parallel DAG execution',
      condition: { maxParallel: 3, speculative: true },
      strategyDAG: { nodes: [{ id: 'discover' }, { id: 'inspect', parallel: true }, { id: 'verify', critical: true }], maxParallel: 3, pasteSaving: '48.5%' },
      evidenceRef: 'evidence:dag-v0.4',
      confidence: 0.95
    });
    await governedEngine.registerFailure({
      failurePattern: 'fs write without evidence',
      cause: 'REAL_EXECUTION gate violation',
      preventiveFix: 'Require evidence_ref, use port in tools/, check tool-registry',
      contextState: { gate: 'REAL_EXECUTION' },
      evidenceRef: 'evidence:failure-001'
    });
    await governedEngine.registerFailure({
      failurePattern: 'secret egress',
      cause: 'Raw content without digest',
      preventiveFix: 'Return digest only, OMEGA_E_SECRET_EGRESS',
      contextState: { tier: 'memory' },
      evidenceRef: 'evidence:failure-002'
    });
    await governedEngine.registerBelief({
      belief: 'Tool registry default deny + evidence_ref + allow-list + RLS + digest-only is required (defense in depth)',
      condition: { gates: '6 CLOSED', tests: '314/314' },
      evidenceRef: 'evidence:belief-v0.5',
      confidence: 0.9
    });
    governedSeeded = true;
    console.log(`[governed] seeded ${governedEngine.proceduralStore.store.size} memories (procedural + failure + belief)`);
  } catch (e) {
    console.warn('[governed] seed failed', e.message);
  }
}
seedGovernedMemory();

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
    version: 'v0.5-governed-memory',
    rag: 'Governed State Machine • Procedural • Failure • Belief • Forgetting',
    memoryEngine: 'PROPOSED→ACTIVE→WEAKENED→RETIRED'
  },
  semanticMemory: [],
  governedMemory: []
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

  // === v0.5 Governed Memory Engine Endpoints ===
  if (url.pathname === '/api/v1/governed/memory' && req.method === 'GET') {
    await seedGovernedMemory();
    const type = url.searchParams.get('type');
    const state = url.searchParams.get('state');
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const memories = governedEngine.listMemories({ type, state, limit });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: memories.length, total: governedEngine.proceduralStore.store.size, memories }));
    return;
  }

  if (url.pathname === '/api/v1/governed/stats' && req.method === 'GET') {
    await seedGovernedMemory();
    const stats = governedEngine.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, stats }));
    return;
  }

  if (url.pathname === '/api/v1/governed/ledger' && req.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const entries = governedEngine.getLedgerEntries({ limit });
    const verification = governedEngine.verifyLedger();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: entries.length, valid: verification.valid, entries, verification }));
    return;
  }

  if (url.pathname === '/api/v1/governed/recall' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { taskIntent, currentSystemState, options } = JSON.parse(body || '{}');
        if (!taskIntent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'taskIntent required' }));
          return;
        }
        await seedGovernedMemory();
        const result = governedEngine.recallRelevantKnowledge(taskIntent, currentSystemState || {}, options || {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, taskIntent, ...result }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/v1/governed/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { kind, ...payload } = JSON.parse(body || '{}');
        await seedGovernedMemory();
        let node;
        if (kind === 'procedural' || kind === 'strategy') {
          node = await governedEngine.registerStrategy(payload);
        } else if (kind === 'failure') {
          node = await governedEngine.registerFailure(payload);
        } else if (kind === 'belief') {
          node = await governedEngine.registerBelief(payload);
        } else {
          throw new Error('kind must be procedural, failure, or belief');
        }
        emitDagEvent('GOVERNED_REGISTERED', { id: node.id, type: node.type, state: node.state });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: node.id, type: node.type, state: node.state, node: node.toJSON() }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/v1/governed/revise' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { oldId, newContent, evidenceRef } = JSON.parse(body || '{}');
        if (!oldId || !newContent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'oldId and newContent required' }));
          return;
        }
        const revision = governedEngine.reviseBelief(oldId, newContent, evidenceRef || 'evidence:revision-api');
        emitDagEvent('BELIEF_REVISED', revision);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...revision }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/v1/governed/sweep' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { kind = 'forgetting', threshold = 0.1, options = {} } = JSON.parse(body || '{}');
        let result;
        if (kind === 'weakening') {
          result = governedEngine.runWeakeningSweep(threshold);
        } else {
          result = governedEngine.runForgettingSweep(threshold, options);
        }
        emitDagEvent('FORGETTING_SWEEP', result);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, kind, ...result }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/v1/governed/success' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { id, evidenceRef } = JSON.parse(body || '{}');
        if (!id) throw new Error('id required');
        const node = governedEngine.recordSuccess(id, evidenceRef);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id, state: node?.state, successCount: node?.successCount, utility: node?.calculateUtility() }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/v1/governed/failure' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { id, evidenceRef, cause } = JSON.parse(body || '{}');
        if (!id) throw new Error('id required');
        const node = governedEngine.recordFailure(id, evidenceRef, cause);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id, state: node?.state, failureCount: node?.failureCount, utility: node?.calculateUtility() }));
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
<head><title>Celia Dashboard API v0.5 Governed Memory</title></head>
<body style="font-family: monospace; padding: 20px; background: #0a0a0b; color: #e4e4e7;">
<h1>Celia Dashboard Server — NEXA v0.5 Governed Memory State Machine</h1>
<p>API running on port ${PORT} — Self-Evolving Agent OS</p>
<ul>
  <li><a href="/api/celia/state">/api/celia/state</a> — full state</li>
  <li><a href="/api/celia/evidence">/api/celia/evidence</a> — evidence chain</li>
  <li><a href="/api/celia/memory">/api/celia/memory</a> — memory digests</li>
  <li><a href="/api/v1/semantic/memory">/api/v1/semantic/memory</a> — semantic facts (legacy pgvector RAG)</li>
  <li>POST /api/v1/semantic/recall — RAG recall Top-12</li>
  <li><a href="/api/v1/governed/memory">/api/v1/governed/memory</a> — governed memories (State Machine)</li>
  <li><a href="/api/v1/governed/stats">/api/v1/governed/stats</a> — engine stats</li>
  <li><a href="/api/v1/governed/ledger">/api/v1/governed/ledger</a> — audit trail hash-chained</li>
  <li>POST /api/v1/governed/recall — state-aware recall { taskIntent, currentSystemState }</li>
  <li>POST /api/v1/governed/register — register { kind: procedural|failure|belief, ... }</li>
  <li>POST /api/v1/governed/revise — belief revision { oldId, newContent, evidenceRef }</li>
  <li>POST /api/v1/governed/sweep — forgetting { threshold, options }</li>
  <li><a href="/api/posture">/api/posture</a> — gate posture</li>
  <li><a href="/api/v1/dag-stream">/api/v1/dag-stream</a> — SSE DAG stream (real-time)</li>
  <li>POST <a href="/api/v1/dag-run">/api/v1/dag-run</a> — trigger DAG execution</li>
</ul>
<p>Frontend: cd dashboard && npm run dev → http://localhost:5173</p>
<p>NEXA MEMORY v0.5 ENGINE: State Machine → Procedural → Failure → Belief Revision → Forgetting → Ledger</p>
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
  console.log(`🌟 Celia Dashboard Server running (v0.5 Governed Memory State Machine)`);
  console.log(`   API: http://localhost:${PORT}`);
  console.log(`   State: http://localhost:${PORT}/api/celia/state`);
  console.log(`   DAG Stream (SSE): http://localhost:${PORT}/api/v1/dag-stream`);
  console.log(`   DAG Run: POST http://localhost:${PORT}/api/v1/dag-run`);
  console.log(`   Semantic (legacy): http://localhost:${PORT}/api/v1/semantic/memory`);
  console.log(`   Governed Memory: http://localhost:${PORT}/api/v1/governed/memory`);
  console.log(`   Governed Stats: http://localhost:${PORT}/api/v1/governed/stats`);
  console.log(`   Governed Ledger: http://localhost:${PORT}/api/v1/governed/ledger`);
  console.log(`   Governed Recall: POST http://localhost:${PORT}/api/v1/governed/recall`);
  console.log(`   Frontend dev: cd dashboard && npm run dev → http://localhost:5173`);
  console.log(`   Gates: 6 CLOSED, Tests: 314/314, Promotion: 5/5 READY, Engine: State Machine → Procedural → Failure → Belief → Forgetting → Ledger`);
});
