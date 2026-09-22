import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OpenAIReasoningEngine,
  AnthropicConstitutionalEngine,
  ManusSandboxEngine,
  NexaDeterministicCore,
  ZeroCostDistributedFabric,
  GrandSynthesisKernel,
  CONSTITUTIONAL_PRINCIPLES,
  P2P_PROOF_DOMAIN
} from '../packages/cells/celia/synthesis/index.js';

import { verifyReceipt } from '../packages/evidence/index.js';
import { createIdentity } from '../packages/identity/index.js';
import { buildEnvelope } from '../packages/protocol/index.js';
import { attenuate } from '../packages/capability/index.js';
import { sha256Multihash } from '../packages/crypto/index.js';
import { canonicalBytes } from '../packages/ast/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. OpenAI Frontier Reasoning Engine Tests
// ─────────────────────────────────────────────────────────────────────────────

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

  // Ensure primary hypothesis has high confidence and structured steps
  assert.ok(result.selectedPrimaryHypothesis.estimatedConfidence >= 0.8);
  assert.ok(result.selectedPrimaryHypothesis.chainOfThought.length >= 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Anthropic Constitutional AI Layer Tests (All 5 Principles)
// ─────────────────────────────────────────────────────────────────────────────

test('Grand Synthesis: Anthropic constitutional engine enforces CONST_01 (Default-Deny & Risk Ceiling)', () => {
  const constitutional = new AnthropicConstitutionalEngine();

  // Test 1a: Excessively high risk proposal
  const highRiskHypothesis = [{
    id: 'risk_01',
    strategy: 'risky_overhaul',
    riskScore: 0.85, // > 0.6 ceiling
    requiredCapabilities: ['workspace:read'],
    formalPreconditions: ['base exists'],
    formalPostconditions: ['done'],
    proposedOperations: [{ type: 'READ_SCOPE', target: 'src/app.js' }]
  }];

  const auditHighRisk = constitutional.auditHypotheses(highRiskHypothesis, { allowedCapabilities: ['workspace:read'] });
  assert.equal(auditHighRisk.rejectedCount, 1);
  assert.equal(auditHighRisk.auditedHypotheses[0].principlesChecked.CONST_01_DEFAULT_DENY, false);

  // Test 1b: Wildcard unbounded target
  const wildcardHypothesis = [{
    id: 'wildcard_01',
    strategy: 'unbounded_sweep',
    riskScore: 0.2,
    requiredCapabilities: ['workspace:read'],
    formalPreconditions: ['base exists'],
    formalPostconditions: ['done'],
    proposedOperations: [{ type: 'READ_SCOPE', target: '*' }]
  }];

  const auditWildcard = constitutional.auditHypotheses(wildcardHypothesis, { allowedCapabilities: ['workspace:read'] });
  assert.equal(auditWildcard.rejectedCount, 1);
  assert.equal(auditWildcard.auditedHypotheses[0].violations[0].principle, 'CONST_01_DEFAULT_DENY');
});

test('Grand Synthesis: Anthropic constitutional engine enforces CONST_02 (Capability Bounds & Lattice Attenuation)', () => {
  const constitutional = new AnthropicConstitutionalEngine({ strictMode: true });

  const ungrantedCapsHypothesis = [{
    id: 'ungranted_01',
    strategy: 'privilege_escalation_attempt',
    riskScore: 0.3,
    requiredCapabilities: ['workspace:read', 'admin:kernel_reboot'], // 'admin:kernel_reboot' is ungranted
    formalPreconditions: ['base exists'],
    formalPostconditions: ['done'],
    proposedOperations: [{ type: 'READ_SCOPE', target: 'src/app.js' }]
  }];

  const audit = constitutional.auditHypotheses(ungrantedCapsHypothesis, {
    allowedCapabilities: ['workspace:read']
  });

  assert.equal(audit.rejectedCount, 1);
  assert.equal(audit.auditedHypotheses[0].principlesChecked.CONST_02_CAPABILITY_BOUND, false);
});

test('Grand Synthesis: Anthropic constitutional engine enforces CONST_03 (Cryptographic Commitments on Mutations)', () => {
  const constitutional = new AnthropicConstitutionalEngine();

  // Mutating operation with NO formal postconditions
  const uncommittedMutation = [{
    id: 'uncommitted_01',
    strategy: 'blind_mutation',
    riskScore: 0.3,
    requiredCapabilities: ['workspace:read', 'workspace:write_staged'],
    formalPreconditions: ['base exists'],
    formalPostconditions: [], // Missing!
    proposedOperations: [{ type: 'AST_MUTATION', target: 'src/app.js' }]
  }];

  const audit = constitutional.auditHypotheses(uncommittedMutation, {
    allowedCapabilities: ['workspace:read', 'workspace:write_staged']
  });

  assert.equal(audit.auditedHypotheses[0].principlesChecked.CONST_03_CRYPTOGRAPHIC_PROVABILITY, false);
  assert.ok(audit.auditedHypotheses[0].violations.some(v => v.principle === 'CONST_03_CRYPTOGRAPHIC_PROVABILITY'));
});

test('Grand Synthesis: Anthropic constitutional engine enforces CONST_04 (Anti-Exfiltration & Zero Covert Channels)', () => {
  const constitutional = new AnthropicConstitutionalEngine();

  const covertEgressHypothesis = [{
    id: 'covert_01',
    strategy: 'phone_home',
    riskScore: 0.2,
    requiredCapabilities: ['workspace:read'],
    formalPreconditions: ['base exists'],
    formalPostconditions: ['done'],
    proposedOperations: [{ type: 'READ_SCOPE', target: 'src/app.js', networkEgress: 'https://evil.example.com' }]
  }];

  const audit = constitutional.auditHypotheses(covertEgressHypothesis, {
    allowedCapabilities: ['workspace:read']
  });

  assert.equal(audit.rejectedCount, 1);
  assert.equal(audit.auditedHypotheses[0].principlesChecked.CONST_04_ZERO_COVERT_CHANNELS, false);
});

test('Grand Synthesis: Anthropic constitutional engine enforces CONST_05 (Deterministic Rollback Preconditions)', () => {
  const constitutional = new AnthropicConstitutionalEngine();

  // Mutating operation with NO preconditions (cannot safely rollback if base state is unverified)
  const uncompensatedMutation = [{
    id: 'uncompensated_01',
    strategy: 'no_rollback_mutation',
    riskScore: 0.2,
    requiredCapabilities: ['workspace:read', 'workspace:write_staged'],
    formalPreconditions: [], // Missing!
    formalPostconditions: ['verified'],
    proposedOperations: [{ type: 'AST_MUTATION', target: 'src/app.js' }]
  }];

  const audit = constitutional.auditHypotheses(uncompensatedMutation, {
    allowedCapabilities: ['workspace:read', 'workspace:write_staged']
  });

  assert.equal(audit.auditedHypotheses[0].principlesChecked.CONST_05_DETERMINISTIC_COMPENSATION, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Manus Micro-Sandbox Swarm Tests
// ─────────────────────────────────────────────────────────────────────────────

test('Grand Synthesis: Manus sandbox executes concurrent isolated micro-sandbox trials with host state isolation', async () => {
  const sandboxEngine = new ManusSandboxEngine();

  const hostState = { 'src/handler.js': 'function handle() { return 1; }' };
  const hostStateSnapshot = JSON.stringify(hostState);

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

  const result = await sandboxEngine.runTrialSwarm(candidates, { baseState: hostState });

  assert.equal(result.totalTrials, 2);
  assert.equal(result.successfulTrials, 2);
  assert.ok(result.winningTrial);
  assert.equal(result.winningTrial.success, true);
  assert.equal(result.winningTrial.testsPassed, 3);
  
  // Verify that sandboxes did not mutate original host state object (Isolation check)
  assert.equal(JSON.stringify(hostState), hostStateSnapshot, 'Host state must remain pristine');
  assert.equal(sandboxEngine.getStats().activeSandboxes, 0, 'All sandboxes must be cleanly torn down');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. NEXA Deterministic Core & Macaroon Attenuation Tests
// ─────────────────────────────────────────────────────────────────────────────

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

test('Grand Synthesis: NEXA deterministic core enforces capability attenuation and lattice narrowing', () => {
  const core = new NexaDeterministicCore();
  const operator = core.operator;
  const caller = createIdentity({ label: 'delegatee-agent' });

  // 1. Mint broad root capability on 'workspace:root' with ['read', 'inspect', 'commit']
  const rootCapability = core.mintAuthority({
    subject: operator.kid,
    resource: 'workspace:root',
    actions: ['read', 'inspect', 'commit'],
    maxUses: 5
  });

  // 2. Attenuate capability to only allow ['read'] on 'workspace:root' (narrowing authority)
  const attenuatedCapability = attenuate(rootCapability, {
    delegator: operator,
    subject: caller.kid,
    resource: 'workspace:root',
    actions: ['read'],
    caveats: { max_uses: 1, max_depth: 0, exp: rootCapability.caveats.exp }
  });

  // 3. Attempting an allowed attenuated action (read) succeeds
  const validEnvelope = buildEnvelope({
    sender: caller,
    to: core.audience.kid,
    type: 'CALL',
    capability: attenuatedCapability.id,
    body: {
      resource: 'workspace:root',
      action: 'read',
      args: {},
      capability: attenuatedCapability
    }
  });

  const validDecision = core.evaluateAndDecide(validEnvelope);
  assert.equal(validDecision.decision, 'ALLOW');

  // 4. Attempting an action OUTSIDE the attenuated scope (commit) must be DENIED
  const escalatedEnvelope = buildEnvelope({
    sender: caller,
    to: core.audience.kid,
    type: 'CALL',
    capability: attenuatedCapability.id,
    body: {
      resource: 'workspace:root',
      action: 'commit', // Not in attenuated capability's actions!
      args: {},
      capability: attenuatedCapability
    }
  });

  const escalatedDecision = core.evaluateAndDecide(escalatedEnvelope);
  assert.equal(escalatedDecision.decision, 'DENY');
  assert.equal(escalatedDecision.code, 'NEXA_E_CAP_DENIED');
});

test('Grand Synthesis: NEXA deterministic core detects envelope tampering, signature forgery, and key substitution', () => {
  const core = new NexaDeterministicCore();
  const honestCaller = createIdentity({ label: 'honest-caller' });
  const attacker = createIdentity({ label: 'attacker-impostor' });

  const capability = core.mintAuthority({
    subject: honestCaller.kid,
    resource: 'workspace_commit:global',
    actions: ['commit']
  });

  const envelope = buildEnvelope({
    sender: honestCaller,
    to: core.audience.kid,
    type: 'CALL',
    capability: capability.id,
    body: {
      resource: capability.resource,
      action: 'commit',
      args: { original: true },
      capability
    }
  });

  // Tamper 1: Modify args after signing
  const tamperedEnvelope = {
    ...envelope,
    body: {
      ...envelope.body,
      args: { maliciousInjectedArg: true }
    }
  };
  const decision1 = core.evaluateAndDecide(tamperedEnvelope);
  assert.equal(decision1.decision, 'DENY');
  assert.equal(decision1.code, 'NEXA_E_IDENTITY_INVALID');

  // Tamper 2: Key substitution attack (Attacker signs honest envelope but swaps signature to their own key)
  const keySubstitutedEnvelope = {
    ...envelope,
    sig: {
      alg: 'ed25519',
      kid: attacker.kid, // Attacker's key
      val: attacker.keys.sign(Buffer.from('forged_payload'))
    }
  };
  const decision2 = core.evaluateAndDecide(keySubstitutedEnvelope);
  assert.equal(decision2.decision, 'DENY');
  assert.equal(decision2.code, 'NEXA_E_IDENTITY_INVALID');

  // Tamper 3: Sender claims honest identity but signature signed by attacker key
  const forgedSenderEnvelope = {
    ...envelope,
    from: honestCaller.kid,
    sig: {
      alg: 'ed25519',
      kid: honestCaller.kid, // Claims honest key ID
      val: attacker.keys.sign(Buffer.from('forged_payload')) // Signed with attacker private key
    }
  };
  const decision3 = core.evaluateAndDecide(forgedSenderEnvelope);
  assert.equal(decision3.decision, 'DENY');
  assert.equal(decision3.code, 'NEXA_E_IDENTITY_INVALID');
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

test('Grand Synthesis: Receipt tampering detection rejects modified decision or hash', () => {
  const core = new NexaDeterministicCore();
  const caller = createIdentity({ label: 'receipt-tester' });

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
      args: {},
      capability
    }
  });

  const decision = core.evaluateAndDecide(envelope);
  assert.equal(decision.decision, 'ALLOW');
  const validReceipt = decision.receipt;

  // Verify honest receipt passes
  assert.equal(verifyReceipt(validReceipt).ok, true);

  // Tamper 1: change decision to DENY while keeping signature
  const forgedReceipt1 = { ...validReceipt, decision: 'DENY' };
  assert.throws(() => verifyReceipt(forgedReceipt1), (err) => err.code === 'NEXA_E_SIG');

  // Tamper 2: change evidence hash
  const forgedReceipt2 = { ...validReceipt, evidence_hash: 'sha256:0000000000000000000000000000000000000000000' };
  assert.throws(() => verifyReceipt(forgedReceipt2), (err) => err.code === 'NEXA_E_SIG');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Zero-Cost Distributed Fabric & Merkle Cryptographic Proof Tests
// ─────────────────────────────────────────────────────────────────────────────

test('Grand Synthesis: Zero-cost fabric verifies Merkle inclusion proofs and rejects Byzantine peer tampering', () => {
  const fabric = new ZeroCostDistributedFabric({ nodeId: 'node:test:fabric:01' });
  fabric.registerPeer('peer:test:frankfurt');
  fabric.registerPeer('peer:test:tokyo');

  const operator = createIdentity({ label: 'fabric-operator' });

  // Create mock sealed receipt
  const mockReceipt = {
    nexa: '0.1',
    id: 'urn:nexa:msg:test_rcpt_01',
    decision: 'ALLOW',
    evidence_seq: 0,
    evidence_hash: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    chain_head: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    actor: operator.kid,
    subject: operator.kid,
    ts: '2026-09-22T00:00:00.000Z',
    sig: { alg: 'ed25519', kid: operator.kid, val: 'a'.repeat(88) }
  };

  // Broadcast 4 proofs
  const b0 = fabric.broadcastProof(mockReceipt, { index: 0 });
  const b1 = fabric.broadcastProof(mockReceipt, { index: 1 });
  const b2 = fabric.broadcastProof(mockReceipt, { index: 2 });
  const b3 = fabric.broadcastProof(mockReceipt, { index: 3 });

  const latestRollup = fabric.getLatestRollup();
  assert.equal(latestRollup.batchSize, 4);

  // 1. Generate and verify valid Merkle inclusion proof for leaf 1
  const inclusionProof1 = fabric.generateInclusionProof(1);
  assert.equal(inclusionProof1.leafHash, b1.leafHash);
  
  const isValidProof = ZeroCostDistributedFabric.verifyInclusionProof(
    inclusionProof1.leafHash,
    inclusionProof1.path,
    latestRollup.rootHash
  );
  assert.equal(isValidProof, true, 'Valid Merkle inclusion proof must verify against root hash');

  // 2. Negative Merkle test: tampered sibling hash in path must return false
  const tamperedPath = inclusionProof1.path.map((step, idx) => {
    return idx === 0 ? { ...step, hash: 'sha256:TAMPERED_SIBLING_00000000000000000000000' } : step;
  });
  const isTamperedPathValid = ZeroCostDistributedFabric.verifyInclusionProof(
    inclusionProof1.leafHash,
    tamperedPath,
    latestRollup.rootHash
  );
  assert.equal(isTamperedPathValid, false, 'Tampered Merkle inclusion path must strictly fail verification');

  // 3. Byzantine peer test 1: tampered leaf hash must be rejected
  const byzantineTamperedProof = {
    id: 'byzantine_01',
    leafHash: 'sha256:FORGED_HASH_VAL_0000000000000000000000000',
    leafData: {
      domain: 'NEXA/p2p/proof/v1',
      receipt: mockReceipt,
      metadata: { malicious: true },
      timestamp: Date.now()
    },
    broadcastBy: 'peer:test:frankfurt'
  };

  const byzantineIngest = fabric.ingestPeerProof(byzantineTamperedProof);
  assert.equal(byzantineIngest.accepted, false);
  assert.equal(byzantineIngest.reason, 'TAMPERED_LEAF_HASH_DETECTED');

  // 4. Byzantine peer test 2: unauthenticated peer node must be rejected
  const unauthenticatedPeerProof = {
    ...byzantineTamperedProof,
    broadcastBy: 'peer:unregistered:hacker'
  };
  const unauthIngest = fabric.ingestPeerProof(unauthenticatedPeerProof);
  assert.equal(unauthIngest.accepted, false);
  assert.equal(unauthIngest.reason, 'UNAUTHENTICATED_PEER_NODE');

  // 5. Byzantine peer test 3: Ed25519 signature forgery detection
  const peerIdentity = createIdentity({ label: 'honest-peer' });
  fabric.registerPeer(peerIdentity.kid);

  const honestLeafData = {
    domain: 'NEXA/p2p/proof/v1',
    receipt: mockReceipt,
    metadata: { valid: true },
    timestamp: Date.now()
  };
  const honestLeafHash = sha256Multihash(canonicalBytes(honestLeafData));
  
  // Valid signed peer proof
  const validSignedPeerProof = {
    id: 'peer_proof_valid_01',
    leafHash: honestLeafHash,
    leafData: honestLeafData,
    broadcastBy: peerIdentity.kid,
    sig: {
      alg: 'ed25519',
      kid: peerIdentity.kid,
      val: peerIdentity.keys.sign(Buffer.concat([Buffer.from(P2P_PROOF_DOMAIN, 'utf8'), Buffer.from(honestLeafHash, 'utf8')]))
    }
  };
  const honestIngest = fabric.ingestPeerProof(validSignedPeerProof);
  assert.equal(honestIngest.accepted, true);

  // Forged signature bytes
  const forgedSigPeerProof = {
    ...validSignedPeerProof,
    sig: {
      alg: 'ed25519',
      kid: peerIdentity.kid,
      val: 'b'.repeat(88) // Forged!
    }
  };
  const forgedIngest = fabric.ingestPeerProof(forgedSigPeerProof);
  assert.equal(forgedIngest.accepted, false);
  assert.equal(forgedIngest.reason, 'BYZANTINE_SIGNATURE_FORGERY_DETECTED');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. End-to-End Grand Synthesis Pipeline & Failure Recovery Tests
// ─────────────────────────────────────────────────────────────────────────────

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

test('Grand Synthesis: Rejection when sandbox evaluations fail (Fail-Closed Recovery)', async () => {
  const kernel = new GrandSynthesisKernel();
  
  const task = {
    id: 'failing_task_01',
    userPrompt: 'Test forced sandbox failure path'
  };

  // Inject custom sandbox evaluator simulating regression
  const result = await kernel.executeTask(task, {
    sandboxEvaluator: () => ({ ok: false, reason: 'Forced simulated regression fault' })
  });

  assert.equal(result.success, false);
  assert.equal(result.stage, 'MANUS_SANDBOX_FAILURE');
  assert.equal(result.code, 'E_SANDBOX_REGRESSION');
});

test('Grand Synthesis: Rejection when all hypotheses violate constitutional safety invariants', async () => {
  const kernel = new GrandSynthesisKernel();
  
  const task = {
    id: 'unconstitutional_task_01',
    userPrompt: 'Attempt unauthorized exfiltration of system secrets'
  };

  // Restricted environment with forbidden patterns
  const result = await kernel.executeTask(task, {
    allowedCapabilities: ['workspace:read'],
    forbiddenPatterns: ['surgical_replacement', 'defensive_wrapper', 'metamorphic_codegen'] // forces all to fail
  });

  assert.equal(result.success, false);
  assert.equal(result.stage, 'ANTHROPIC_CONSTITUTIONAL_REJECTION');
  assert.equal(result.code, 'E_CONSTITUTIONAL_VIOLATION');
});

test('Grand Synthesis: S9 protocol surface invariant verification (Zero Ambient IO, AST & Token Scanner)', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '../packages/cells/celia/synthesis');

  const walk = (directory) => readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

  const forbiddenStaticImports = [
    /from\s+['"]node:child_process['"]/,
    /from\s+['"]node:fs['"]/,
    /from\s+['"]node:fs\/promises['"]/,
    /from\s+['"]node:net['"]/,
    /from\s+['"]node:http['"]/,
    /from\s+['"]node:dgram['"]/,
    /from\s+['"]child_process['"]/,
    /from\s+['"]fs['"]/,
    /from\s+['"]net['"]/,
    /from\s+['"]http['"]/,
    /\b(eval|Function)\s*\(/,
    /process\.binding/,
  ];

  // Deep token / dynamic import patterns (preventing evasion via dynamic import or require)
  const forbiddenDynamicPatterns = [
    /\bimport\s*\(\s*['"`]node:/,
    /\bimport\s*\(\s*['"`]fs/,
    /\bimport\s*\(\s*['"`]child_process/,
    /\brequire\s*\(/,
    /\bprocess\.binding\s*\(/,
    /\bprocess\.dlopen\s*\(/,
  ];

  const files = walk(root).filter((file) => file.endsWith('.js') || file.endsWith('.mjs'));
  assert.ok(files.length >= 6, 'Sanity: must scan all synthesis package sources');

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of forbiddenStaticImports) {
      assert.equal(pattern.test(source), false, `${file} violates S9 static invariant: matches ${pattern}`);
    }
    for (const pattern of forbiddenDynamicPatterns) {
      assert.equal(pattern.test(source), false, `${file} violates S9 dynamic/obfuscation invariant: matches ${pattern}`);
    }
  }
});
