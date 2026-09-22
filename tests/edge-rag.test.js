import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientEdgeRAG } from '../adapters/edge-rag/rag_core.js';
import worker from '../adapters/edge-rag/worker.js';

test('Edge RAG: ClientEdgeRAG splits document into overlapping chunks', () => {
  const rag = new ClientEdgeRAG();
  const sampleDoc = 'word '.repeat(500);
  const chunks = rag.chunkText(sampleDoc, 100, 20);

  assert.ok(chunks.length > 3);
  assert.ok(chunks[0].split(' ').length <= 100);
});

test('Edge RAG: ClientEdgeRAG generates normalized vectors and computes cosine similarity', async () => {
  const rag = new ClientEdgeRAG();
  await rag.init();

  const vecA = await rag.generateEmbedding('cybersecurity policy');
  const vecB = await rag.generateEmbedding('cybersecurity policy');
  const vecC = await rag.generateEmbedding('banana recipe fruit');

  // Identical vectors should have similarity ~ 1.0
  const simIdentical = rag.cosineSimilarity(vecA, vecB);
  assert.ok(Math.abs(simIdentical - 1.0) < 0.001);

  // Different text should have lower similarity
  const simDifferent = rag.cosineSimilarity(vecA, vecC);
  assert.ok(simDifferent < simIdentical);
});

test('Edge RAG: ClientEdgeRAG indexes documents and retrieves top-k relevant chunks', async () => {
  const rag = new ClientEdgeRAG();
  await rag.init();

  const document = `
    NEXA is a zero-trust governance protocol using Ed25519 signatures and capability macaroons.
    WebGPU allows executing LLM embeddings directly inside client browsers with hardware acceleration.
    Cloudflare Workers execute lightweight JavaScript at edge datacenters worldwide.
  `;

  const count = await rag.indexDocument(document, 'nexa-spec.txt');
  assert.ok(count > 0);

  const searchResults = await rag.search('How does NEXA verify capabilities?', 2);
  assert.ok(searchResults.length > 0);
  assert.ok(searchResults[0].score > 0);
  assert.ok(searchResults[0].text.includes('NEXA'));
});

test('Edge RAG: Cloudflare Worker handles CORS OPTIONS preflight and input validation', async () => {
  // 1. CORS Preflight
  const reqOptions = new Request('https://edge.nexa.local/api/chat', { method: 'OPTIONS' });
  const resOptions = await worker.fetch(reqOptions);
  assert.equal(resOptions.status, 200);
  assert.equal(resOptions.headers.get('Access-Control-Allow-Origin'), '*');

  // 2. Missing Prompt Validation
  const reqMissing = new Request('https://edge.nexa.local/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const resMissing = await worker.fetch(reqMissing);
  assert.equal(resMissing.status, 400);

  // 3. Missing API Key on server
  const reqValid = new Request('https://edge.nexa.local/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Hello', context: 'Test' })
  });
  const resNoKey = await worker.fetch(reqValid, { NVIDIA_API_KEY: '' });
  assert.equal(resNoKey.status, 500);
});
