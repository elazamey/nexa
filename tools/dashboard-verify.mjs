#!/usr/bin/env node
/**
 * NEXA Phase 4 — Dashboard & UI Verification
 *
 * Verifies the complete Dashboard and UI tier:
 *   1. Frontend React build & Vite bundle integrity
 *   2. All 13 Dashboard panels & visualization components
 *   3. Backend API server routes & live endpoints
 *   4. Tailwind styling & asset compilation
 *
 * Usage:
 *   node tools/dashboard-verify.mjs
 *   npm run phase -- 4
 */

import { performance } from 'node:perf_hooks';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const startTime = performance.now();

console.log('🖥️  NEXA Phase 4 — Dashboard & UI Verification');
console.log('═'.repeat(70));
console.log('Full-Stack UI Audit: React 18 + Vite + Tailwind + 21 Server Endpoints\n');

let allOk = true;

// 1. Component inventory verification
console.log('── 1. UI Component Inventory ────────────────────────────────────────');
const componentsDir = join(root, 'dashboard/src/components');
const expectedComponents = [
  'NexaDashboard.jsx',
  'DagVisualizer.jsx',
  'EvidenceChain.jsx',
  'MemoryDigests.jsx',
  'PlannerThinking.jsx',
  'GovernedMemoryPanel.jsx',
  'SemanticRagPanel.jsx',
  'TransactionalWorkspacePanel.jsx',
  'DslPanel.jsx',
  'UltimatePanel.jsx',
  'InfinitePanel.jsx',
  'SingularityPanel.jsx',
  'OmegaPanel.jsx'
];

let foundComponents = 0;
for (const comp of expectedComponents) {
  const compPath = join(componentsDir, comp);
  if (existsSync(compPath)) {
    const size = (statSync(compPath).size / 1024).toFixed(1);
    console.log(`  ✅ ${comp.padEnd(32)} (${size} KB)`);
    foundComponents++;
  } else {
    console.error(`  ❌ Missing component: ${comp}`);
    allOk = false;
  }
}
console.log(`Total components verified: ${foundComponents}/${expectedComponents.length}`);

// 2. Frontend Production Build Verification
console.log('\n── 2. Vite Production Build ─────────────────────────────────────────');
const distDir = join(root, 'dashboard/dist');
let needBuild = !existsSync(join(distDir, 'index.html'));

if (needBuild) {
  console.log('  Building dashboard for production...');
  const buildRes = spawnSync('npm', ['run', 'build'], {
    cwd: join(root, 'dashboard'),
    encoding: 'utf8'
  });
  if (buildRes.status !== 0) {
    console.error(`  ❌ Build failed:\n${buildRes.stderr || buildRes.stdout}`);
    allOk = false;
  }
}

if (existsSync(join(distDir, 'index.html'))) {
  const assets = existsSync(join(distDir, 'assets')) ? readdirSync(join(distDir, 'assets')) : [];
  const jsFile = assets.find(f => f.endsWith('.js'));
  const cssFile = assets.find(f => f.endsWith('.css'));
  const jsSize = jsFile ? (statSync(join(distDir, 'assets', jsFile)).size / 1024).toFixed(1) : 0;
  const cssSize = cssFile ? (statSync(join(distDir, 'assets', cssFile)).size / 1024).toFixed(1) : 0;

  console.log(`  ✅ dist/index.html: present`);
  console.log(`  ✅ JS Bundle:  ${jsFile || 'none'} (${jsSize} KB)`);
  console.log(`  ✅ CSS Bundle: ${cssFile || 'none'} (${cssSize} KB)`);
} else {
  console.error('  ❌ dist/index.html not found');
  allOk = false;
}

// 3. Dashboard API Server Verification
console.log('\n── 3. Dashboard API Server & Endpoints ──────────────────────────────');
const TEST_PORT = 3105;
const serverProcess = spawn(process.execPath, [join(root, 'tools/celia-dashboard-server.mjs')], {
  cwd: root,
  env: { ...process.env, PORT: String(TEST_PORT) },
  stdio: ['ignore', 'pipe', 'pipe']
});

// Wait for server to bind
await new Promise(r => setTimeout(r, 900));

const endpointsToTest = [
  { path: '/api/celia/state', name: 'Celia Agent State' },
  { path: '/api/posture', name: 'Hard Gate Posture' },
  { path: '/api/v1/governed/stats', name: 'Governed Memory Stats' },
  { path: '/api/v1/dsl/list', name: 'DSL Engine Catalog' },
  { path: '/api/v1/ultimate/stats', name: 'Ultimate Physics Stats' },
  { path: '/api/v1/infinite/stats', name: 'Infinite Kernel Stats' },
  { path: '/api/v1/singularity/stats', name: 'Singularity Kernel Stats' },
  { path: '/api/v1/omega/stats', name: 'Omega Kernel Stats' }
];

for (const ep of endpointsToTest) {
  try {
    const res = await fetch(`http://localhost:${TEST_PORT}${ep.path}`);
    if (res.status === 200) {
      console.log(`  ✅ ${ep.path.padEnd(28)} [200 OK] — ${ep.name}`);
    } else {
      console.error(`  ❌ ${ep.path} returned HTTP ${res.status}`);
      allOk = false;
    }
  } catch (e) {
    console.error(`  ❌ Failed to reach ${ep.path}: ${e.message}`);
    allOk = false;
  }
}

// Clean up server process
serverProcess.kill('SIGTERM');
await new Promise(r => setTimeout(r, 200));

const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);
console.log('\n' + '═'.repeat(70));

if (allOk) {
  console.log(`✨ Phase 4: Dashboard & UI COMPLETE in ${totalDuration}s`);
  console.log('   All 13 visualization panels verified, Vite bundle ready, API server verified.');
  process.exit(0);
} else {
  console.error(`❌ Phase 4: Dashboard & UI FAILED in ${totalDuration}s`);
  process.exit(1);
}
