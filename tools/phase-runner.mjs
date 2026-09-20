#!/usr/bin/env node
/**
 * NEXA Phase Runner — Unified Multi-Phase Orchestrator
 *
 * Supports:
 *   npm run phase -- 4          # Dashboard & UI
 *   npm run phase -- 5          # Benchmarks
 *   npm run phase -- 6          # MCP/GitHub/HTTP organs
 *   npm run phase -- 7          # Release automation
 *   npm run phase -- 8          # v1.0 GA
 *   npm run phase -- all        # All phases sequentially
 *
 * Also supports foundational phases:
 *   npm run phase -- 1          # Protocol Core (v0.1)
 *   npm run phase -- 2          # Ω Language & Cellular (v0.2)
 *   npm run phase -- 3          # Celia Agent & Governed Memory (v0.3-v0.5)
 */

import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PHASES = {
  1: {
    id: 1,
    title: 'Protocol Core (v0.1)',
    description: 'Signed capability-gated protocol, 6 closed gates, Ed25519, canonical C14N',
    run: () => {
      const p = spawnSync(process.execPath, [join(root, 'tools/check-posture.mjs')], { cwd: root, stdio: 'inherit' });
      if (p.status !== 0) return false;
      const d = spawnSync(process.execPath, [join(root, 'tools/demo.mjs')], { cwd: root, stdio: 'inherit' });
      return d.status === 0;
    }
  },
  2: {
    id: 2,
    title: 'Ω Language & Cellular Layer (v0.2)',
    description: 'NEXA Ω compiler, runtime, cellular organism (Cell/Tissue/Organ), 31 attacks blocked',
    run: () => {
      const o = spawnSync(process.execPath, [join(root, 'tools/omega-demo.mjs')], { cwd: root, stdio: 'inherit' });
      if (o.status !== 0) return false;
      const c = spawnSync(process.execPath, [join(root, 'tools/cellular-demo.mjs')], { cwd: root, stdio: 'inherit' });
      if (c.status !== 0) return false;
      const a = spawnSync(process.execPath, [join(root, 'tools/omega-attacks.mjs')], { cwd: root, stdio: 'inherit' });
      return a.status === 0;
    }
  },
  3: {
    id: 3,
    title: 'Celia Agent & Governed Memory (v0.3-v0.5)',
    description: 'Celia planner, 8-tier governed memory state machine, procedural store, DAG executor',
    run: () => {
      const c = spawnSync(process.execPath, [join(root, 'tools/celia-demo.mjs')], { cwd: root, stdio: 'inherit' });
      if (c.status !== 0) return false;
      const m = spawnSync(process.execPath, [join(root, 'tools/celia-memory-governed-demo.mjs')], { cwd: root, stdio: 'inherit' });
      if (m.status !== 0) return false;
      const d = spawnSync(process.execPath, [join(root, 'tools/dag-executor.mjs')], { cwd: root, stdio: 'inherit' });
      return d.status === 0;
    }
  },
  4: {
    id: 4,
    title: 'Dashboard & UI',
    description: 'React 18 + Vite frontend, 13 visualization panels, 21 backend API endpoints',
    run: () => {
      const res = spawnSync(process.execPath, [join(root, 'tools/dashboard-verify.mjs')], { cwd: root, stdio: 'inherit' });
      return res.status === 0;
    }
  },
  5: {
    id: 5,
    title: 'Benchmarks',
    description: 'Deterministic benchmark suites across 9 categories, cryptographic reproducibility, regression delta',
    run: () => {
      const res = spawnSync(process.execPath, [join(root, 'tools/benchmarks.mjs')], { cwd: root, stdio: 'inherit' });
      return res.status === 0;
    }
  },
  6: {
    id: 6,
    title: 'MCP/GitHub/HTTP organs',
    description: 'External organs: MCP JSON-RPC bridge, GitHub log/diff inspection, SSRF-immune HTTP port',
    run: () => {
      const res = spawnSync(process.execPath, [join(root, 'tools/organs-demo.mjs')], { cwd: root, stdio: 'inherit' });
      return res.status === 0;
    }
  },
  7: {
    id: 7,
    title: 'Release automation',
    description: 'Automated release pipeline, publish plan generation, signing ceremony, 5/5 promotion verifier',
    run: () => {
      const res = spawnSync(process.execPath, [join(root, 'tools/release-automation.mjs')], { cwd: root, stdio: 'inherit' });
      return res.status === 0;
    }
  },
  8: {
    id: 8,
    title: 'v1.0 GA',
    description: 'Singularity (46 engines) + Omega (56 engines) + Z3 formal verification + General Availability audit',
    run: () => {
      const res = spawnSync(process.execPath, [join(root, 'tools/ga-verification.mjs')], { cwd: root, stdio: 'inherit' });
      return res.status === 0;
    }
  }
};

// Aliases mapping
const ALIASES = {
  'core': 1,
  'protocol': 1,
  'cellular': 2,
  'omega': 2,
  'celia': 3,
  'memory': 3,
  'dashboard': 4,
  'ui': 4,
  'benchmarks': 5,
  'benchmark': 5,
  'organs': 6,
  'mcp': 6,
  'release': 7,
  'automation': 7,
  'ga': 8,
  'singularity': 8,
  'v1.0': 8
};

function printHelp() {
  console.log(`
NEXA Phase Orchestrator
════════════════════════════════════════════════════════════════════════════════

تشغيل مرحلة محددة (Run a specific phase):
  npm run phase -- 4          # Dashboard & UI
  npm run phase -- 5          # Benchmarks
  npm run phase -- 6          # MCP/GitHub/HTTP organs
  npm run phase -- 7          # Release automation
  npm run phase -- 8          # v1.0 GA

أو كل المراحل متتابعة (Or all phases sequentially):
  npm run phase -- all

المراحل التأسيسية (Foundational phases):
  npm run phase -- 1          # Protocol Core (v0.1)
  npm run phase -- 2          # Ω Language & Cellular (v0.2)
  npm run phase -- 3          # Celia Agent & Governed Memory (v0.3-v0.5)

أوامر التطوير والتحقق (Development & Verification commands):
  npm run verify:quick        # Developer quick loop (< 1 second)
  npm run cover               # Coverage report
  npm run verify              # Full CI verification suite
`);
}

function parseArg(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/^--?phase=?/i, '').replace(/^--?p=?/i, '').toLowerCase().trim();
  if (cleaned === 'all') return 'all';
  const num = parseInt(cleaned, 10);
  if (!isNaN(num) && PHASES[num]) return num;
  if (ALIASES[cleaned]) return ALIASES[cleaned];
  return null;
}

// Extract argument: handle `npm run phase -- 4` or `node tools/phase-runner.mjs 4`
const rawArgs = process.argv.slice(2).filter(a => a !== '--');
const target = parseArg(rawArgs[0]);

if (!target) {
  printHelp();
  process.exit(1);
}

const suiteStart = performance.now();

if (target === 'all') {
  console.log('🚀 NEXA Full Phase Pipeline — Executing All Phases Sequentially');
  console.log('═'.repeat(80));

  const results = [];
  const phaseNumbers = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const num of phaseNumbers) {
    const phase = PHASES[num];
    console.log(`\n▶ [Phase ${num}/8] ${phase.title}`);
    console.log(`  ${phase.description}`);
    console.log('─'.repeat(80));

    const pStart = performance.now();
    let ok = false;
    try {
      ok = phase.run();
    } catch (e) {
      console.error(`  ❌ Error in phase ${num}: ${e.message}`);
      ok = false;
    }
    const pDuration = ((performance.now() - pStart) / 1000).toFixed(2);
    results.push({ num, title: phase.title, ok, duration: pDuration });

    if (!ok) {
      console.error(`\n❌ Pipeline halted at Phase ${num}: ${phase.title}`);
      break;
    }
  }

  const totalTime = ((performance.now() - suiteStart) / 1000).toFixed(2);
  console.log('\n' + '═'.repeat(80));
  console.log('📊 Pipeline Summary:');
  console.log('┌' + '─'.repeat(10) + '┬' + '─'.repeat(40) + '┬' + '─'.repeat(12) + '┬' + '─'.repeat(12) + '┐');
  console.log('│ ' + 'Phase'.padEnd(8) + ' │ ' + 'Title'.padEnd(38) + ' │ ' + 'Status'.padEnd(10) + ' │ ' + 'Duration'.padEnd(10) + ' │');
  console.log('├' + '─'.repeat(10) + '┼' + '─'.repeat(40) + '┼' + '─'.repeat(12) + '┼' + '─'.repeat(12) + '┤');

  let allPassed = true;
  for (const r of results) {
    const statusStr = r.ok ? '✅ PASS' : '❌ FAIL';
    console.log(`│ ${String(r.num).padEnd(8)} │ ${r.title.padEnd(38)} │ ${statusStr.padEnd(10)} │ ${(r.duration + 's').padEnd(10)} │`);
    if (!r.ok) allPassed = false;
  }
  console.log('└' + '─'.repeat(10) + '┴' + '─'.repeat(40) + '┴' + '─'.repeat(12) + '┴' + '─'.repeat(12) + '┘');

  if (allPassed && results.length === phaseNumbers.length) {
    console.log(`\n✨ All 8 Phases PASSED in ${totalTime}s — NEXA is Production Ready!`);
    process.exit(0);
  } else {
    console.error(`\n❌ Pipeline FAILED in ${totalTime}s.`);
    process.exit(1);
  }
} else {
  const phase = PHASES[target];
  console.log(`▶ Executing Phase ${target}: ${phase.title}`);
  console.log(`  ${phase.description}`);
  console.log('─'.repeat(80));

  const pStart = performance.now();
  let ok = false;
  try {
    ok = phase.run();
  } catch (e) {
    console.error(`❌ Error in Phase ${target}: ${e.message}`);
    ok = false;
  }
  const pDuration = ((performance.now() - pStart) / 1000).toFixed(2);

  console.log('\n' + '═'.repeat(80));
  if (ok) {
    console.log(`✨ Phase ${target} (${phase.title}) COMPLETED successfully in ${pDuration}s.`);
    process.exit(0);
  } else {
    console.error(`❌ Phase ${target} (${phase.title}) FAILED in ${pDuration}s.`);
    process.exit(1);
  }
}
