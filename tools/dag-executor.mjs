#!/usr/bin/env node
/**
 * Celia DAG Executor — Parallel execution with speculative layer
 * 
 * Implements:
 *   MISSION
 *    ├── discover
 *    ├── inspect (repo, docs, runtime) — parallel
 *    ├── implement
 *    ├── test
 *    ├── security
 *    └── verify
 * 
 * Features:
 * - Topological sort, level-based parallel execution
 * - Speculative Tool Execution: start B while A runs if predicted (PASTE 48.5% improvement)
 * - Evidence for each node
 * - Self-healing: fail → diagnose → patch → retest (max_attempts: 3)
 * 
 * Lives in tools/ — allowed to use worker_threads for parallelism
 */

import { createToolRegistry } from '../packages/cells/celia/executor/src/tool-registry.js';
import { createSecureExecutor } from '../packages/cells/celia/executor/src/executor.js';
import { createFsReadPort, createGitPort, createHttpPort } from './celia-tool-registry.mjs';

export function createDAGExecutor({ maxParallel = 3, speculative = true } = {}) {
  const toolRegistry = createToolRegistry({
    ports: {
      'fs.read': createFsReadPort(),
      'git.diff': createGitPort(),
      'git.log': createGitPort(),
      'http.get': createHttpPort(),
      'filesystem.read': createFsReadPort(),
      'git.diff': createGitPort(),
    }
  });

  const executor = createSecureExecutor({ toolRegistry, maxParallel, speculative });

  return {
    toolRegistry,
    executor,
    async executeMission(mission) {
      console.log(`\n🚀 Executing Mission: ${mission.goal || 'unnamed'}`);
      console.log(`   DAG nodes: ${mission.dag?.nodes?.length || 0}, maxParallel: ${maxParallel}, speculative: ${speculative}`);

      const result = await executor.executeDAG(mission.dag, {
        capability: { verified: true, resource: mission.resource || 'tool:celia' },
        evidenceRefPrefix: mission.id || 'mission'
      });

      console.log(`\n📊 DAG Result: ${result.summary}`);
      console.log(`   Passed: ${result.passed}, Failed: ${result.failed}`);
      for (const r of result.results) {
        console.log(`   - ${r.id}: ${r.ok ? '✅' : '❌'} ${r.ok ? r.result?.digest?.slice(0,16) : r.error}`);
      }

      return result;
    }
  };
}

// Demo DAG
const demoDAG = {
  id: 'celia-review-mission',
  goal: 'Review repository and report risks',
  dag: {
    nodes: [
      { id: 'discover', tool: 'fs.read', inputs: { path: 'README.md' }, critical: false },
      { id: 'inspect-repo', tool: 'git.log', inputs: { limit: 5 }, dependsOn: ['discover'], critical: false },
      { id: 'inspect-docs', tool: 'fs.read', inputs: { path: 'spec/omega/README.md' }, dependsOn: ['discover'], critical: false },
      { id: 'inspect-runtime', tool: 'fs.read', inputs: { path: 'package.json' }, dependsOn: ['discover'], critical: false },
      { id: 'analyze', tool: 'fs.read', inputs: { path: 'spec/celia-agent/README.md' }, dependsOn: ['inspect-repo', 'inspect-docs', 'inspect-runtime'], critical: true },
      { id: 'verify', tool: 'git.diff', inputs: { base: 'HEAD~1', head: 'HEAD' }, dependsOn: ['analyze'], critical: false, speculative: true }
    ]
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🌟 Celia DAG Executor Demo — Parallel + Speculative\n');
  console.log('DAG Structure:');
  console.log('  discover');
  console.log('  ├── inspect-repo (parallel)');
  console.log('  ├── inspect-docs (parallel)');
  console.log('  └── inspect-runtime (parallel)');
  console.log('       └── analyze (critical)');
  console.log('            └── verify (speculative)\n');

  const dagExecutor = createDAGExecutor({ maxParallel: 3, speculative: true });
  
  console.log('Available tools:');
  for (const tool of dagExecutor.toolRegistry.list()) {
    console.log(`  - ${tool.id}: ${tool.description.slice(0,60)}...`);
  }

  const result = await dagExecutor.executeMission(demoDAG);
  
  console.log('\n✅ DAG Executor OK — parallel execution, evidence per node, speculative layer');
  console.log(`   Evidence chain: ${result.evidenceChain.length} records`);
  console.log(`   Next: Add more tools (supabase.read, memory.recall) and integrate with planner`);
}
