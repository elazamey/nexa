#!/usr/bin/env node
/**
 * Celia Dashboard Server — Serves frontend + API for evidence, memory, planner + DAG SSE
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
 */

import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const PORT = process.env.PORT || 3001;

// Global event emitter for DAG updates — shared with executor
export const dagEventEmitter = new EventEmitter();
dagEventEmitter.setMaxListeners(50);

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
    version: 'v0.4-dag-sse'
  }
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

  // Serve static dashboard if built, otherwise return info
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<head><title>Celia Dashboard API</title></head>
<body style="font-family: monospace; padding: 20px; background: #0a0a0b; color: #e4e4e7;">
<h1>Celia Dashboard Server — NEXA v0.4 DAG SSE</h1>
<p>API running on port ${PORT}</p>
<ul>
  <li><a href="/api/celia/state">/api/celia/state</a> — full state</li>
  <li><a href="/api/celia/evidence">/api/celia/evidence</a> — evidence chain</li>
  <li><a href="/api/celia/memory">/api/celia/memory</a> — memory digests</li>
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
  console.log(`🌟 Celia Dashboard Server running (v0.4 DAG SSE)`);
  console.log(`   API: http://localhost:${PORT}`);
  console.log(`   State: http://localhost:${PORT}/api/celia/state`);
  console.log(`   DAG Stream (SSE): http://localhost:${PORT}/api/v1/dag-stream`);
  console.log(`   DAG Run: POST http://localhost:${PORT}/api/v1/dag-run`);
  console.log(`   Frontend dev: cd dashboard && npm run dev → http://localhost:5173`);
  console.log(`   Gates: 6 CLOSED, Tests: 314/314, Promotion: 5/5 READY`);
});
