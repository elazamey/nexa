import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CostGuard,
  FREE_TIER_PROVIDERS,
  NexaCostGuardError,
  ProviderBroker,
  EdgeHybridMemory,
  ReflectionEngine,
  EdgeEvidenceLedger,
} from '../adapters/edge-rag/rag_core.js';
import worker from '../adapters/edge-rag/worker.js';

test('CostGuard: strictly enforces $0 Hard Guarantee and blocks paid models', () => {
  CostGuard.reset();
  assert.equal(CostGuard.MAX_SPEND, 0, 'MAX_SPEND must be strictly zero');

  // Free models must be permitted
  assert.equal(CostGuard.isZeroCost('openrouter-free', 'meta-llama/llama-3.2-3b-instruct:free'), true);
  assert.equal(CostGuard.isZeroCost('groq-free', 'llama-3.1-8b-instant'), true);
  assert.equal(CostGuard.isZeroCost('local-ollama', 'llama3.2'), true);
  assert.equal(CostGuard.isZeroCost('local-webgpu', 'webgpu-all-minilm-l6-v2'), true);

  assert.doesNotThrow(() => {
    CostGuard.assertZeroSpend('local-ollama', 'llama3.2', 100);
  });

  // Paid models must be strictly blocked
  assert.equal(CostGuard.isZeroCost('openai', 'gpt-4o'), false);
  assert.equal(CostGuard.isZeroCost('anthropic', 'claude-3-5-sonnet'), false);
  assert.equal(CostGuard.isZeroCost('google-paid', 'gemini-1.5-pro-paid'), false);

  assert.throws(
    () => CostGuard.assertZeroSpend('openai', 'gpt-4o', 100),
    (err) => err instanceof NexaCostGuardError && err.nexa_code === 'NEXA_E_COST_GUARD'
  );

  // Record usage and verify stats
  const record = CostGuard.recordUsage({
    provider: 'local-ollama',
    model: 'llama3.2',
    promptTokens: 120,
    completionTokens: 80,
  });

  assert.equal(record.cost, 0.0);
  assert.equal(record.tokens, 200);

  const stats = CostGuard.getStats();
  assert.equal(stats.maxSpend, 0);
  assert.equal(stats.currentSpend, 0);
  assert.equal(stats.totalRequests, 1);
  assert.equal(stats.freeTokensConsumed, 200);
  assert.equal(stats.blockedPaidAttempts, 1);
});

test('ProviderBroker: cascades through free-tier providers and falls back to local models', async () => {
  CostGuard.reset();
  const broker = new ProviderBroker();

  // Mock fetch simulating cloud rate limit (429) then successful local Ollama fallback
  const mockFetch = async (url) => {
    if (url.includes('openrouter.ai') || url.includes('groq.com') || url.includes('nvidia.com')) {
      return {
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded: 429 Too Many Requests',
      };
    }
    if (url.includes('11434')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: { content: 'Offline local Ollama synthesis response' } }),
      };
    }
    return { ok: false, status: 500, text: async () => 'Internal Server Error' };
  };

  const result = await broker.executeCascade({
    messages: [{ role: 'user', content: 'Explain zero-cost RAG architecture' }],
    keys: { OPENROUTER_API_KEY: 'test-key', GROQ_API_KEY: 'test-key' },
    mockFetch,
  });

  assert.equal(result.success, true);
  assert.equal(result.providerUsed, 'local-ollama');
  assert.equal(result.isFallback, true);
  assert.equal(result.cost, 0.0);
  assert.equal(result.costGuardStatus, 'ZERO_COST_VERIFIED');
  assert.ok(result.content.includes('Offline local Ollama'));
});

test('EdgeHybridMemory: indexes documents, computes vectors, searches top-K, and replays JSONL ledger', () => {
  const memory = new EdgeHybridMemory({ vectorDim: 64 });
  memory.clear();

  const doc1 = {
    id: 'doc_arch_01',
    title: 'NEXA Architecture',
    content: 'NEXA implements 6 closed security gates and zero-cost local WebGPU inference.',
  };
  const doc2 = {
    id: 'doc_sec_02',
    title: 'Security Guidelines',
    content: 'All memory operations and credentials must strictly prevent ambient authority leaks.',
  };

  const res1 = memory.indexDocument(doc1);
  const res2 = memory.indexDocument(doc2);

  assert.equal(res1.chunksIndexed > 0, true);
  assert.equal(res2.chunksIndexed > 0, true);
  assert.equal(memory.documents.size, 2);

  // Vector cosine search
  const results = memory.search('security gates authority', 2);
  assert.ok(results.length > 0);
  assert.ok(results[0].score >= 0.0);

  // Export JSONL Event Ledger
  const jsonl = memory.exportJSONL();
  assert.ok(jsonl.includes('DOC_INDEXED'));
  assert.ok(jsonl.includes('doc_arch_01'));

  // Replay JSONL in new instance
  const replayedMemory = new EdgeHybridMemory({ vectorDim: 64 });
  const replayedCount = replayedMemory.replayJSONL(jsonl);
  assert.equal(replayedCount >= 2, true);
  assert.equal(replayedMemory.stateRevision >= memory.stateRevision, true);
});

test('ReflectionEngine: computes grounding metrics, detects hallucinations, and outputs lessons', () => {
  const query = 'What are the closed security gates in NEXA?';
  const context = ['NEXA strictly maintains 6 closed security gates for execution and deployments.'];
  
  // High grounding case
  const groundedAnswer = 'NEXA maintains 6 closed security gates for execution and deployments.';
  const evalGrounded = ReflectionEngine.evaluate({
    query,
    contextChunks: context,
    answer: groundedAnswer,
  });

  assert.equal(evalGrounded.verdict, 'GROUNDED');
  assert.ok(evalGrounded.reflectionScore >= 0.65);
  assert.ok(evalGrounded.hallucinationRisk <= 0.35);

  // Hallucination case (claims outside context)
  const hallucinatoryAnswer = 'NEXA uses Bitcoin blockchain and NASA satellites for quantum cloud computing.';
  const evalHallucinated = ReflectionEngine.evaluate({
    query,
    contextChunks: context,
    answer: hallucinatoryAnswer,
  });

  assert.notEqual(evalHallucinated.verdict, 'GROUNDED');
  assert.ok(evalHallucinated.hallucinationRisk >= 0.5);
  assert.ok(evalHallucinated.lessonLearned !== null);
});

test('EdgeEvidenceLedger: seals tamper-evident receipts with stdoutHash and verifies chain', async () => {
  const ledger = new EdgeEvidenceLedger();

  const receipt1 = await ledger.createReceipt({
    prompt: 'Query 1',
    context: ['Context 1'],
    stdout: 'Answer 1 from local engine',
    stateRevision: 1,
    reflection: { reflectionScore: 0.95, verdict: 'GROUNDED' },
    providerUsed: 'local-ollama',
  });

  assert.ok(receipt1.receiptHash.startsWith('sha256:'));
  assert.ok(receipt1.stdoutHash.startsWith('sha256:'));
  assert.equal(receipt1.cost, 0.0);
  assert.equal(receipt1.costGuardStatus, 'ZERO_COST_VERIFIED');

  // Verify valid receipt
  const verifyResult = await ledger.verifyReceipt(receipt1);
  assert.equal(verifyResult.valid, true);

  // Tamper check: modifying content breaks verification
  const tampered = { ...receipt1, stdoutHash: 'sha256:tamperedhash0000000000000000' };
  const tamperedResult = await ledger.verifyReceipt(tampered);
  assert.equal(tamperedResult.valid, false);
  assert.ok(tamperedResult.reason.includes('mismatch'));

  // Cost tampering check
  const paidTampered = { ...receipt1, cost: 5.0 };
  const costTamperedResult = await ledger.verifyReceipt(paidTampered);
  assert.equal(costTamperedResult.valid, false);
});

test('Cloudflare Worker: serves /api/stats, /api/reflect, and enforces CostGuard on /api/chat', async () => {
  CostGuard.reset();

  // Test /api/stats
  const reqStats = new Request('https://edge.nexa.local/api/stats', { method: 'GET' });
  const resStats = await worker.fetch(reqStats, {});
  assert.equal(resStats.status, 200);
  const dataStats = await resStats.json();
  assert.equal(dataStats.ok, true);
  assert.equal(dataStats.costGuard.maxSpend, 0);

  // Test /api/reflect
  const reqReflect = new Request('https://edge.nexa.local/api/reflect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'Check status',
      context: ['Status is nominal and operational.'],
      answer: 'Status is nominal and operational.',
    }),
  });
  const resReflect = await worker.fetch(reqReflect, {});
  assert.equal(resReflect.status, 200);
  const dataReflect = await resReflect.json();
  assert.equal(dataReflect.ok, true);
  assert.equal(dataReflect.reflection.verdict, 'GROUNDED');

  // Test /api/chat with paid model rejection
  const reqPaid = new Request('https://edge.nexa.local/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Summarize text',
      provider: 'openai',
      model: 'gpt-4o',
    }),
  });
  const resPaid = await worker.fetch(reqPaid, {});
  assert.equal(resPaid.status, 500);
  const dataPaid = await resPaid.json();
  assert.equal(dataPaid.nexa_code, 'NEXA_E_COST_GUARD');
});
