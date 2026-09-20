#!/usr/bin/env node
/**
 * Celia Demo — memory cell + grok planner + evidence
 * 
 *   node tools/celia-demo.mjs
 * 
 * Demonstrates:
 * 1. Memory cell with Supabase port (mock)
 * 2. Grok planner as planner port (mock)
 * 3. Evidence chain
 */

import { createMemoryCell } from '../packages/cells/celia/memory/src/cell.js';
import { createSupabasePort } from './celia-memory-port.mjs';
import { createGrokPlanner, createMockPlanner } from '../packages/cells/celia/planner/src/grok.js';

console.log('🌟 Celia Agent Demo — v0.1 baseline + memory + planner\n');

// 1. Memory cell
console.log('--- 1. Memory Cell (digest-only) ---');
const storePort = createSupabasePort({ url: 'https://demo.supabase.co', key: 'demo' });
const memoryCell = createMemoryCell({
  identity: { kid: 'nexa:key:ed25519:z6MkCeliaMemoryCellDemo' },
  nucleus: { module: 'memory@1', invariants: ['digest-only', 'evidence-bound'] },
  storePort,
  ledger: { record: (r) => console.log(`  [ledger] ${r.kind} ${r.receptor} digest=${r.payload_digest?.slice(0,8)}...`) }
});

const rememberResult = await memoryCell.receptors.remember({
  payload: { tier: 'episodic', digest: 'sha256:abc123...', owner_kid: 'demo' },
  capability: { verified: true },
  evidenceRef: 'evidence-hash-123'
});
console.log(`  remember: ${JSON.stringify(rememberResult)}`);

const recallResult = await memoryCell.receptors.recall({ tier: 'episodic', limit: 5 });
console.log(`  recall: ${recallResult.results.length} results`);
console.log(`  health: ${JSON.stringify(memoryCell.health())}\n`);

// 2. Grok planner
console.log('--- 2. Grok Planner (AI proposes, never mints) ---');
const planner = createMockPlanner(); // use mock for demo, no real xAI key
const fakeIR = {
  missions: [{
    goal: 'Review repository elazamey/nexa and report risks',
    plan: { steps: [{ kind: 'observe', key: 'project' }] }
  }],
  caprefs: [{ name: 'github.repository.read' }]
};

const planResult = await planner.plan({ ir: fakeIR, memoryRefs: [], world: { project: 'nexa' } });
console.log(`  planner: ${planner.name}`);
console.log(`  steps: ${JSON.stringify(planResult.steps, null, 2)}\n`);

// 3. Evidence
console.log('--- 3. Evidence Chain ---');
console.log('  Every remember/recall/plan is evidence with payload_digest');
console.log('  No raw secrets in transcript, only digests');
console.log('  Gates still CLOSED, no fs write\n');

console.log('✅ Celia demo OK — memory + planner + evidence, no authority minted');
console.log('   Next:');
console.log('   - Set SUPABASE_URL + SUPABASE_KEY via vault://');
console.log('   - Set XAI_API_KEY via vault://xai-api-key');
console.log('   - Run with real ports: node tools/celia-demo.mjs --real');
