#!/usr/bin/env node
/**
 * NEXA Memory v0.5 — Governed Memory State Machine Demo
 * 
 * Demonstrates Self-Evolving Agent OS:
 * - Memory State Machine (PROPOSED → ACTIVE → WEAKENED → RETIRED)
 * - Procedural Memory (recipe reuse)
 * - Failure Memory (prevention)
 * - Belief Revision (superseding)
 * - Forgetting Engine (utility sweep)
 * - Ledger (hash-chained audit)
 * 
 * No pgvector needed — local Map + JSONL, vector optional
 */

import { NexaGovernedMemoryEngine, MemoryState, MemoryType } from '../packages/cells/celia/memory/src/governed-engine.js';

async function run() {
  console.log('🧠 NEXA Memory v0.5 — Governed Memory State Machine');
  console.log('   Self-Evolving Agent OS — No pgvector, local, evidence-bound\n');

  const engine = new NexaGovernedMemoryEngine({ maxNodes: 100, ownerKid: 'nexa:demo:governed:v0.5' });

  // 1. Register procedural strategies
  console.log('1️⃣  Registering Procedural Strategies (HOW to execute)...\n');

  const strat1 = await engine.registerStrategy({
    taskIntent: 'read file with evidence',
    condition: { tool: 'fs.read', requiresEvidence: true },
    strategyDAG: {
      nodes: [
        { id: 'observe', kind: 'observe', detail: 'Check file path allow-list' },
        { id: 'read', kind: 'do', capref: 'filesystem.read', args: { path: 'README.md' } },
        { id: 'evidence', kind: 'evidence', claim: 'file read with digest' }
      ]
    },
    evidenceRef: 'evidence:fs-read-policy-v1',
    confidence: 0.9
  });
  console.log(`   ✓ ${strat1.id} [${strat1.state}] confidence=${strat1.confidence} — ${strat1.content.taskIntent}`);

  const strat2 = await engine.registerStrategy({
    taskIntent: 'parallel DAG execution',
    condition: { maxParallel: 3, speculative: true },
    strategyDAG: {
      nodes: [
        { id: 'discover', kind: 'do', tool: 'fs.read' },
        { id: 'inspect-repo', kind: 'do', tool: 'git.log', parallel: true },
        { id: 'inspect-docs', kind: 'do', tool: 'fs.read', parallel: true },
        { id: 'analyze', kind: 'do', dependsOn: ['inspect-*'] },
        { id: 'verify', kind: 'do', tool: 'posture', critical: true }
      ],
      maxParallel: 3,
      speculative: true,
      pasteSaving: 'claim — not measured by this demo'
    },
    evidenceRef: 'evidence:dag-parallel-v0.4',
    confidence: 0.95
  });
  console.log(`   ✓ ${strat2.id} [${strat2.state}] — ${strat2.content.taskIntent} (PASTE — claim, not measured)`);

  // 2. Register failure memories
  console.log('\n2️⃣  Registering Failure Memories (WHAT to avoid)...\n');

  const fail1 = await engine.registerFailure({
    failurePattern: 'fs write without evidence',
    cause: 'REAL_EXECUTION gate violation — direct fs write in packages/',
    preventiveFix: 'Require evidence_ref for all writes, use port in tools/, check tool-registry policy',
    contextState: { gate: 'REAL_EXECUTION', expected: 'CLOSED' },
    evidenceRef: 'evidence:gate-violation-001'
  });
  console.log(`   ✓ ${fail1.id} [${fail1.state}] confidence=${fail1.confidence} — ${fail1.content.failurePattern}`);
  console.log(`     Fix: ${fail1.content.preventiveFix.slice(0,80)}...`);

  const fail2 = await engine.registerFailure({
    failurePattern: 'path traversal',
    cause: 'fs.read allowed path bypass via ../',
    preventiveFix: 'Allow-list check with pattern.endsWith /**, validate normalized path, OMEGA_E_POLICY',
    contextState: { tool: 'fs.read' },
    evidenceRef: 'evidence:path-traversal-002'
  });
  console.log(`   ✓ ${fail2.id} [${fail2.state}] — ${fail2.content.failurePattern}`);

  const fail3 = await engine.registerFailure({
    failurePattern: 'secret egress',
    cause: 'Raw content returned without digest — OMEGA_E_SECRET_EGRESS',
    preventiveFix: 'Return digest only, never raw secret, check payload.content without digest',
    contextState: { tier: 'memory' },
    evidenceRef: 'evidence:secret-egress-003'
  });
  console.log(`   ✓ ${fail3.id} [${fail3.state}] — ${fail3.content.failurePattern}`);

  // 3. Register beliefs
  console.log('\n3️⃣  Registering Beliefs (revisable knowledge)...\n');

  const belief1 = await engine.registerBelief({
    belief: 'Tool registry default deny is sufficient for security',
    condition: { gates: '6 CLOSED', tests: '314/314' },
    evidenceRef: 'evidence:belief-v0.4',
    confidence: 0.6
  });
  console.log(`   ✓ ${belief1.id} [${belief1.state}] confidence=${belief1.confidence} — ${belief1.content.belief.slice(0,60)}...`);

  // 4. Recall — State-Aware + Utility
  console.log('\n4️⃣  State-Aware Recall — Task → Relevant Knowledge (preventions + strategies)\n');

  const queries = [
    'read file with evidence',
    'parallel DAG execution with fs write',
    'handle secret egress in memory'
  ];

  for (const q of queries) {
    console.log(`   🔍 Task: "${q}"`);
    const { preventions, strategies, beliefs } = engine.recallRelevantKnowledge(q, { tool: 'fs.read', gate: 'REAL_EXECUTION' });

    if (preventions.length > 0) {
      console.log(`   🛡️  Preventions (${preventions.length}):`);
      preventions.forEach(p => console.log(`      - [${p.confidence}] ${p.failurePattern} → ${p.preventiveFix.slice(0,60)}...`));
    }

    if (strategies.length > 0) {
      console.log(`   📋 Strategies (${strategies.length}):`);
      strategies.forEach(s => console.log(`      - [utility=${s.utility.toFixed(2)}] ${s.taskIntent} success=${s.successCount}`));
    }

    if (beliefs.length > 0) {
      console.log(`   💭 Beliefs (${beliefs.length}): ${beliefs[0].belief?.slice(0,60)}...`);
    }

    if (preventions.length === 0 && strategies.length === 0) {
      console.log('   (no relevant knowledge — would use default planner)');
    }
    console.log('');
  }

  // 5. Simulate execution success/failure tracking
  console.log('5️⃣  Execution Tracking — Success/Failure affects Utility & State\n');

  console.log(`   Before: ${strat1.id} success=${strat1.successCount} failure=${strat1.failureCount} utility=${strat1.calculateUtility().toFixed(3)} state=${strat1.state}`);

  engine.recordSuccess(strat1.id, 'evidence:exec-success-001');
  engine.recordSuccess(strat1.id, 'evidence:exec-success-002');
  console.log(`   After 2 successes: success=${strat1.successCount} utility=${strat1.calculateUtility().toFixed(3)} confidence=${strat1.confidence.toFixed(2)}`);

  engine.recordFailure(strat1.id, 'evidence:exec-fail-001', 'timeout');
  console.log(`   After 1 failure: failure=${strat1.failureCount} utility=${strat1.calculateUtility().toFixed(3)} state=${strat1.state} confidence=${strat1.confidence.toFixed(2)}`);

  // 6. Belief Revision
  console.log('\n6️⃣  Belief Revision — Old belief superseded by new evidence\n');

  console.log(`   Old belief: ${belief1.id} state=${belief1.state} "${belief1.content.belief.slice(0,50)}..."`);

  const revision = engine.reviseBelief(belief1.id, {
    belief: 'Tool registry default deny + evidence_ref + allow-list + RLS + digest-only is required for security (defense in depth)',
    condition: { gates: '6 CLOSED', tests: '314/314', llm_vectors: '2/2 BLOCKED', posture: 'posture check OK' },
    reason: 'New evidence: LLM vectors blocked, need layered security beyond default deny',
    confidence: 0.95
  }, 'evidence:belief-revision-v0.5');

  console.log(`   ✅ Revised: ${revision.previous} → ${revision.current} status=${revision.status}`);
  console.log(`   Old state: ${engine.getMemory(revision.previous).state} supersededBy=${engine.getMemory(revision.previous).supersededBy}`);
  console.log(`   New: ${engine.getMemory(revision.current).content.belief.slice(0,70)}...`);

  // 7. Forgetting Engine
  console.log('\n7️⃣  Forgetting Engine — Utility-based Sweep\n');

  // Create low-utility node
  const lowUtil = await engine.registerBelief({
    belief: 'Temporary experiment that failed many times',
    condition: { experiment: true },
    evidenceRef: 'evidence:temp',
    confidence: 0.1
  });
  lowUtil.failureCount = 10;
  lowUtil.successCount = 0;
  lowUtil.lastUsedAt = Date.now() - (1000 * 60 * 60 * 24 * 10); // 10 days ago
  console.log(`   Low utility node: ${lowUtil.id} utility=${lowUtil.calculateUtility().toFixed(4)} failures=${lowUtil.failureCount} lastUsed 10 days ago`);

  const sweepResult = engine.runForgettingSweep(0.1, { keepFailures: true });
  console.log(`   🧹 Forgetting sweep threshold=0.1: retired ${sweepResult.swept} nodes`);
  console.log(`   Remaining: ${sweepResult.remaining} nodes`);

  const weakening = engine.runWeakeningSweep(0.4);
  console.log(`   Weakening sweep threshold=0.4: weakened ${weakening.weakened} nodes`);

  // 8. Ledger verification
  console.log('\n8️⃣  Memory Ledger — Hash-chained Audit Trail\n');

  const ledgerStats = engine.getStats().ledger;
  console.log(`   Ledger entries: ${ledgerStats.total}`);
  console.log(`   Actions: ${JSON.stringify(ledgerStats.actions)}`);
  console.log(`   Genesis: ${ledgerStats.genesis}... Latest: ${ledgerStats.latest}...`);

  const verification = engine.verifyLedger();
  console.log(`   ✅ Chain valid: ${verification.valid} entries=${verification.entries}`);

  const recentEntries = engine.getLedgerEntries({ limit: 5 });
  console.log('   Recent ledger:');
  recentEntries.slice(-5).forEach(e => {
    console.log(`     #${e.index} ${e.action} ${e.memoryId.slice(0,20)}... by ${e.actor} evidence=${e.evidenceRef?.slice(0,16) || 'none'}`);
  });

  // 9. Final stats
  console.log('\n9️⃣  Final Stats — Governed Memory Engine\n');

  const stats = engine.getStats();
  console.log(`   Total nodes: ${stats.total} (retrievable: ${stats.retrievable})`);
  console.log(`   By state: ${JSON.stringify(stats.states)}`);
  console.log(`   By type: ${JSON.stringify(stats.types)}`);
  console.log(`   Avg utility: ${stats.avgUtility.toFixed(3)}`);
  console.log(`   Procedural: ${stats.proceduralCount}, Failures: ${stats.failureCount}`);
  console.log(`   Recalls: ${stats.totalRecalls}, Preventions: ${stats.preventionsTriggered}, Reuse: ${stats.strategiesReused}`);
  console.log(`   Revisions: ${stats.revisions}, Vector cache: ${stats.vectorCache}`);
  console.log(`   Uptime: ${(stats.uptime / 1000).toFixed(1)}s`);

  console.log('\n✅ NEXA Memory v0.5 Governed Engine Demo Complete');
  console.log('   - State Machine: PROPOSED → ACTIVE → WEAKENED → RETIRED ✓');
  console.log('   - Procedural Memory: recipe reuse ✓');
  console.log('   - Failure Memory: prevention rules ✓');
  console.log('   - Belief Revision: superseding with evidence ✓');
  console.log('   - Forgetting Engine: utility-based sweep ✓');
  console.log('   - Ledger: hash-chained auditable ✓');
  console.log('   - No pgvector needed — local Map + JSONL, 384d optional ✓');
}

run().catch(err => {
  console.error('❌ Governed Memory Demo failed:', err);
  console.error(err.stack);
  process.exit(1);
});
