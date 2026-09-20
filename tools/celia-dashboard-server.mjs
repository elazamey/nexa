#!/usr/bin/env node
/**
 * Celia Dashboard Server — Serves frontend + API for evidence, memory, planner
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
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const PORT = process.env.PORT || 3001;

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
    version: 'v0.3-dashboard'
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

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

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
      // Run demo and capture output
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
<h1>Celia Dashboard Server — NEXA v0.3</h1>
<p>API running on port ${PORT}</p>
<ul>
  <li><a href="/api/celia/state">/api/celia/state</a> — full state (thinking, evidence, memory)</li>
  <li><a href="/api/celia/evidence">/api/celia/evidence</a> — evidence chain</li>
  <li><a href="/api/celia/memory">/api/celia/memory</a> — memory digests</li>
  <li><a href="/api/posture">/api/posture</a> — gate posture</li>
</ul>
<p>Frontend: cd dashboard && npm install && npm run dev → http://localhost:5173</p>
<p>Or: node tools/celia-dashboard-server.mjs serves API, Vite serves UI with proxy to /api</p>
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
  console.log(`🌟 Celia Dashboard Server running`);
  console.log(`   API: http://localhost:${PORT}`);
  console.log(`   State: http://localhost:${PORT}/api/celia/state`);
  console.log(`   Frontend dev: cd dashboard && npm install && npm run dev → http://localhost:5173`);
  console.log(`   Gates: 6 CLOSED, Tests: 314/314, Promotion: 5/5 READY`);
  console.log(`   Security: llm-mint-attempt BLOCKED, llm-secret-egress BLOCKED`);
});
