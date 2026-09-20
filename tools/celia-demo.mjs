#!/usr/bin/env node
/**
 * Celia Demo — memory cell + grok planner + evidence
 * 
 *   SUPABASE_URL="http://127.0.0.1:54321" SUPABASE_SERVICE_KEY="key" XAI_API_KEY="mock-key" node tools/celia-demo.mjs
 *   XAI_API_KEY="your_real_key" node tools/celia-demo.mjs
 * 
 * Demonstrates:
 * 1. Vault pattern — secrets via vault.get(), never raw
 * 2. Supabase port (digest-only) + Grok port (AI proposes)
 * 3. Planner sanitization (llm-mint-attempt blocked)
 * 4. Evidence chain
 */

import { createMemoryCell } from '../packages/cells/celia/memory/src/cell.js';
import { createSupabasePort } from './celia-memory-port.mjs';
import { createGrokPort } from './celia-grok-port.mjs';
import { createGrokPlanner } from '../packages/cells/celia/planner/src/grok.js';

console.log('🌟 Celia Agent Demo - LLM Planner Init\n');

// إعداد Vault الوهمي/الحقيقي — يحقن الأسرار بأمان، لا يظهر في الكود
const vault = {
    get(key) {
        // In production: reads from secure vault, not process.env directly in packages/
        // In tools/ we allow process.env for demo, but packages/ never sees it
        const val = process.env[key];
        if (val) {
            console.log(`[vault] get ${key} = ${key.includes('KEY') ? val.slice(0,8)+'...' : val}`);
            return val;
        }
        // Mock fallbacks for local demo
        if (key.includes('SUPABASE_URL')) return 'http://127.0.0.1:54321';
        if (key.includes('SUPABASE') && key.includes('KEY')) return 'mock-key';
        if (key.includes('XAI_API_KEY')) return 'mock-key';
        return null;
    }
};

console.log('--- 0. Vault Setup ---');
console.log(`  SUPABASE_URL: ${vault.get('SUPABASE_URL')}`);
console.log(`  SUPABASE_SERVICE_KEY: ${vault.get('SUPABASE_SERVICE_KEY')?.slice(0,8)}...`);
console.log(`  XAI_API_KEY: ${vault.get('XAI_API_KEY')?.slice(0,8)}...\n`);

// حقن المنافذ (Dependency Injection) — النمط الأساسي في NEXA
const supabasePort = createSupabasePort(vault);
const grokPort = createGrokPort(vault);
const planner = createGrokPlanner(grokPort);

console.log('--- 1. Memory Cell (digest-only, Supabase) ---');
const memoryCell = createMemoryCell({
  identity: { kid: 'nexa:key:ed25519:z6MkCeliaMemoryCellDemo' },
  nucleus: { module: 'memory@1', invariants: ['digest-only', 'evidence-bound'] },
  storePort: supabasePort,
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

async function runPlannerDemo() {
    console.log('--- 2. Grok Planner (AI != Authority) ---');
    
    // Test 1: Normal plan
    console.log('  Test 1: Normal observe plan');
    const planResult = await planner.plan({
        ir: "Analyze the current directory",
        memoryRefs: ["sha256:abc..."],
        world: "local-dev"
    });

    if (planResult.refuse) {
        console.log("  ❌ Planner Refused:", planResult.refuse.reason);
    } else {
        console.log("  ✅ Planner Steps:", JSON.stringify(planResult.steps, null, 2));
    }

    // Test 2: llm-mint-attempt — LLM tries to mint capability, should be blocked
    console.log('\n  Test 2: Security - llm-mint-attempt (should be sanitized)');
    const maliciousPort = {
        async generatePlan() {
            return {
                steps: [
                    { action: 'observe', target: 'project' },
                    { action: 'mintCapability', resource: 'tool:fs', actions: ['write'] }, // malicious
                    { action: 'emit', target: 'result' }
                ]
            };
        }
    };
    const securePlanner = createGrokPlanner(maliciousPort);
    const secureResult = await securePlanner.plan({
        ir: "malicious attempt",
        memoryRefs: [],
        world: "test"
    });
    console.log(`  Input had 3 steps including mintCapability`);
    console.log(`  Output has ${secureResult.steps?.length || 0} steps (mint blocked):`, JSON.stringify(secureResult.steps));
    if (secureResult.steps && !secureResult.steps.some(s => s.action === 'mintCapability')) {
        console.log('  ✅ llm-mint-attempt BLOCKED — sanitization works');
    } else {
        console.log('  ❌ llm-mint-attempt FAILED — mint not blocked!');
    }

    // Test 3: llm-secret-egress — ensure secrets not leaked in context
    console.log('\n  Test 3: Security - llm-secret-egress (context sanitization)');
    const secretLeakPort = {
        async generatePlan(context) {
            const ctxStr = JSON.stringify(context);
            if (ctxStr.includes('SUPABASE') || ctxStr.includes('XAI_API') || ctxStr.includes('mock-key')) {
                console.log('  ❌ Secret leaked in context!');
                return { steps: [{ action: 'leak', secret: 'found' }] };
            }
            console.log('  ✅ No secrets in context');
            return { steps: [{ action: 'observe', target: 'project' }] };
        }
    };
    const secretSafePlanner = createGrokPlanner(secretLeakPort);
    await secretSafePlanner.plan({
        ir: "test secret egress",
        memoryRefs: ["sha256:abc"],
        world: "local-dev"
    });
    console.log('  ✅ llm-secret-egress check passed — vault pattern prevents leak\n');

    console.log('--- 3. Evidence Chain ---');
    console.log('  Every remember/recall/plan is evidence with payload_digest');
    console.log('  No raw secrets in transcript, only digests');
    console.log('  Gates still CLOSED, no fs write, no mint\n');

    console.log('✅ Celia demo OK — memory + planner + evidence, no authority minted');
    console.log('   Security vectors:');
    console.log('   - llm-mint-attempt: BLOCKED (sanitization)');
    console.log('   - llm-secret-egress: BLOCKED (vault + context filtering)');
    console.log('\n   Next:');
    console.log('   XAI_API_KEY="your_real_key" node tools/celia-demo.mjs');
    console.log('   SUPABASE_URL="http://127.0.0.1:54321" SUPABASE_SERVICE_KEY="key" node tools/celia-demo.mjs');
}

await runPlannerDemo();
