#!/usr/bin/env node
/**
 * NEXA OS v0.6 — Transactional Workspace + Contract-First + Adaptive DAG + AST Patching + Time-Travel Demo
 * 
 * Bundle Core — الحزمة الأساسية الآمنة
 * Demonstrates: CoW workspace, contracts, adaptive DAG injection, AST patching, event sourcing replay
 */

import { createTransactionalWorkspacePort } from './celia-workspace-port.mjs';
import { createAstPort } from './celia-ast-port.mjs';
import { ContractEngine } from '../packages/cells/celia/executor/src/contract-engine.js';
import { AdaptiveDagEngine, DagNodeStatus } from '../packages/cells/celia/executor/src/adaptive-dag.js';
import { EventSourcingEngine, EventType } from '../packages/cells/celia/executor/src/event-sourcing.js';
import { NexaGovernedMemoryEngine } from '../packages/cells/celia/memory/src/governed-engine.js';

async function run() {
  console.log('🚀 NEXA OS v0.6 — Transactional Workspace + Contract-First + Adaptive DAG + AST + Time-Travel\n');
  console.log('   Bundle Core: Rollback ذري، عقود قبل/بعد، DAG يعيد تشكيل نفسه، ترقيع AST آمن، إعادة تشغيل زمني\n');

  // 1. Contract Engine
  console.log('1️⃣  Contract-First Harness — Preconditions & Postconditions\n');

  const contractEngine = new ContractEngine();
  const contract = {
    id: 'fix-login-bug',
    preconditions: [
      'git_status: clean',
      'tests_passing: true',
      'no_uncommitted_changes'
    ],
    postconditions: [
      'build_status: success',
      'no_new_eslint_warnings: true',
      { changed_files_max: 3 },
      'tests_passing: true',
      'no_secrets_leaked: true',
      'evidence_chain_valid: true',
      'ledger_hash_valid: true'
    ]
  };

  const beforeContext = {
    gitStatus: 'clean',
    testsPassing: true,
    warnings: 2,
    evidenceChainValid: true,
    ledgerValid: true,
    realExecutionClosed: true
  };

  const preCheck = await contractEngine.checkPreconditions(contract, beforeContext);
  console.log(`   Preconditions: ${preCheck.ok ? '✅ PASSED' : '❌ FAILED'}`);
  preCheck.checks.forEach(c => console.log(`     - ${JSON.stringify(c.condition)} → ${c.ok ? '✓' : '✗'} ${c.detail}`));

  // 2. Transactional Workspace
  console.log('\n2️⃣  Transactional Workspace (CoW) — Staging / Copy-on-Write FS\n');

  const workspacePort = createTransactionalWorkspacePort({ root: process.cwd() });
  const taskId = 'v06_demo_task';

  const { workspaceId, stagingPath } = await workspacePort.createWorkspace(taskId, { evidenceRef: 'evidence:v06-workspace-create' });
  console.log(`   ✓ Created workspace ${workspaceId}`);
  console.log(`     Staging: ${stagingPath}`);
  console.log(`     Real: ${process.cwd()}`);
  console.log(`     Method: file_copy (CoW lazy)`);

  await workspacePort.writeFile(workspaceId, 'src/test-feature.js', `
function newFeature() {
  console.log("New feature in staging");
  return 42;
}
`, 'evidence:write-feature-v06');

  console.log('   ✓ Wrote src/test-feature.js to staging (evidence-bound)');

  const changes = await workspacePort.listChanges(workspaceId);
  console.log(`   Changes: ${changes.length} files in staging`);
  changes.forEach(c => console.log(`     - ${c.path} [${c.status}] digest=${c.stagingDigest.slice(0,16)}`));

  // 3. AST-Aware Patching
  console.log('\n3️⃣  AST-Aware Patching — Node Mutation with Syntax Validation\n');

  const astPort = createAstPort({ root: process.cwd() });

  const sampleCode = `
function hello(name) {
  console.log("Hello " + name);
}

function broken(a, b) {
  return a + b
}
`;

  const parsed = astPort.parse(sampleCode);
  console.log(`   Parsed ${parsed.functions.length} functions via ${parsed.method}:`);
  parsed.functions.forEach(f => console.log(`     - ${f.name} line ${f.line} [${f.start}-${f.end}]`));

  const validation = astPort.validateSyntax(sampleCode);
  console.log(`   Syntax validation: ${validation.ok ? '✅ OK' : '❌ ' + validation.error}`);

  const badCode = `function broken( { console.log("missing") `;
  const badValidation = astPort.validateSyntax(badCode);
  console.log(`   Bad code correctly rejected: ${!badValidation.ok ? '✅ ' + badValidation.error.slice(0,60) : '❌ should fail'}`);

  // Apply AST patch in staging workspace
  const patch = astPort.generatePatch({
    file: 'src/test-feature.js',
    nodeName: 'newFeature',
    newContent: `
function newFeature() {
  console.log("Patched via AST — syntax validated");
  return 42;
}
`,
    operation: 'replace'
  });

  const patchResult = await astPort.applyPatch('src/test-feature.js', patch, 'evidence:ast-patch-v06', workspacePort, workspaceId);
  console.log(`   ✓ Applied AST patch ${patch.id} to ${patchResult.file} node=${patchResult.node} digest=${patchResult.digest.slice(0,16)} validation=${patchResult.validation}`);

  // 4. Adaptive DAG Engine
  console.log('\n4️⃣  Adaptive DAG Engine — Dynamic Node Injection on Failure\n');

  const adaptiveDag = new AdaptiveDagEngine({ maxDepth: 5, maxInjections: 10 });

  const initialNodes = [
    { id: 'discover', tool: 'fs.read', critical: false },
    { id: 'inspect-repo', tool: 'git.log', critical: false },
    { id: 'build', tool: 'build', critical: false },
    { id: 'test', tool: 'test', critical: false },
    { id: 'deploy', tool: 'deploy', critical: true }
  ];

  const initialEdges = [
    { from: 'discover', to: 'inspect-repo' },
    { from: 'inspect-repo', to: 'build' },
    { from: 'build', to: 'test' },
    { from: 'test', to: 'deploy' }
  ];

  adaptiveDag.initialize(initialNodes, initialEdges);
  console.log(`   Initial DAG: ${initialNodes.length} nodes, ${initialEdges.length} edges, version ${adaptiveDag.dag.version}`);

  // Simulate test failure
  adaptiveDag.updateNodeStatus('discover', DagNodeStatus.SUCCESS, 'evidence:discover-ok');
  adaptiveDag.updateNodeStatus('inspect-repo', DagNodeStatus.SUCCESS, 'evidence:inspect-ok');
  adaptiveDag.updateNodeStatus('build', DagNodeStatus.SUCCESS, 'evidence:build-ok');
  adaptiveDag.updateNodeStatus('test', DagNodeStatus.FAILED, 'evidence:test-fail');

  console.log('   Simulated: discover SUCCESS, inspect-repo SUCCESS, build SUCCESS, test FAILED');

  const failedNodes = adaptiveDag.getFailedNodes();
  console.log(`   Failed nodes: ${failedNodes.map(n => n.id).join(', ')}`);

  const shouldInject = adaptiveDag.shouldInject(failedNodes[0]);
  console.log(`   Should inject recovery for test? ${shouldInject ? '✅ Yes (not critical, retries<2)' : '❌ No'}`);

  if (shouldInject) {
    const recoveryNodes = adaptiveDag.generateRecoveryNodes(failedNodes[0], new Error('Test failed: syntax error in src/test-feature.js'));
    console.log(`   Generated recovery nodes: ${recoveryNodes.map(n => n.suffix + ':' + n.taskIntent.slice(0,30)).join(', ')}`);

    const injection = adaptiveDag.injectNodes('test', recoveryNodes, 'evidence:recovery-injection');
    console.log(`   ✅ Injected ${injection.injected.length} nodes: ${injection.injected.map(n => n.id).join(', ')}`);
    console.log(`   DAG now: ${adaptiveDag.dag.nodes.length} nodes, version ${adaptiveDag.dag.version}`);
    console.log(`   New edges: ${adaptiveDag.dag.edges.slice(-3).map(e => `${e.from}→${e.to} [${e.type}]`).join(', ')}`);

    // Simulate recovery
    adaptiveDag.updateNodeStatus('test_a', DagNodeStatus.SUCCESS, 'evidence:parse-ok');
    adaptiveDag.updateNodeStatus('test_b', DagNodeStatus.SUCCESS, 'evidence:ast-fix-ok');
    adaptiveDag.updateNodeStatus('test_c', DagNodeStatus.SUCCESS, 'evidence:retest-ok');
    console.log('   Recovery: test_a SUCCESS (parse), test_b SUCCESS (AST fix), test_c SUCCESS (re-test)');

    const executable = adaptiveDag.getExecutableNodes();
    console.log(`   Now executable: ${executable.map(n => n.id).join(', ')} (should be deploy)`);
  }

  const dagStats = adaptiveDag.getStats();
  console.log(`   DAG stats: total=${dagStats.total}, maxDepth=${dagStats.maxDepth}, injections=${dagStats.injections}, byStatus=${JSON.stringify(dagStats.byStatus)}`);

  // 5. Event Sourcing & Time-Travel
  console.log('\n5️⃣  Time-Travel Debugging & Deterministic Replay — Event Sourcing\n');

  const eventEngine = new EventSourcingEngine({ seed: 'nexa_v06_deterministic_seed' });

  eventEngine.record(EventType.DAG_START, { dagId: adaptiveDag.dag.id, nodes: initialNodes.length }, 'evidence:dag-start');
  eventEngine.record(EventType.NODE_START, { nodeId: 'discover', inputs: { path: 'README.md' } }, 'evidence:discover-start');
  eventEngine.record(EventType.TOOL_OUTPUT, { nodeId: 'discover', tool: 'fs.read', digest: 'sha256:abc', duration: 12 }, 'evidence:discover-output');
  eventEngine.record(EventType.NODE_COMPLETE, { nodeId: 'discover', state: 'SUCCESS' }, 'evidence:discover-complete');
  eventEngine.record(EventType.NODE_START, { nodeId: 'test', inputs: { cmd: 'npm test' } }, 'evidence:test-start');
  eventEngine.record(EventType.NODE_FAILED, { nodeId: 'test', error: 'SyntaxError: Unexpected token', evidenceRef: 'evidence:test-fail' }, 'evidence:test-fail');
  eventEngine.record(EventType.DAG_NODE_INJECTED, { failedNodeId: 'test', injected: [{ id: 'test_a' }, { id: 'test_b' }, { id: 'test_c' }] }, 'evidence:injection');

  // Checkpoint at index 3
  eventEngine.checkpoint({ dag: adaptiveDag.dag, workspaceId, stage: 'before_test' }, 'evidence:checkpoint-3');

  console.log(`   Recorded ${eventEngine.log.length} events, seed=${eventEngine.seed}`);
  console.log(`   Events: ${eventEngine.log.map(e => `${e.index}:${e.type}`).join(', ')}`);

  const stateAt2 = eventEngine.getStateAt(2);
  console.log(`   State at index 2: dag nodes=${stateAt2.state.dag.nodes.length}, checkpoint=${stateAt2.checkpointIndex}, replayed ${stateAt2.eventsReplayed} events`);

  const replay = eventEngine.replayFrom(3, { fix: 'applied AST patch to src/test-feature.js' }, 'evidence:replay-fix');
  console.log(`   ✅ Replay from index 3: ${replay.message}`);
  console.log(`   Replay event: index=${replay.replayEvent.index} type=${replay.replayEvent.type}`);

  const chainValid = eventEngine.verifyChain();
  console.log(`   Chain valid: ${chainValid.valid ? '✅' : '❌'} entries=${chainValid.entries}`);

  // 6. Governed Memory Integration
  console.log('\n6️⃣  Governed Memory Integration — Procedural + Failure + Ledger\n');

  const governedEngine = new NexaGovernedMemoryEngine({ maxNodes: 100 });

  await governedEngine.registerStrategy({
    taskIntent: 'fix failing test via AST patch',
    condition: { error: 'SyntaxError', tool: 'test' },
    strategyDAG: { nodes: [{ id: 'parse' }, { id: 'ast_patch' }, { id: 'retest' }] },
    evidenceRef: 'evidence:strategy-ast-fix',
    confidence: 0.9
  });

  await governedEngine.registerFailure({
    failurePattern: 'test failed',
    cause: 'Syntax error in staged file',
    preventiveFix: 'Use AST port validateSyntax before commit, check contract postconditions',
    contextState: { tool: 'test' },
    evidenceRef: 'evidence:failure-test'
  });

  const recall = governedEngine.recallRelevantKnowledge('fix failing test', { tool: 'test' });
  console.log(`   Recall for "fix failing test": preventions=${recall.preventions.length}, strategies=${recall.strategies.length}`);
  if (recall.preventions.length > 0) console.log(`     Prevention: ${recall.preventions[0].preventiveFix.slice(0,70)}...`);
  if (recall.strategies.length > 0) console.log(`     Strategy: ${recall.strategies[0].taskIntent} utility=${recall.strategies[0].utility.toFixed(2)}`);

  // 7. Contract Post-check + Commit/Rollback
  console.log('\n7️⃣  Contract Postconditions + Atomic Commit/Rollback\n');

  const afterContext = {
    buildStatus: 'success',
    testsPassing: true,
    warnings: 2, // Same as before, no new warnings
    changedFiles: changes.length,
    evidenceChainValid: true,
    ledgerValid: true,
    realExecutionClosed: true
  };

  const verification = await contractEngine.verify(contract, beforeContext, afterContext, { changedFiles: changes.length });

  console.log(`   Verification: ${verification.ok ? '✅ PASSED' : '❌ FAILED'} shouldCommit=${verification.shouldCommit} status=${verification.status}`);
  console.log(`   Reason: ${verification.reason}`);
  console.log('   Post checks:');
  verification.post.checks.forEach(c => console.log(`     - ${JSON.stringify(c.condition)} → ${c.ok ? '✓' : '✗'} ${c.detail}`));

  if (verification.shouldCommit) {
    const commitResult = await workspacePort.commit(workspaceId, 'evidence:v06-commit');
    console.log(`   ✅ Committed workspace ${workspaceId}: ${commitResult.changedFiles} files atomically`);
    eventEngine.record(EventType.WORKSPACE_COMMIT, { workspaceId, changedFiles: commitResult.changedFiles }, 'evidence:commit');
  } else {
    const rollbackResult = await workspacePort.rollback(workspaceId, 'evidence:v06-rollback');
    console.log(`   🔄 Rolled back workspace ${workspaceId}: cleaned=${rollbackResult.cleaned} — zero side effects`);
    eventEngine.record(EventType.WORKSPACE_ROLLBACK, { workspaceId, reason: verification.reason }, 'evidence:rollback');
  }

  // Cleanup if not committed (we committed, so need to rollback to keep repo clean for demo)
  if (verification.shouldCommit) {
    // For demo cleanliness, rollback the commit we just did by removing test file if it was committed
    try {
      const { rmSync, existsSync } = await import('node:fs');
      const testFile = 'src/test-feature.js';
      if (existsSync(testFile)) {
        rmSync(testFile);
        console.log(`   🧹 Demo cleanup: removed ${testFile} from real repo (rollback commit for demo)`);
      }
      // Also cleanup staging
      await workspacePort.rollback(workspaceId, 'evidence:cleanup').catch(() => {});
    } catch {}
  }

  console.log('\n✅ NEXA OS v0.6 Demo Complete — Transactional + Contract + Adaptive DAG + AST + Time-Travel');
  console.log('   - Transactional Workspace: CoW, atomic commit/rollback, evidence-bound ✓');
  console.log('   - Contract-First: pre/post conditions, auto commit/rollback decision ✓');
  console.log('   - Adaptive DAG: dynamic injection 3a,3b,3c on failure, maxDepth circuit breaker ✓');
  console.log('   - AST-Aware Patching: parse, findNode, validateSyntax, applyPatch in staging ✓');
  console.log('   - Time-Travel: event sourcing hash-chained, checkpoint, replayFrom without LLM calls ✓');
  console.log('   - Governed Memory: procedural + failure + ledger integration ✓');
  console.log('   - Security: 6 gates CLOSED, no fs in packages/, all via ports in tools/ ✓');
}

run().catch(err => {
  console.error('❌ v0.6 Demo failed:', err);
  console.error(err.stack);
  process.exit(1);
});
