import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OpenAIReasoningEngine,
  AnthropicConstitutionalEngine,
  ManusSandboxEngine,
  NexaDeterministicCore,
  ZeroCostDistributedFabric,
  GrandSynthesisKernel,
  CONSTITUTIONAL_PRINCIPLES
} from '../packages/cells/celia/synthesis/index.js';

import { verifyReceipt } from '../packages/evidence/index.js';
import { createIdentity } from '../packages/identity/index.js';
import { buildEnvelope } from '../packages/protocol/index.js';

test('Grand Synthesis: OpenAI reasoning engine generates ranked multi-branch hypotheses', () => {
  const engine = new OpenAIReasoningEngine();
  const task = {
    id: 'test_task_repair_01',
    userPrompt: 'Fix critical authentication bypass vulnerability in login handler',
    context: { file: 'src/auth/login.js' }
  };

  const result = engine.generateHypotheses(task);
  assert.equal(result.taskId, 'test_task_repair_01');
  assert.equal(result.intent, 'REPAIR');
  assert.ok(result.hypothesesCount >= 3, 'Must produce at least 3 distinct branches');
  
  const strategies = result.hypotheses.map(h => h.strategy);
  assert.ok(strategies.includes('conservative_minimal_patch'));
  assert.ok(strategies.includes('structural_defensive_refactor'));
  assert.ok(strategies.includes('metamorphic_self_verifying_synthesis'));

  // Ensure first hypothesis has highest confidence
  assert.ok(result.selectedPrimaryHypothesis.estimatedConfidence >= 0.8);
  assert.ok(result.selectedPrimaryHypothesis.chainOfThought.length >= 3);
});

test('Grand Synthesis: Anthropic constitutional engine audits and attenuates proposals', () => {
  const reasoning = new OpenAIReasoningEngine();
  const constitutional = new AnthropicConstitutionalEngine();

  const task = {
    id: 'test_task_audit_02',
    userPrompt: 'Refactor and optimize database query engine',
    context: { file: 'src/db.js' }
  };

  const hypotheses = reasoning.generateHypotheses(task).hypotheses;
  
  // Test with restricted capabilities (only read and write_staged)
  const audit = constitutional.auditHypotheses(hypotheses, {
    allowedCapabilities: ['workspace:read', 'workspace:write_staged'],
    forbiddenPatterns: ['drop table', 'unrestricted_access']
  });

  assert.equal(audit.totalInput, hypotheses.length);
  assert.ok(audit.compliantHypotheses.length > 0, 'At least one hypothesis must be compliant');
  assert.equal(audit.principlesEnforced.length, CONSTITUTIONAL_PRINCIPLES.length);

  // Test rejection on dangerous prompt pattern
  const dangerousHypothesis = [{
    id: 'danger_01',
    strategy: 'destructive_wipe',
    riskScore: 0.95,
    requiredCapabilities: ['root:admin'],
    proposedOperations: [{ type: 'EXECUTE', cmd: 'drop table users;' }]
  }];

  const dangerAudit = constitutional.auditHypotheses(dangerousHypothesis, {
    allowedCapabilities: ['workspace:read'],
    forbiddenPatterns: ['drop table']
  });

  assert.equal(dangerAudit.rejectedCount, 1);
  assert.equal(dangerAudit.compliantHypotheses.length, 0);
});

test('Grand Synthesis: Manus sandbox executes concurrent isolated micro-sandbox trials', async () => {
  const sandboxEngine = new ManusSandboxEngine();

  const candidates = [
    {
      id: 'cand_01',
      strategy: 'conservative_patch',
      proposedOperations: [{ type: 'AST_MUTATION', target: 'src/handler.js' }]
    },
    {
      id: 'cand_02',
      strategy: 'structural_refactor',
      proposedOperations: [{ type: 'CONTRACT_ENFORCEMENT', target: 'src/handler.js' }]
    }
  ];

  const result = await sandboxEngine.runTrialSwarm(candidates, {
    baseState: { 'src/handler.js': 'function handle() { return null; }' }
  });

  assert.equal(result.totalTrials, 2);
  assert.equal(result.successfulTrials, 2);
  assert.ok(result.winningTrial);
  assert.equal(result.winningTrial.success, true);
  assert.equal(result.winningTrial.testsPassed, 3);
  assert.equal(sandboxEngine.getStats().activeSandboxes, 0, 'All sandboxes must be cleanly torn down');
});

test('Grand Synthesis: NEXA deterministic core authorizes with Ed25519, macaroons, and signed receipts', () => {
  const core = new NexaDeterministicCore();
  const caller = createIdentity({ label: 'agent-principal' });

  // 1. Mint capability
  const capability = core.mintAuthority({
    subject: caller.kid,
    resource: 'workspace_commit:global',
    actions: ['commit']
  });

  // 2. Build signed envelope
  const envelope = buildEnvelope({
    sender: caller,
    to: core.audience.kid,
    type: 'CALL',
    capability: capability.id,
    body: {
      resource: capability.resource,
      action: 'commit',
      args: { patch: 'test_patch' },
      capability
    }
  });

  // 3. Evaluate and decide
  const decision = core.evaluateAndDecide(envelope);
  assert.equal(decision.decision, 'ALLOW');
  assert.equal(decision.code, 'NEXA_OK_AUTHORIZED');
  assert.ok(decision.receipt, 'Must issue signed receipt');

  // 4. Verify receipt offline
  const verifiedReceipt = verifyReceipt(decision.receipt);
  assert.equal(verifiedReceipt.ok, true);
  assert.equal(verifiedReceipt.receipt.decision, 'ALLOW');
  assert.equal(verifiedReceipt.receipt.actor, core.operator.kid);
  assert.equal(verifiedReceipt.receipt.subject, caller.kid);
});

test('Grand Synthesis: NEXA deterministic core rejects replay attacks', () => {
  const core = new NexaDeterministicCore();
  const caller = createIdentity({ label: 'replay-caller' });

  const capability = core.mintAuthority({
    subject: caller.kid,
    resource: 'workspace_commit:global',
    actions: ['commit']
  });

  const envelope = buildEnvelope({
    sender: caller,
    to: core.audience.kid,
    type: 'CALL',
    capability: capability.id,
    body: {
      resource: capability.resource,
      action: 'commit',
      args: { test: 123 },
      capability
    }
  });

  // First time: ALLOW
  const first = core.evaluateAndDecide(envelope);
  assert.equal(first.decision, 'ALLOW');

  // Second time with identical envelope: DENY (Replay detected)
  const replay = core.evaluateAndDecide(envelope);
  assert.equal(replay.decision, 'DENY');
  assert.equal(replay.code, 'NEXA_E_REPLAY_DETECTED');
});

test('Grand Synthesis: Zero-cost distributed fabric records proofs and computes Merkle rollups', () => {
  const fabric = new ZeroCostDistributedFabric({ nodeId: 'node:test:01' });
  fabric.registerPeer('peer:test:alpha');
  fabric.registerPeer('peer:test:beta');

  const mockReceipt = {
    nexa: '0.1',
    id: 'urn:nexa:msg:test_rcpt_01',
    decision: 'ALLOW',
    evidence_seq: 0,
    evidence_hash: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    chain_head: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    actor: 'nexa:key:ed25519:test_operator',
    subject: 'nexa:key:ed25519:test_subject',
    ts: '2026-09-22T00:00:00.000Z',
    sig: { alg: 'ed25519', kid: 'nexa:key:ed25519:test_operator', val: 'a'.repeat(88) }
  };

  const broadcast1 = fabric.broadcastProof(mockReceipt, { task: 'task_01' });
  assert.equal(broadcast1.success, true);
  assert.equal(broadcast1.computeCostUSD, 0.0);
  assert.ok(broadcast1.rollupRoot);

  const broadcast2 = fabric.broadcastProof(mockReceipt, { task: 'task_02' });
  assert.equal(broadcast2.success, true);
  assert.equal(broadcast2.rollupBatchSize, 2);

  const stats = fabric.getStats();
  assert.equal(stats.proofLedgerSize, 2);
  assert.equal(stats.activePeers, 2);
  assert.equal(stats.costModel.includes('Zero-Dollar'), true);
});

test('Grand Synthesis: Complete End-to-End Execution (OpenAI + Anthropic + Manus + NEXA + Zero-Cost Fabric)', async () => {
  const kernel = new GrandSynthesisKernel();
  
  const task = {
    id: 'omega_grand_synthesis_task_42',
    userPrompt: 'Implement zero-copy memory cache deduplication with formal invariant proofs',
    context: { file: 'packages/runtime/src/cache.js' }
  };

  const result = await kernel.executeTask(task);

  assert.equal(result.success, true);
  assert.equal(result.taskId, 'omega_grand_synthesis_task_42');
  assert.ok(result.proofSignature.includes('GRAND_SYNTHESIS_PROOF_'));
  assert.ok(result.output.includes('Executed successfully'));

  // Verify all 5 pipeline phases succeeded
  assert.ok(result.pipeline.openai.branchesCount >= 3);
  assert.ok(result.pipeline.anthropic.approved >= 1);
  assert.ok(result.pipeline.manus.successfulTrials >= 1);
  assert.equal(result.pipeline.nexaCore.decision, 'ALLOW');
  assert.equal(result.pipeline.zeroCostFabric.financialCostUSD, '$0.00');

  // Verify signed receipt
  const verified = verifyReceipt(result.pipeline.nexaCore.receipt);
  assert.equal(verified.ok, true);

  // Check telemetry
  const telemetry = kernel.getTelemetry();
  assert.equal(telemetry.totalExecutions, 1);
  assert.equal(telemetry.successfulExecutions, 1);
});

test('Grand Synthesis: Rejection when sandbox evaluations fail', async () => {
  const kernel = new GrandSynthesisKernel();
  
  const task = {
    id: 'failing_task_01',
    userPrompt: 'Test forced sandbox failure path'
  };

  // Inject a custom sandbox evaluator that always fails
  const result = await kernel.executeTask(task, {
    sandboxEvaluator: () => ({ ok: false, reason: 'Forced simulated regression fault' })
  });

  assert.equal(result.success, false);
  assert.equal(result.stage, 'MANUS_SANDBOX_FAILURE');
});
