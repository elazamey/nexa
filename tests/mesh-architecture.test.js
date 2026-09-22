import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalRuntimeBroker,
  ModelRouter,
  ProtocolBridge,
  MemoryMesh,
  ComputerInterface,
  GovernanceKernel,
  SelfImprovementPipeline
} from '../src/mesh/index.js';

test('Mesh Architecture: LocalRuntimeBroker prioritizes free local runtimes and selects models by task', () => {
  const broker = new LocalRuntimeBroker();
  const runtimes = broker.getActiveRuntimes();
  assert.ok(runtimes.length >= 2);
  assert.equal(runtimes[0].name, 'Ollama');

  const codingModel = broker.selectModelForTask('CODING', 6000);
  assert.equal(codingModel.role, 'CODING');
  assert.ok(codingModel.vramMb <= 6000);

  const reasoningModel = broker.selectModelForTask('REASONING', 10000);
  assert.equal(reasoningModel.role, 'REASONING');
});

test('Mesh Architecture: ModelRouter routes query to zero-cost local endpoint', async () => {
  const router = new ModelRouter();
  const result = await router.route({
    prompt: 'Implement Merkle tree in Node.js',
    taskType: 'CODING',
    memoryLimitMb: 8192
  });

  assert.equal(result.isLocal, true);
  assert.equal(result.cost, '$0.00 (Zero-Cost Local)');
  assert.ok(result.response.output.includes('Proposed plan'));
});

test('Mesh Architecture: ProtocolBridge aggregates MCP, A2A, and OpenAPI tools', () => {
  const bridge = new ProtocolBridge();

  bridge.registerMcpTool('search_files', { pattern: 'string' }, () => []);
  bridge.registerA2AAgent('peer_agent_1', ['code_review', 'refactoring']);
  bridge.importOpenApiSpec('BillingAPI', [
    { method: 'GET', path: '/invoices', description: 'Fetch invoices' },
    { method: 'POST', path: '/invoices/pay', description: 'Pay invoice' }
  ]);

  const allTools = bridge.listAllTools();
  assert.equal(allTools.length, 4);
  assert.ok(allTools.some(t => t.protocol === 'MCP'));
  assert.ok(allTools.some(t => t.protocol === 'A2A'));
  assert.ok(allTools.some(t => t.protocol === 'OpenAPI'));
});

test('Mesh Architecture: MemoryMesh manages 4 tiers and Temporal Knowledge Graph', () => {
  const mem = new MemoryMesh();

  // Tier 1: Working Memory
  mem.setWorking('scratchpad', 'Investigate CVE-2026-001');
  assert.equal(mem.getWorking('scratchpad'), 'Investigate CVE-2026-001');

  // Tier 2: Episodic Memory
  const episode = mem.recordEpisode({ action: 'PATCH_SECURITY', intent: 'Fix IDOR', result: 'PASS' });
  assert.ok(episode.digest);
  assert.equal(mem.episodicMemory.length, 1);

  // Tier 3: Temporal Knowledge Graph
  mem.addKnowledgeNode('user_1', 'Account', { username: 'admin' });
  mem.addKnowledgeNode('role_admin', 'Role', { permissions: ['all'] });
  mem.addTemporalRelation('user_1', 'ASSIGNED_ROLE', 'role_admin');

  const history = mem.queryEntityHistory('user_1');
  assert.equal(history.entity.id, 'user_1');
  assert.equal(history.timeline.length, 1);
  assert.equal(history.timeline[0].relation, 'ASSIGNED_ROLE');

  // Tier 4: Procedural Memory
  mem.registerProcedure('AutomatedAudit', ['Recon', 'Hunt', 'Validate', 'SignReceipt']);
  assert.ok(mem.proceduralMemory.has('AutomatedAudit'));
});

test('Mesh Architecture: ComputerInterface validates Terminal, Browser, and File actions with traversal protection', () => {
  const comp = new ComputerInterface({ allowedPrograms: ['git', 'npm'] });

  // Terminal action
  const gitAction = comp.planTerminalAction('git', ['status']);
  assert.equal(gitAction.isAllowed, true);

  const curlAction = comp.planTerminalAction('curl', ['http://evil.com']);
  assert.equal(curlAction.isAllowed, false);

  // Browser action
  const browserAction = comp.planBrowserAction('CLICK', '#login-btn');
  assert.equal(browserAction.isValid, true);

  // File mutation with traversal protection
  const validFile = comp.planFileMutation('src/auth.js', 'export const x = 1;');
  assert.equal(validFile.allowed, true);

  const badFile = comp.planFileMutation('../../etc/passwd', 'malicious content');
  assert.equal(badFile.allowed, false);
});

test('Mesh Architecture: GovernanceKernel enforces policies, signs Ed25519 receipts, and verifies ledger integrity', () => {
  const kernel = new GovernanceKernel();

  // 1. Default-Deny: Proposal without capability is DENIED
  const unauthProposal = { type: 'TERMINAL_EXECUTION', program: 'npm', target: 'deploy' };
  const evalUnauth = kernel.evaluateProposal(unauthProposal, null);
  assert.equal(evalUnauth.isAuthorized, false);
  assert.equal(evalUnauth.decision, 'DENY');

  // 2. Authorized Proposal
  const evalAuth = kernel.evaluateProposal(unauthProposal, { valid: true, scope: ['fs:write'] });
  assert.equal(evalAuth.isAuthorized, true);
  assert.equal(evalAuth.decision, 'ALLOW');

  // 3. Commit to Evidence Ledger
  const entry1 = kernel.commitExecutionRecord(unauthProposal, evalAuth, 'Success');
  assert.ok(entry1.signature);
  assert.ok(entry1.entryHash);

  const entry2 = kernel.commitExecutionRecord({ type: 'FILE_MUTATION', filePath: 'test.js' }, evalAuth, 'File written');
  assert.equal(entry2.previousHash, entry1.entryHash);

  // 4. Verify Ledger Integrity
  const integrity = kernel.verifyLedgerIntegrity();
  assert.equal(integrity.valid, true);
  assert.equal(integrity.totalRecords, 2);

  // 5. Tampering Detection
  kernel.ledger[1].resultSummary = 'TAMPERED_RESULT';
  const tamperedIntegrity = kernel.verifyLedgerIntegrity();
  assert.equal(tamperedIntegrity.valid, false);
  assert.equal(tamperedIntegrity.brokenSeq, 2);
});

test('Mesh Architecture: SelfImprovementPipeline enforces 6-stage safe promotion with fail-closed recovery', async () => {
  const kernel = new GovernanceKernel();
  const pipeline = new SelfImprovementPipeline(kernel);

  const proposal = pipeline.proposeOptimization(
    'CryptoModule',
    'Switch to WebCrypto Ed25519',
    '+ const key = await crypto.subtle.generateKey("Ed25519", true, ["sign"]);'
  );

  // Case A: Sandbox tests fail -> Rejection
  const failedTestResult = await pipeline.executeSafePromotion(
    proposal.proposalId,
    () => false, // Tests fail
    () => true
  );
  assert.equal(failedTestResult.status, 'REJECTED');
  assert.equal(failedTestResult.stage, 'SANDBOX_TESTS');

  // Case B: Tests and Security pass -> Promoted with Ed25519 signed receipt
  const validProposal = pipeline.proposeOptimization('Logger', 'Optimize batch write', '+ logBatch();');
  const successResult = await pipeline.executeSafePromotion(
    validProposal.proposalId,
    () => true, // Tests pass
    () => true  // Security scan pass
  );
  assert.equal(successResult.status, 'SUCCESS_PROMOTED');
  assert.ok(successResult.receiptSignature);
});
